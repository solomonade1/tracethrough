import { useEffect, useState } from 'react';
import type { ConnectInfo } from '../../../shared/api';

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyblock">
      <div className="copyhead">
        <span>{label}</span>
        <button
          className="link"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

const NEXT_SNIPPET = `// instrumentation.ts (project root or src/)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('@tracethrough/next');
    register();
  }
}`;

const NODE_SNIPPET = `// first import in your server entry
import { register } from '@tracethrough/node';
register();`;

/** App Connect setup: collector status, env vars and framework snippets (RFC-001). */
export function ConnectPanel() {
  const [info, setInfo] = useState<ConnectInfo | undefined>();
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => void window.tracethrough.getConnectInfo().then((i) => alive && setInfo(i));
    load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!info) return null;
  if (!info.listening) {
    return <p className="error">{info.error ?? 'Collector is not running.'}</p>;
  }

  const env = `TRACETHROUGH_COLLECTOR_URL=${info.collectorUrl}\nTRACETHROUGH_TOKEN=${showToken ? info.token : '••••••••••••••••'}`;
  const envForCopy = `TRACETHROUGH_COLLECTOR_URL=${info.collectorUrl}\nTRACETHROUGH_TOKEN=${info.token}`;

  return (
    <div className="connect">
      <p className="muted" role="status">
        Collector listening on <code>{info.collectorUrl}</code> (this machine only) · {info.received} server events received
        {info.ignored > 0 && <span> · {info.ignored} ignored (no session recording)</span>}
      </p>
      <ol>
        <li>
          Add to your app's environment (e.g. <code>.env.local</code>):
          <div className="copyblock">
            <div className="copyhead">
              <span>Environment</span>
              <span>
                <button className="link" onClick={() => setShowToken(!showToken)}>
                  {showToken ? 'Hide token' : 'Show token'}
                </button>
                <button className="link" onClick={() => void navigator.clipboard.writeText(envForCopy)}>
                  Copy
                </button>
              </span>
            </div>
            <pre>{env}</pre>
          </div>
        </li>
        <li>
          Register the SDK (Node runtime only; metadata only, no bodies):
          <CopyBlock label="Next.js" text={NEXT_SNIPPET} />
          <CopyBlock label="Node" text={NODE_SNIPPET} />
        </li>
        <li>
          Start a session above with <strong>This is my app</strong> ticked. Requests to that origin get a trace header so
          server calls can be linked.
        </li>
      </ol>
      <p className="muted small">
        Off when <code>NODE_ENV=production</code> unless <code>TRACETHROUGH_ALLOW_PRODUCTION=1</code>.{' '}
        <button
          className="link"
          onClick={() => {
            if (confirm('Regenerate the token? Apps using the current token will stop sending until updated.'))
              void window.tracethrough.regenerateToken().then(setInfo);
          }}
        >
          Regenerate token
        </button>
      </p>
    </div>
  );
}
