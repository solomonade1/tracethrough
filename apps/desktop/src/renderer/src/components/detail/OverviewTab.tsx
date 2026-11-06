import type { ReactNode } from 'react';
import type { NetworkEvent } from '@tracethrough/core';
import { formatMs, statusTone } from '../../format';
import { copyText } from '../../lib/clipboard';
import { serverCallsOf, triggerOf } from '../../lib/rows';
import { useLinks } from '../../lib/useLinks';
import { useInspector } from '../../store';
import { Masked, Note, SectionHead } from './shared';

function LinkCard({ x, onOpen }: { x: NetworkEvent; onOpen(id: string): void }) {
  const label = x.source === 'browser' ? 'Browser' : 'Server';
  return (
    <button type="button" className="linkcard" onClick={() => onOpen(x.id)}>
      <span className={`st tone-${statusTone(x)}`}>{x.state === 'complete' ? x.status : x.state}</span>{' '}
      <span className="lc-name">
        {x.method} {x.urlSanitized}
      </span>{' '}
      <span className={`badge ${x.source}`}>{label}</span>
      <span className="dur">{formatMs(x.durationMs)}</span>
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <SectionHead title={title} hint={hint} />
      {children}
    </section>
  );
}

export function OverviewTab({ e, events }: { e: NetworkEvent; events: NetworkEvent[] }) {
  const select = useInspector((s) => s.select);
  const masked = useInspector((s) => s.status.masked);
  const links = useLinks();
  const byId = (id: string | undefined) => (id ? events.find((x) => x.id === id) : undefined);

  const from = byId(e.redirectedFromId);
  const to = events.find((x) => x.redirectedFromId === e.id);
  const serverCalls = serverCallsOf(links, e);
  const trigger = triggerOf(links, e);

  const time = new Date(e.timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });
  const redaction = e.redactionApplied
    ? 'Some values were masked before capture'
    : masked
      ? 'Nothing matched redaction rules'
      : 'Off for this session: values are shown exactly as captured';
  // Each row has plain text (for Copy) and the node to show; rows with no text are left out.
  const rows: { label: string; text: string; node?: ReactNode }[] = [
    { label: 'URL', text: e.urlSanitized, node: <Masked text={e.urlSanitized} /> },
    { label: 'Method', text: e.method },
    { label: 'Status', text: e.state === 'complete' ? `${e.status ?? ''} ${e.statusText ?? ''}`.trim() : e.state },
    { label: 'Type', text: `${e.type ?? ''}${e.resourceType && e.resourceType !== e.type ? ` (${e.resourceType})` : ''}` },
    { label: 'Source', text: e.source === 'browser' ? 'Browser' : 'Server', node: <span className={`badge ${e.source}`}>{e.source === 'browser' ? 'Browser' : 'Server'}</span> },
    { label: 'Started', text: time },
    { label: 'Duration', text: formatMs(e.durationMs) },
    { label: 'Protocol', text: e.protocol ?? 'not reported', node: e.protocol ?? <span className="muted">not reported</span> },
    { label: 'Navigation', text: e.isNavigation ? 'Page navigation' : '' },
    { label: 'Service worker', text: e.fromServiceWorker ? 'Served by service worker' : '' },
    { label: 'Handled request', text: e.handler ?? '', node: e.handler ? <Masked text={e.handler} /> : undefined },
    { label: 'Trace ID', text: e.traceId ?? '', node: e.traceId ? <code>{e.traceId}</code> : undefined },
    { label: 'Redaction', text: redaction },
  ].filter((r) => r.text !== '');
  const asText = () => rows.map((r) => `${r.label}: ${r.text}`).join(String.fromCharCode(10));

  return (
    <div className="pscroll">
      {e.error && (
        <Note tone="err" role="alert">
          <strong>{e.error.message}</strong>
          {e.error.code && <div className="mono">{e.error.code}</div>}
        </Note>
      )}

      {e.source === 'browser' && e.traceId && (
        <Section title="Server calls" hint="linked by trace ID">
          {serverCalls.length ? (
            <ul className="links">
              {serverCalls.map((x) => (
                <li key={x.id}>
                  <LinkCard x={x} onOpen={select} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted tight">None reported for this request yet.</p>
          )}
        </Section>
      )}

      {e.source === 'server' && (
        <Section title="Triggered by">
          {trigger ? (
            <ul className="links">
              <li>
                <LinkCard x={trigger} onOpen={select} />
              </li>
            </ul>
          ) : (
            <Note tone="warn">Not linked: no browser request carried a matching trace context. TraceThrough does not guess links from timing.</Note>
          )}
        </Section>
      )}

      {from && (
        <Section title="Redirected from">
          <ul className="links">
            <li>
              <LinkCard x={from} onOpen={select} />
            </li>
          </ul>
        </Section>
      )}
      {to && (
        <Section title="Redirects to">
          <ul className="links">
            <li>
              <LinkCard x={to} onOpen={select} />
            </li>
          </ul>
        </Section>
      )}

      <section aria-label="General">
        <SectionHead title="General" onCopy={() => void copyText(asText(), 'general info')} />
        <table className="kv">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.node ?? r.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
