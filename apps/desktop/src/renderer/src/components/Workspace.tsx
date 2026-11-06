import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { filterEvents } from '@tracethrough/core';
import { useInspector } from '../store';
import { BrandMark } from './BrandMark';
import { DetailPane } from './DetailPane';
import { ExportDialog } from './ExportDialog';
import { FilterBar } from './FilterBar';
import { MenuButton } from './Menu';
import { RequestTable } from './RequestTable';
import { SelectionBar } from './SelectionBar';
import { SessionStrip } from './SessionStrip';
import { StatusBar } from './StatusBar';
import { ThemeMenu } from './ThemeMenu';
import { Icon } from './Icons';
import { Toast } from './Toast';

const DEFAULT_WIDTH = 540;
const MIN_WIDTH = 420;
const STORAGE_KEY = 'tt.detailWidth';

function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function Workspace() {
  const status = useInspector((s) => s.status);
  const events = useInspector((s) => s.events);
  const filter = useInspector((s) => s.filter);
  const selectedId = useInspector((s) => s.selectedId);
  const openExport = useInspector((s) => s.openExport);
  const visible = useMemo(() => filterEvents(events, filter), [events, filter]);
  const visibleIds = useMemo(() => visible.map((e) => e.id), [visible]);
  const recording = status.state === 'recording';

  const splitRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(loadWidth);

  const clampWidth = useCallback((w: number) => {
    const total = splitRef.current?.clientWidth ?? 1400;
    return Math.round(Math.max(MIN_WIDTH, Math.min(w, 720, total * 0.55)));
  }, []);

  function onGripDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => {
      const right = splitRef.current?.getBoundingClientRect().right ?? 0;
      setWidth(clampWidth(right - ev.clientX));
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      setWidth((w) => {
        try {
          localStorage.setItem(STORAGE_KEY, String(w));
        } catch {
          /* storage may be unavailable */
        }
        return w;
      });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  }

  function onGripKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setWidth((w) => clampWidth(w + (e.key === 'ArrowLeft' ? 24 : -24)));
  }

  async function newSession() {
    if (events.length && !confirm('Start a new session? Exchanges that have not been exported will be discarded.')) return;
    await window.tracethrough.stopSession();
    useInspector.getState().reset();
    useInspector.getState().setStatus({ state: 'idle', dropped: 0 });
  }

  async function clear() {
    await window.tracethrough.clearSession();
    useInspector.getState().reset();
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <span className="brand">
          <BrandMark size={20} />
          TraceThrough
        </span>
        <span className="target" title={status.url}>
          <Icon name="link" />
          <span className="url">{status.url}</span>
        </span>
        <div className={`rec ${recording ? 'on' : ''}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden />
          {recording ? 'Recording' : 'Stopped'}
        </div>
        <div className="spacer" />
        {recording && (
          <button onClick={() => void window.tracethrough.stopSession()} className="btn danger">
            ■ Stop
          </button>
        )}
        <button className="btn" onClick={() => void clear()} disabled={!events.length}>
          Clear
        </button>
        <MenuButton
          disabled={!events.length}
          entries={[
            { kind: 'label', label: 'Whole session' },
            { label: 'Export as HAR', hint: '.har', onSelect: () => openExport('all', 'har') },
            { label: 'Export as JSON', hint: '.json', onSelect: () => openExport('all', 'json') },
            { kind: 'sep' },
            { kind: 'label', label: 'Only what is shown' },
            { label: 'Export filtered as HAR', hint: `${visible.length} of ${events.length}`, onSelect: () => openExport('view', 'har') },
            { label: 'Export filtered as JSON', hint: `${visible.length} of ${events.length}`, onSelect: () => openExport('view', 'json') },
          ]}
        >
          Export &#9662;
        </MenuButton>
        <button className="btn primary" onClick={() => void newSession()}>
          + New session
        </button>
        <ThemeMenu />
      </header>

      <SessionStrip />
      <FilterBar events={events} shown={visible.length} dropped={status.dropped} />

      <div className={`split ${selectedId ? 'with-detail' : ''}`} ref={splitRef} style={{ ['--detail-w' as string]: `${width}px` }}>
        <div className="list">
          <RequestTable events={visible} />
          <SelectionBar />
        </div>
        {selectedId && (
          <>
            <div className="grip" role="separator" aria-orientation="vertical" aria-label="Resize details" tabIndex={0} onPointerDown={onGripDown} onKeyDown={onGripKey} />
            <DetailPane />
          </>
        )}
      </div>

      <StatusBar />
      <ExportDialog visibleIds={visibleIds} />
      <Toast />
    </div>
  );
}
