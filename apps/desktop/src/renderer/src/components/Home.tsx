import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppEnvironment } from '../../../shared/api';
import { useInspector } from '../store';
import { BrandMark } from './BrandMark';
import { ConnectPanel } from './ConnectPanel';
import { ThemeMenu } from './ThemeMenu';

/** Prefill only: a chip never starts a session. */
const EXAMPLES = ['https://example.com', 'https://httpbin.org', 'http://localhost:3000'];

const STEPS = [
  { title: 'Enter a URL', body: 'Chrome or Edge opens with a fresh, separate profile: no cookies, no extensions.' },
  { title: 'Browse and inspect', body: 'Requests appear live. Click one for headers, cookies, bodies and timing, or export the session as HAR or JSON.' },
  { title: 'Connect your server (optional)', body: 'Add the SDK to a Node.js or Next.js app to see its fetch calls beside the browser request that triggered them.' },
];

export function Home() {
  const status = useInspector((s) => s.status);
  const [url, setUrl] = useState('https://');
  const [connect, setConnect] = useState(false);
  const [mask, setMask] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [env, setEnv] = useState<AppEnvironment | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const starting = status.state === 'starting';
  const noBrowser = env !== undefined && env.browsers.length === 0;

  useEffect(() => {
    void window.tracethrough.getEnvironment().then(setEnv);
  }, []);

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    useInspector.getState().reset();
    const result = await window.tracethrough.startSession(url.trim(), { connect, mask });
    if (!result.ok) setError(result.error);
  }

  function pick(example: string) {
    setUrl(example);
    setError(undefined);
    input.current?.focus();
  }

  return (
    <div className="home">
      <header className="home-brand">
        <BrandMark size={26} />
        <span className="home-name">TraceThrough</span>
        {env && <span className="muted small">v{env.version}</span>}
        <ThemeMenu />
      </header>

      <main className="home-main">
        <section className="hero" aria-labelledby="inspect-title">
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" />
            <span id="inspect-title">Inspect URL</span>
          </p>
          <h1>Inspect the requests behind any page.</h1>
          <p className="lede">
            Open a URL in a clean Chrome or Edge window and read every request. Own a Node.js or Next.js app? See its
            server calls too.
          </p>

          <form onSubmit={start} className="url-form">
            <label htmlFor="target-url" className="sr-only">
              URL to inspect
            </label>
            <input
              ref={input}
              id="target-url"
              type="text"
              inputMode="url"
              spellCheck={false}
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.com"
              aria-invalid={!!error}
              aria-describedby={error ? 'url-error' : undefined}
            />
            <button type="submit" className="primary" disabled={starting || noBrowser}>
              {starting ? 'Starting…' : 'Start session'}
            </button>
          </form>

          <div className="chips" role="group" aria-label="Example URLs">
            <span className="muted small">Try</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => pick(ex)}>
                {ex.replace(/^https?:\/\//, '')}
              </button>
            ))}
          </div>

          {(error ?? status.error) && (
            <p id="url-error" role="alert" className="error">
              {error ?? status.error}
            </p>
          )}
          {noBrowser && (
            <p role="alert" className="error">
              TraceThrough needs Google Chrome or Microsoft Edge to open sites. Install one, then restart TraceThrough.
            </p>
          )}

          <div className="options">
            <label className="option">
              <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />
              <span>
                <strong>Mask secrets</strong>
                <span className="muted small">Hide cookies, tokens and API keys. Use before screenshots or exports.</span>
              </span>
            </label>
            <label className="option">
              <input type="checkbox" checked={connect} onChange={(e) => setConnect(e.target.checked)} />
              <span>
                <strong>This is my app</strong>
                <span className="muted small">
                  Show your server's fetch calls (set up App Connect below). Adds a <code>traceparent</code> header to this origin only.
                </span>
              </span>
            </label>
          </div>
        </section>

        <ol className="steps" aria-label="How it works">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p className="muted">{s.body}</p>
            </li>
          ))}
        </ol>

        <section className="connect-card" aria-labelledby="connect-title">
          <div className="connect-head">
            <h2 id="connect-title">Connect App</h2>
            <span className="badge-optional">Optional</span>
          </div>
          <p className="muted">
            See the fetch calls your Node.js or Next.js server makes, linked to the browser request that triggered them.
          </p>
          <ConnectPanel />
        </section>
      </main>

      <footer className="home-foot muted small">
        <span>
          Runs on this machine. No account, no cloud
          {env && env.browsers[0] ? ` · Sessions open in ${env.browsers[0].label}` : ''}.
        </span>
        <span>Only inspect sites you are authorized to access. Sessions stay in memory until you export them.</span>
      </footer>
    </div>
  );
}
