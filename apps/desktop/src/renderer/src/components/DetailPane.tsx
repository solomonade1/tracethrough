import { useMemo, useState, type ReactNode } from 'react';
import { MASK, type BodyPreview, type NetworkEvent } from '@tracethrough/core';
import { formatBytes, formatMs, statusTone, unavailableMessage } from '../format';
import { useInspector, type DetailTab } from '../store';

const TABS: [DetailTab, string][] = [
  ['overview', 'Overview'],
  ['headers', 'Headers'],
  ['request', 'Request'],
  ['response', 'Response'],
  ['timing', 'Timing'],
];

/** Renders text inertly (React escapes it) and highlights masked values. */
function Masked({ text }: { text: string }) {
  const parts = text.split(MASK);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <mark className="masked">{MASK}</mark>}
        </span>
      ))}
    </>
  );
}

function KeyValues({ rows, empty }: { rows: [string, string][]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`}>
            <th scope="row">{k}</th>
            <td>
              <Masked text={v} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BodyView({ body, pendingText }: { body: BodyPreview | undefined; pendingText: string }) {
  const [raw, setRaw] = useState(false);
  const pretty = useMemo(() => {
    if (!body?.preview || body.truncated || !body.mime?.includes('json')) return undefined;
    try {
      return JSON.stringify(JSON.parse(body.preview), null, 2);
    } catch {
      return undefined;
    }
  }, [body]);

  if (!body) return <p className="muted">{pendingText}</p>;
  if (body.unavailableReason) return <p className="unavailable">{unavailableMessage(body)}</p>;

  return (
    <div className="bodyview">
      <div className="bodymeta">
        <span>{body.mime ?? 'unknown type'}</span>
        <span>{formatBytes(body.sizeBytes)}</span>
        {body.truncated && <span className="warn">Truncated preview (body exceeds capture limit)</span>}
        {pretty && (
          <button className="link" onClick={() => setRaw(!raw)}>
            {raw ? 'Pretty' : 'Raw'}
          </button>
        )}
      </div>
      <pre>
        <Masked text={(!raw && pretty) || body.preview || ''} />
      </pre>
    </div>
  );
}

function Overview({ e, events }: { e: NetworkEvent; events: NetworkEvent[] }) {
  const select = useInspector((s) => s.select);
  const masked = useInspector((s) => s.status.masked);
  const from = e.redirectedFromId ? events.find((x) => x.id === e.redirectedFromId) : undefined;
  const to = events.find((x) => x.redirectedFromId === e.id);
  const row = (k: string, v: ReactNode) =>
    v === undefined || v === '' || v === false ? null : (
      <tr key={k}>
        <th scope="row">{k}</th>
        <td>{v}</td>
      </tr>
    );
  const link = (x: NetworkEvent, label: ReactNode = x.urlSanitized) => (
    <button className="link" onClick={() => select(x.id)}>
      {label}
    </button>
  );
  // COR-01: links exist only on an exact trace-id match; nothing is inferred from timing.
  const linkedServer = e.source === 'browser' && e.traceId ? events.filter((x) => x.source === 'server' && x.traceId === e.traceId) : [];
  const trigger = e.source === 'server' && e.traceId ? events.find((x) => x.source === 'browser' && x.traceId === e.traceId) : undefined;
  const serverCalls =
    e.source === 'browser' && e.traceId ? (
      linkedServer.length ? (
        <ul className="links">
          {linkedServer.map((x) => (
            <li key={x.id}>{link(x, `${x.state === 'complete' ? x.status : x.state} ${x.method} ${x.urlSanitized}`)}</li>
          ))}
        </ul>
      ) : (
        <span className="muted">None reported for this request (yet)</span>
      )
    ) : undefined;
  const triggeredBy =
    e.source === 'server' ? (
      trigger ? (
        link(trigger, `${trigger.method} ${trigger.urlSanitized}`)
      ) : (
        <span className="muted">Not linked: no browser request carried a matching trace context</span>
      )
    ) : undefined;

  return (
    <>
      {e.error && (
        <div className="unavailable error" role="alert">
          <strong>{e.error.message}</strong>
          {e.error.code && <code> {e.error.code}</code>}
        </div>
      )}
      <table className="kv">
        <tbody>
          {row('URL', <Masked text={e.urlSanitized} />)}
          {row('Method', e.method)}
          {row('Status', e.state === 'complete' ? `${e.status ?? ''} ${e.statusText ?? ''}` : e.state)}
          {row('Type', `${e.type ?? ''}${e.resourceType && e.resourceType !== e.type ? ` (${e.resourceType})` : ''}`)}
          {row('Source', <span className={`badge ${e.source}`}>{e.source === 'browser' ? 'Browser' : 'Server'}</span>)}
          {row(
            'Started',
            new Date(e.timestamp).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              fractionalSecondDigits: 3,
              hour12: false,
            }),
          )}
          {row('Duration', formatMs(e.durationMs))}
          {row('Navigation', e.isNavigation ? 'Page navigation' : undefined)}
          {row('Redirected from', from && link(from))}
          {row('Redirects to', to && link(to))}
          {row('Service worker', e.fromServiceWorker ? 'Served by service worker' : undefined)}
          {row('Handled request', e.handler && <Masked text={e.handler} />)}
          {row('Triggered by', triggeredBy)}
          {row('Server calls', serverCalls)}
          {row('Trace ID', e.traceId && <code>{e.traceId}</code>)}
          {row(
            'Redaction',
            e.redactionApplied
              ? 'Some values were masked before capture'
              : masked
                ? 'Nothing matched redaction rules'
                : 'Off for this session: values are shown exactly as captured',
          )}
        </tbody>
      </table>
    </>
  );
}

function Timing({ e }: { e: NetworkEvent }) {
  const t = e.timing ?? {};
  const phases: [string, number | undefined][] = [
    ['DNS lookup', t.dnsMs],
    ['Connect', t.connectMs],
    ['TLS', t.tlsMs],
    ['Waiting (TTFB)', t.ttfbMs],
    ['Download', t.downloadMs],
  ];
  const total = e.durationMs ?? 0;
  if (e.state === 'pending') return <p className="muted">Waiting for response…</p>;
  return (
    <table className="kv timing">
      <tbody>
        {phases.map(([label, ms]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>
              {ms === undefined ? (
                <span className="muted">not reported (e.g. reused connection or cache)</span>
              ) : (
                <div className="bar-row">
                  <div className="bar" style={{ width: `${total ? Math.max(1, (ms / total) * 100) : 0}%` }} />
                  <span>{formatMs(ms)}</span>
                </div>
              )}
            </td>
          </tr>
        ))}
        <tr>
          <th scope="row">Total</th>
          <td>{formatMs(e.durationMs)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function queryRows(url: string): [string, string][] {
  try {
    return [...new URL(url).searchParams];
  } catch {
    return [];
  }
}

export function DetailPane() {
  const events = useInspector((s) => s.events);
  const selectedId = useInspector((s) => s.selectedId);
  const tab = useInspector((s) => s.detailTab);
  const setTab = useInspector((s) => s.setDetailTab);
  const select = useInspector((s) => s.select);
  const e = events.find((x) => x.id === selectedId);
  if (!e) return null;

  return (
    <aside className="detail" aria-label="Request details">
      <div className="detail-head">
        <span className={`status-pill tone-${statusTone(e)}`}>{e.state === 'complete' ? e.status : e.state}</span>
        <span className="detail-url" title={e.urlSanitized}>
          {e.method} {e.urlSanitized}
        </span>
        <button className="link" aria-label="Close details" onClick={() => select(undefined)}>
          ✕
        </button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" key={e.id}>
        {tab === 'overview' && <Overview e={e} events={events} />}
        {tab === 'headers' && (
          <>
            <h3>Request headers</h3>
            <KeyValues rows={Object.entries(e.requestHeadersSanitized ?? {})} empty="No request headers captured." />
            <h3>Response headers</h3>
            <KeyValues
              rows={Object.entries(e.responseHeadersSanitized ?? {}).flatMap(([k, v]) => v.split('\n').map((x): [string, string] => [k, x]))}
              empty={e.state === 'pending' ? 'Waiting for response…' : 'No response headers (request did not complete).'}
            />
          </>
        )}
        {tab === 'request' && (
          <>
            <h3>Query parameters</h3>
            <KeyValues rows={queryRows(e.urlSanitized)} empty="No query parameters." />
            <h3>Body</h3>
            <BodyView body={e.requestBody} pendingText="No request body." />
          </>
        )}
        {tab === 'response' && (
          <BodyView
            body={e.responseBody}
            pendingText={e.state === 'pending' ? 'Waiting for response…' : 'No response body (request did not complete).'}
          />
        )}
        {tab === 'timing' && <Timing e={e} />}
      </div>
    </aside>
  );
}
