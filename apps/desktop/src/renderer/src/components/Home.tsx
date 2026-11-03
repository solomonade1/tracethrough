import { useEffect, useState, type FormEvent } from 'react';
import type { AppEnvironment } from '../../../shared/api';
import { useInspector } from '../store';
import { ConnectPanel } from './ConnectPanel';

export function Home() {
  const status = useInspector((s) => s.status);
  const [url, setUrl] = useState('https://');
  const [connect, setConnect] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [env, setEnv] = useState<AppEnvironment | undefined>();
  const starting = status.state === 'starting';
  const noBrowser = env !== undefined && env.browsers.length === 0;

  useEffect(() => {
    void window.tracelens.getEnvironment().then(setEnv);
  }, []);

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    useInspector.getState().reset();
    const result = await window.tracelens.startSession(url.trim(), { connect });
    if (!result.ok) setError(result.error);
  }

  return (
    <main className="home">
      <div className="home-brand">
        <span className="logo" aria-hidden>◎</span>
        <h1>TraceLens</h1>
        {env && <span className="muted small">v{env.version}</span>}
      </div>

      <section className="card" aria-labelledby="inspect-title">
        <h2 id="inspect-title">Inspect URL</h2>
        <p className="muted">
          Opens the site in an isolated browser with a fresh profile. Browse normally; every request the browser makes
          streams in here with secrets masked.
        </p>
        <form onSubmit={start} className="url-form">
          <label htmlFor="target-url" className="sr-only">
            URL to inspect
          </label>
          <input
            id="target-url"
            type="text"
            inputMode="url"
            spellCheck={false}
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            aria-invalid={!!error}
            aria-describedby={error ? 'url-error' : undefined}
          />
          <button type="submit" className="primary" disabled={starting || noBrowser}>
            {starting ? 'Starting…' : 'Start session'}
          </button>
        </form>
        <label className="check">
          <input type="checkbox" checked={connect} onChange={(e) => setConnect(e.target.checked)} />
          <span>
            This is my app: link server calls reported by App Connect (adds a <code>traceparent</code> header to requests
            to this origin only)
          </span>
        </label>
        {(error ?? status.error) && (
          <p id="url-error" role="alert" className="error">
            {error ?? status.error}
          </p>
        )}
        {noBrowser ? (
          <p role="alert" className="error">
            TraceLens needs Google Chrome or Microsoft Edge to open sites. Install one, then restart TraceLens.
          </p>
        ) : (
          env && (
            <p className="muted small">
              Sessions open in {env.browsers[0]!.label} with a fresh, separate profile.
            </p>
          )
        )}
        <ul className="facts">
          <li>Only inspect sites you are authorized to access.</li>
          <li>
            You will see <strong>browser</strong> traffic. A site's own server-side calls are visible only for apps you
            instrument with App Connect.
          </li>
          <li>Sessions are kept in memory until you export them.</li>
        </ul>
      </section>

      <section className="card" aria-labelledby="connect-title">
        <h2 id="connect-title">Connect App</h2>
        <p className="muted">See the HTTP calls your own Node.js / Next.js server makes, linked to the browser requests that caused them.</p>
        <ConnectPanel />
      </section>
    </main>
  );
}
