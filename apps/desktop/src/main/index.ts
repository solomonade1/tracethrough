import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { BrowserChannel } from '@tracelens/capture';
import { EXPORT_WARNING } from '@tracelens/core';
import { IPC, type ExportFormat, type ExportResult } from '../shared/api';
import { SessionHost } from './session-host';

const here = fileURLToPath(new URL('.', import.meta.url));

let win: BrowserWindow | undefined;
let host: SessionHost | undefined;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    title: 'TraceLens',
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const contents = win.webContents;

  // The inspector UI never navigates or opens windows; captured URLs open in the capture browser only.
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  host = new SessionHost((channel, payload) => !contents.isDestroyed() && contents.send(channel, payload), {
    headless: process.env.TRACELENS_HEADLESS_CAPTURE === '1',
    channel: process.env.TRACELENS_BROWSER_CHANNEL as BrowserChannel | undefined,
    appVersion: app.getVersion(),
  });

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    void host?.dispose();
    host = undefined;
    win = undefined;
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(here, '../renderer/index.html'));
}

/** Only the inspector's own top frame may call privileged handlers. */
function fromOurWindow(e: IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame;
}

function handle(channel: string, fn: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromOurWindow(e)) throw new Error('Rejected IPC from unexpected sender');
    return fn(...args);
  });
}

async function exportSession(format: unknown): Promise<ExportResult> {
  if (format !== 'har' && format !== 'json') throw new Error('Unknown export format');
  const data = host?.exportData(format as ExportFormat);
  if (!data || !win) return { saved: false };

  const confirm = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Export', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Export sanitized session?',
    detail: EXPORT_WARNING,
  });
  if (confirm.response !== 0) return { saved: false };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `tracelens-${stamp}.${format === 'har' ? 'har' : 'json'}`,
    filters: format === 'har' ? [{ name: 'HTTP Archive', extensions: ['har'] }] : [{ name: 'TraceLens session', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { saved: false };
  await writeFile(filePath, data, 'utf8');
  return { saved: true, path: filePath };
}

app.whenReady().then(() => {
  handle(IPC.start, (url) => host?.start(url));
  handle(IPC.stop, () => host?.stop());
  handle(IPC.clear, () => host?.clear());
  handle(IPC.export, (format) => exportSession(format));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
