import { useMemo, useState } from 'react';
import { headerLines, parseCookies, type NetworkEvent } from '@tracethrough/core';
import { copyText } from '../../lib/clipboard';
import { useInspector } from '../../store';
import { KeyValues, Masked, SectionHead } from './shared';

const asLines = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join('\n');

export function HeadersTab({ e }: { e: NetworkEvent }) {
  const masked = useInspector((s) => s.status.masked);
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const hit = (name: string, value: string) => !needle || name.toLowerCase().includes(needle) || value.toLowerCase().includes(needle);

  const req = useMemo(() => headerLines(e.requestHeadersSanitized), [e]);
  const res = useMemo(() => headerLines(e.responseHeadersSanitized), [e]);
  const cookies = useMemo(() => parseCookies(e), [e]);
  const shownCookies = cookies.filter((c) => hit(c.name, c.value));

  return (
    <>
      <div className="find">
        <input type="search" data-find aria-label="Find header" placeholder="Find header or value…" value={find} onChange={(ev) => setFind(ev.target.value)} />
        <button type="button" className="btn sm" onClick={() => void copyText(`${asLines(req)}\n\n${asLines(res)}`, 'all headers')}>
          Copy all
        </button>
      </div>
      <div className="pscroll">
        <section aria-label="Request headers">
          <SectionHead title="Request headers" count={req.length} onCopy={() => void copyText(asLines(req), 'request headers')} />
          <KeyValues rows={req.filter(([k, v]) => hit(k, v))} empty="No request headers captured." tagSensitive={masked === false} />
        </section>
        <section aria-label="Response headers">
          <SectionHead title="Response headers" count={res.length} onCopy={() => void copyText(asLines(res), 'response headers')} />
          <KeyValues
            rows={res.filter(([k, v]) => hit(k, v))}
            empty={e.state === 'pending' ? 'Waiting for response…' : 'No response headers (request did not complete).'}
            tagSensitive={masked === false}
          />
        </section>
        <section aria-label="Cookies">
          <SectionHead
            title="Cookies"
            count={cookies.length}
            onCopy={cookies.length ? () => void copyText(cookies.map((c) => `${c.name}=${c.value}`).join('\n'), 'cookies') : undefined}
          />
          {shownCookies.length ? (
            <table className="kv mono-kv">
              <tbody>
                {shownCookies.map((c, i) => (
                  <tr key={`${c.kind}-${c.name}-${i}`}>
                    <th scope="row">
                      {c.name} <span className="muted sans">· {c.kind === 'sent' ? 'Sent' : 'Set'}</span>
                    </th>
                    <td>
                      <Masked text={c.value} />
                      {c.attributes && (
                        <>
                          <br />
                          <span className="muted">{c.attributes}</span>
                        </>
                      )}
                      <button type="button" className="cp" aria-label={`Copy ${c.name}`} onClick={() => void copyText(c.value, c.name)}>
                        Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted tight">{cookies.length ? 'No cookies match.' : 'No cookies sent or set.'}</p>
          )}
        </section>
      </div>
    </>
  );
}
