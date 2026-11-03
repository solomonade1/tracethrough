import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type EventBatch, type SessionStatus, type TraceLensApi } from '../shared/api';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: TraceLensApi = {
  startSession: (url) => ipcRenderer.invoke(IPC.start, url),
  stopSession: () => ipcRenderer.invoke(IPC.stop),
  clearSession: () => ipcRenderer.invoke(IPC.clear),
  exportSession: (format) => ipcRenderer.invoke(IPC.export, format),
  onEvents: (listener) => subscribe<EventBatch>(IPC.events, listener),
  onStatus: (listener) => subscribe<SessionStatus>(IPC.status, listener),
};

contextBridge.exposeInMainWorld('tracelens', api);
