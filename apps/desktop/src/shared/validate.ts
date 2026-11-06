import { MAX_EXPORT_IDS, MAX_SAVE_BYTES, type ExportFormat, type ExportScope, type SaveFileRequest } from './api';

/** Argument checks shared by Electron main and the web server; both receive untrusted renderer input. */
export function parseExportFormat(value: unknown): ExportFormat {
  if (value !== 'har' && value !== 'json') throw new Error('Unknown export format');
  return value;
}

export function parseExportScope(value: unknown): ExportScope {
  if (value === undefined || value === null) return {};
  const ids = (value as { ids?: unknown }).ids;
  if (ids === undefined) return {};
  if (!Array.isArray(ids) || ids.length > MAX_EXPORT_IDS || ids.some((id) => typeof id !== 'string')) {
    throw new Error('Invalid export scope');
  }
  return { ids: ids as string[] };
}

export function parseSaveFileRequest(value: unknown): SaveFileRequest {
  const v = value as Partial<SaveFileRequest> | null;
  if (!v || typeof v.suggestedName !== 'string' || typeof v.content !== 'string') throw new Error('Invalid save request');
  if (v.kind !== 'har' && v.kind !== 'json' && v.kind !== 'text') throw new Error('Invalid save request');
  if (Buffer.byteLength(v.content, 'utf8') > MAX_SAVE_BYTES) throw new Error('File is too large to save');
  // A file name only: strip any directory part and characters Windows rejects.
  const name = v.suggestedName.split(/[\/]/).pop()!.replace(/[<>:"|?*\u0000-\u001f]/g, '-').slice(0, 120) || 'tracethrough.txt';
  return { suggestedName: name, content: v.content, kind: v.kind };
}

export const FILE_FILTERS: Record<SaveFileRequest['kind'], { name: string; extensions: string[] }[]> = {
  har: [{ name: 'HTTP Archive', extensions: ['har'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
  text: [{ name: 'All files', extensions: ['*'] }],
};
