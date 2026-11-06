import { useInspector } from '../store';

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** One line of facts about this session: what is visible, whether values are masked, and notices. */
export function SessionStrip() {
  const status = useInspector((s) => s.status);
  const notice = useInspector((s) => s.notice);
  const serverEvents = useInspector((s) => s.events.some((e) => e.source === 'server'));
  const connected = !!status.connectedOrigin;
  const masked = !!status.masked;

  return (
    <div className="session-strip" role="note">
      {connected && (
        <>
          {serverEvents ? (
            <span>
              <span className="dot ok" aria-hidden /> <b>App connected</b>
            </span>
          ) : (
            <span>
              <span className="dot warn" aria-hidden /> App Connect on · waiting for server events
            </span>
          )}
          <i />
        </>
      )}
      <span>
        {connected ? (
          <>
            Browser + Server <span className="muted">· traceparent on {hostOf(status.connectedOrigin!)} only</span>
          </>
        ) : (
          <>
            <b>Browser traffic only</b> <span className="muted">· this site's own server calls are not visible</span>
          </>
        )}
      </span>
      {status.channel && (
        <>
          <i />
          <span className="chip">{status.channel}</span>
        </>
      )}
      <i />
      <span title="Masking is chosen when a session starts">
        <span className={`dot ${masked ? 'accent' : 'off'}`} aria-hidden /> {masked ? 'Masking on' : 'Masking off'}
      </span>
      <i />
      <span>Local session · in memory until exported</span>
      <span className="spacer" />
      {notice ? (
        <span className="notice">{notice}</span>
      ) : (
        !masked && <span className="warn">Exports include live cookies and tokens</span>
      )}
    </div>
  );
}
