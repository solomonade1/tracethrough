import type { ReactNode } from 'react';
import { MASK } from '@tracethrough/core';
import { copyText } from '../../lib/clipboard';

/** Renders text inertly (React escapes it) and highlights masked values. */
export function Masked({ text }: { text: string }) {
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

const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i;

/** Name/value rows with a per-row Copy button (visible on hover and keyboard focus). */
export function KeyValues({
  rows,
  empty,
  tagSensitive,
}: {
  rows: [string, string][];
  empty: string;
  /** Tag credential headers; only meaningful when masking is off. */
  tagSensitive?: boolean;
}) {
  if (!rows.length) return <p className="muted tight">{empty}</p>;
  return (
    <table className="kv mono-kv">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`} data-find-row>
            <th scope="row">{k}</th>
            <td>
              <Masked text={v} />
              {tagSensitive && SENSITIVE.test(k) && <span className="sens">sensitive</span>}
              <button type="button" className="cp" aria-label={`Copy ${k}`} onClick={() => void copyText(v, k)}>
                Copy
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Section label with a count and an optional Copy link on the right. */
export function SectionHead({ title, count, onCopy, copyLabel = 'Copy', hint }: { title: string; count?: number; onCopy?: () => void; copyLabel?: string; hint?: string }) {
  return (
    <div className="sh">
      <h3>{title}</h3>
      {count !== undefined && <span className="c">{count}</span>}
      {hint && <span className="c">{hint}</span>}
      <span className="spacer" />
      {onCopy && (
        <button type="button" className="link" onClick={onCopy}>
          {copyLabel}
        </button>
      )}
    </div>
  );
}

export function Note({ tone, children, role }: { tone?: 'warn' | 'err'; children: ReactNode; role?: 'alert' }) {
  return (
    <div className={`note ${tone ?? ''}`} role={role}>
      {children}
    </div>
  );
}
