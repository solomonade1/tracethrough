import { useMemo, useState } from 'react';
import { filterEvents } from '@tracelens/core';
import type { ExportFormat } from '../../../shared/api';
import { useInspector } from '../store';
import { DetailPane } from './DetailPane';
import { FilterBar } from './FilterBar';
import { RequestTable } from './RequestTable';

export function Workspace() {
  const status = useInspector((s) => s.status);
  const events = useInspector((s) => s.events);
  const filter = useInspector((s) => s.filter);
  const selectedId = useInspector((s) => s.selectedId);
  const visible = useMemo(() => filterEvents(events, filter), [events, filter]);
  const [notice, setNotice] = useState<string | undefined>();
  const recording = status.state === 'recording';

  async function exportAs(format: ExportFormat) {
    setNotice(undefined);
    const result = await window.tracelens.exportSession(format);
    if (result.saved) setNotice(`Exported to ${result.path}`);
  }

  async function newSession() {
    if (events.length && !confirm('Start a new session? Exchanges that have not been exported will be discarded.')) return;
    await window.tracelens.stopSession();
    useInspector.getState().reset();
    useInspector.getState().setStatus({ state: 'idle', dropped: 0 });
  }

  async function clear() {
    await window.tracelens.clearSession();
    useInspector.getState().reset();
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <span className="logo" aria-hidden>◎</span>
        <div className={`rec ${recording ? 'on' : ''}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden />
          {recording ? 'Recording' : 'Stopped'}
        </div>
        <span className="target" title={status.url}>
          {status.url}
        </span>
        {status.channel && <span className="chip static">{status.channel}</span>}
        {status.connectedOrigin && (
          <span className="chip static connected" title="Server events from App Connect are linked by trace context">
            App Connect
          </span>
        )}
        <div className="spacer" />
        {recording && (
          <button onClick={() => void window.tracelens.stopSession()} className="danger">
            ■ Stop
          </button>
        )}
        <button onClick={() => void clear()} disabled={!events.length}>
          Clear
        </button>
        <button onClick={() => void exportAs('har')} disabled={!events.length}>
          Export HAR
        </button>
        <button onClick={() => void exportAs('json')} disabled={!events.length}>
          Export JSON
        </button>
        <button onClick={() => void newSession()}>New session</button>
      </header>

      <div className="banner" role="note">
        {status.connectedOrigin ? (
          <>
            <strong>Browser traffic + App Connect.</strong> Server calls appear only if your app at{' '}
            <code>{status.connectedOrigin}</code> runs the SDK; they link to browser requests only through matching trace
            context.
          </>
        ) : (
          <>
            <strong>Browser traffic only.</strong> Requests this site's servers make to other services are not visible
            here.
          </>
        )}{' '}
        Secrets are masked before anything is stored or exported.
        {notice && <span className="notice"> {notice}</span>}
      </div>

      <FilterBar events={events} shown={visible.length} dropped={status.dropped} />

      <div className={`split ${selectedId ? 'with-detail' : ''}`}>
        <RequestTable events={visible} />
        {selectedId && <DetailPane />}
      </div>
    </div>
  );
}
