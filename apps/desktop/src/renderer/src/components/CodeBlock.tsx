import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

/** A short snippet with a Copy button. `copyText` lets the copied text differ from what is shown (hidden token). */
export function CodeBlock({ label, text, copyText, actions }: { label: string; text: string; copyText?: string; actions?: ReactNode }) {
  return (
    <div className="copyblock">
      <div className="copyhead">
        <span>{label}</span>
        <span className="copyactions">
          {actions}
          <CopyButton text={copyText ?? text} label={label} />
        </span>
      </div>
      <pre tabIndex={0}>{text}</pre>
    </div>
  );
}
