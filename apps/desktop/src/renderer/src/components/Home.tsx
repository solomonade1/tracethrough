import { useState, type FormEvent } from 'react';
import { useInspector } from '../store';

export function Home() {
  const status = useInspector((s) => s.status);
  const [url, setUrl] = useState('https://');
  const [error, setError] = useState<string | undefined>();
  const starting = status.state === 'starting';

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    useInspector.getState().reset();
    const result = await window.tracelens.startSession(url.trim());
    if (!result.ok) setError(result.error);
  }

  return (
    <main className="home">
      <div className="home-brand">
        <span className="logo" aria-hidden>◎</span>
        <h1>TraceLens</h1>
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
          <button type="submit" className="primary" disabled={starting}>
            {starting ? 'Starting…' : 'Start session'}
          </button>
        </form>
        {(error ?? status.error) && (
          <p id="url-error" role="alert" className="error">
            {error ?? status.error}
          </p>
        )}
        <ul className="facts">
          <li>Only inspect sites you are authorized to access.</li>
          <li>
            You will see <strong>browser</strong> traffic. Calls the site's own servers make to other services are not
            visible.
          </li>
          <li>Sessions are kept in memory until you export them.</li>
        </ul>
      </section>

      <section className="card disabled" aria-disabled>
        <h2>Connect App</h2>
        <p className="muted">Instrument a Next.js / Node app you own to see its server-side calls. Coming in Phase 2.</p>
      </section>
    </main>
  );
}
