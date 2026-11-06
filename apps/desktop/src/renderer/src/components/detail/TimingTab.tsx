import type { NetworkEvent } from '@tracethrough/core';
import { formatMs } from '../../format';
import { copyText } from '../../lib/clipboard';
import { SectionHead } from './shared';

export function TimingTab({ e }: { e: NetworkEvent }) {
  const t = e.timing ?? {};
  const phases: [string, number | undefined][] = [
    ['DNS lookup', t.dnsMs],
    ['Connect', t.connectMs],
    ['TLS', t.tlsMs],
    ['Waiting (TTFB)', t.ttfbMs],
    ['Download', t.downloadMs],
  ];
  const total = e.durationMs ?? 0;
  if (e.state === 'pending') return <div className="pscroll"><p className="muted tight">Waiting for response…</p></div>;

  let offset = 0;
  const bars = phases.map(([label, ms]) => {
    if (ms === undefined) return { label, ms, left: 0, width: 0 };
    const left = total ? (offset / total) * 100 : 0;
    offset += ms;
    return { label, ms, left, width: total ? Math.max(0.8, (ms / total) * 100) : 0 };
  });
  const asText = () => [...phases.map(([l, ms]) => `${l}: ${ms === undefined ? 'not reported' : formatMs(ms)}`), `Total: ${formatMs(e.durationMs)}`].join('\n');

  return (
    <div className="pscroll">
      <SectionHead title="Phases" onCopy={() => void copyText(asText(), 'timing')} />
      <table className="kv timing">
        <tbody>
          {bars.map((b) => (
            <tr key={b.label}>
              <th scope="row">{b.label}</th>
              <td>
                {b.ms === undefined ? (
                  <span className="muted">Not reported (reused connection, cache or server event)</span>
                ) : (
                  <div className="bar-row">
                    <div className="track">
                      <i style={{ left: `${b.left}%`, width: `${b.width}%` }} />
                    </div>
                    <span className="num">{formatMs(b.ms)}</span>
                  </div>
                )}
              </td>
            </tr>
          ))}
          <tr className="total">
            <th scope="row">Total</th>
            <td>{formatMs(e.durationMs)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
