import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { BROWSER_LABELS, findBrowsers, type BrowserChannel } from '@tracethrough/capture';
import { IPC, type ExportResult, type SaveFileRequest } from '../shared/api';
import { parseExternalUrl } from '../shared/links';
import { FILE_FILTERS, parseExportFormat, parseExportScope, parseSaveFileRequest } from '../shared/validate';
import { ConnectService } from './connect';
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
    title: 'TraceThrough',
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
    headless: process.env.TRACETHROUGH_HEADLESS_CAPTURE === '1',
    channel: process.env.TRACETHROUGH_BROWSER_CHANNEL as BrowserChannel | undefined,
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

async function saveWithDialog(defaultName: string, kind: SaveFileRequest['kind'], content: string): Promise<ExportResult> {
  if (!win) return { saved: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: FILE_FILTERS[kind],
  });
  if (canceled || !filePath) return { saved: false };
  await writeFile(filePath, content, 'utf8');
  return { saved: true, path: filePath };
}

/** The renderer's Export dialog has already shown the masking warning, so this only asks where to save. */
async function exportSession(format: unknown, scope: unknown): Promise<ExportResult> {
  const fmt = parseExportFormat(format);
  const { ids } = parseExportScope(scope);
  const data = host?.exportData(fmt, ids);
  if (!data) return { saved: false };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = ids ? '-selected' : '';
  return saveWithDialog(`tracethrough-${stamp}${suffix}.${fmt}`, fmt, data);
}

async function saveFile(request: unknown): Promise<ExportResult> {
  const { suggestedName, kind, content } = parseSaveFileRequest(request);
  return saveWithDialog(suggestedName, kind, content);
}

// App Connect collector lives for the whole app; server events go to whichever session is recording.
const connect = new ConnectService({
  tokenFile: join(app.getPath('userData'), 'collector.json'),
  port: process.env.TRACETHROUGH_COLLECTOR_PORT ? Number(process.env.TRACETHROUGH_COLLECTOR_PORT) : undefined,
  token: process.env.TRACETHROUGH_COLLECTOR_TOKEN || undefined,
  ingest: (events) => host?.ingest(events) ?? 0,
});

app.whenReady().then(async () => {
  handle(IPC.start, (url, options) => host?.start(url, options));
  handle(IPC.stop, () => host?.stop());
  handle(IPC.clear, () => host?.clear());
  handle(IPC.export, (format, scope) => exportSession(format, scope));
  handle(IPC.saveFile, (request) => saveFile(request));
  handle(IPC.connectInfo, () => connect.info());
  handle(IPC.regenerateToken, () => connect.regenerate());
  handle(IPC.openExternal, (url) => shell.openExternal(parseExternalUrl(url)));
  handle(IPC.environment, () => ({
    version: app.getVersion(),
    platform: process.platform,
    runtime: 'desktop',
    browsers: findBrowsers().map((channel) => ({ channel, label: BROWSER_LABELS[channel] })),
  }));
  await connect.start();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => void connect.close());
