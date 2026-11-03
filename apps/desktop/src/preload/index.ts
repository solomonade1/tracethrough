import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type EventBatch, type SessionStatus, type TraceThroughApi } from '../shared/api';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: TraceThroughApi = {
  startSession: (url, options) => ipcRenderer.invoke(IPC.start, url, options),
  stopSession: () => ipcRenderer.invoke(IPC.stop),
  clearSession: () => ipcRenderer.invoke(IPC.clear),
  exportSession: (format) => ipcRenderer.invoke(IPC.export, format),
  getConnectInfo: () => ipcRenderer.invoke(IPC.connectInfo),
  regenerateToken: () => ipcRenderer.invoke(IPC.regenerateToken),
  getEnvironment: () => ipcRenderer.invoke(IPC.environment),
  onEvents: (listener) => subscribe<EventBatch>(IPC.events, listener),
  onStatus: (listener) => subscribe<SessionStatus>(IPC.status, listener),
};

contextBridge.exposeInMainWorld('tracethrough', api);
