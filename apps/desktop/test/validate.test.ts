import { describe, expect, it } from 'vitest';
import { MAX_EXPORT_IDS, MAX_SAVE_BYTES } from '../src/shared/api';
import { parseExportFormat, parseExportScope, parseSaveFileRequest } from '../src/shared/validate';

describe('renderer input validation', () => {
  it('accepts only known export formats', () => {
    expect(parseExportFormat('har')).toBe('har');
    expect(() => parseExportFormat('xml')).toThrow('Unknown export format');
  });

  it('accepts an omitted scope or a bounded list of string ids', () => {
    expect(parseExportScope(undefined)).toEqual({});
    expect(parseExportScope({})).toEqual({});
    expect(parseExportScope({ ids: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] });
    expect(() => parseExportScope({ ids: 'a' })).toThrow('Invalid export scope');
    expect(() => parseExportScope({ ids: [1] })).toThrow('Invalid export scope');
    expect(() => parseExportScope({ ids: new Array(MAX_EXPORT_IDS + 1).fill('x') })).toThrow('Invalid export scope');
  });

  it('keeps only a file name and rejects malformed or oversized saves', () => {
    const ok = parseSaveFileRequest({ suggestedName: '..\..\evil/dir/report:1?.json', content: '{}', kind: 'json' });
    expect(ok.suggestedName).toBe('report-1-.json');
    expect(parseSaveFileRequest({ suggestedName: '', content: 'x', kind: 'text' }).suggestedName).toBe('tracethrough.txt');
    expect(() => parseSaveFileRequest(null)).toThrow('Invalid save request');
    expect(() => parseSaveFileRequest({ suggestedName: 'a', content: 'x', kind: 'exe' })).toThrow('Invalid save request');
    expect(() => parseSaveFileRequest({ suggestedName: 'a', content: 'x'.repeat(MAX_SAVE_BYTES + 1), kind: 'text' })).toThrow('too large');
  });
});
