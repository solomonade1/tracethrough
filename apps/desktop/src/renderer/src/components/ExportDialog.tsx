import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EXPORT_WARNING, EXPORT_WARNING_UNMASKED } from '@tracethrough/core';
import type { ExportFormat } from '../../../shared/api';
import { useInspector, type ExportScopeChoice } from '../store';

const plural = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

const FORMATS: { id: ExportFormat; title: string; text: string }[] = [
  { id: 'har', title: 'HAR 1.2', text: 'Opens in Chrome DevTools, Charles and Fiddler. Server calls carry _source: server.' },
  { id: 'json', title: 'TraceThrough JSON', text: 'Everything captured, including trace IDs and links between browser and server.' },
];

/** Scope and format for an export, with the masking warning. The native save dialog comes after Save file. */
export function ExportDialog({ visibleIds }: { visibleIds: string[] }) {
  const dialog = useInspector((s) => s.exportDialog);
  const total = useInspector((s) => s.events.length);
  const picked = useInspector((s) => s.picked);
  const masked = useInspector((s) => s.status.masked);
  const close = useInspector((s) => s.closeExport);
  const [scope, setScope] = useState<ExportScopeChoice>('all');
  const [format, setFormat] = useState<ExportFormat>('har');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!dialog) return;
    setScope(dialog.scope);
    setFormat(dialog.format);
    opener.current = document.activeElement;
    box.current?.querySelector<HTMLButtonElement>('button.primary')?.focus();
    return () => {
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [dialog]);

  if (!dialog) return null;

  const scopes: { id: ExportScopeChoice; title: string; text: string }[] = [
    { id: 'all', title: 'Whole session', text: plural(total) },
    { id: 'view', title: 'Only what is shown', text: `${plural(visibleIds.length)} ${visibleIds.length === 1 ? 'matches' : 'match'} the filters` },
    ...(picked.size ? [{ id: 'sel' as const, title: 'Selected rows', text: plural(picked.size) }] : []),
  ];

  async function save() {
    const ids = scope === 'all' ? undefined : scope === 'view' ? visibleIds : [...picked];
    setBusy(true);
    try {
      const result = await window.tracethrough.exportSession(format, ids ? { ids } : undefined);
      if (result.saved) {
        const { setNotice, showToast } = useInspector.getState();
        setNotice(`Exported to ${result.path}`);
        showToast(`Exported to ${result.path}`);
        close();
      }
    } catch (err) {
      useInspector.getState().showToast(`Couldn't export: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      return close();
    }
    if (e.key !== 'Tab') return;
    const focusable = [...(box.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" ref={box} onKeyDown={onKeyDown}>
        <h3 id="export-title">Export</h3>
        <div className="opts" role="radiogroup" aria-label="What to include">
          {scopes.map((s) => (
            <label key={s.id}>
              <input type="radio" name="export-scope" checked={scope === s.id} onChange={() => setScope(s.id)} />
              <span>
                <b>{s.title}</b>
                <small>{s.text}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="opts" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <label key={f.id}>
              <input type="radio" name="export-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
              <span>
                <b>{f.title}</b>
                <small>{f.text}</small>
              </span>
            </label>
          ))}
        </div>
        <div className={`note ${masked ? '' : 'warn'}`}>
          {masked ? EXPORT_WARNING : EXPORT_WARNING_UNMASKED}
        </div>
        <div className="row-end">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Save file…
          </button>
        </div>
      </div>
    </div>
  );
}
