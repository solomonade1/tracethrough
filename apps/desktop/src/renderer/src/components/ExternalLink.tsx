import { useState, type ReactNode } from 'react';

/**
 * A link that opens in the user's own browser through the app (the window itself never navigates).
 * If the app refuses or fails to open it, the address is shown so it can still be copied.
 */
export function ExternalLink({ href, children, className = 'link' }: { href: string; children: ReactNode; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setFailed(false);
          window.tracethrough.openExternal(href).catch(() => setFailed(true));
        }}
      >
        {children}
        <span aria-hidden="true"> ↗</span>
      </button>
      {failed && (
        <span role="alert" className="error small">
          {' '}
          Couldn’t open it. Address: <code>{href}</code>
        </span>
      )}
    </>
  );
}
