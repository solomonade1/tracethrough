import { useRef, useState, type FormEvent } from 'react';
import { useInspector } from '../store';
import { useHome } from '../lib/home';
import { checkUrlInput } from '../lib/url';
import { useEnvironment } from '../lib/useEnvironment';

/** Tab A: type a URL, start a session. Nothing about SDKs or servers lives here. */
export function InspectPanel() {
  const status = useInspector((s) => s.status);
  const { url, mask, connect, setUrl, setMask, setConnect, setMode } = useHome();
  const env = useEnvironment();
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const starting = status.state === 'starting';
  const noBrowser = env !== undefined && env.browsers.length === 0;
  const shownError = error ?? status.error;

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const check = checkUrlInput(url);
    if (!check.ok) {
      setError(check.error);
      input.current?.focus();
      return;
    }
    useInspector.getState().reset();
    const result = await window.tracethrough.startSession(check.url, { connect, mask });
    if (!result.ok) {
      setError(result.error);
      input.current?.focus();
    }
  }

  return (
    <div className="panel-body">
      <div>
        <h2 id="inspect-title">Inspect a website</h2>
        <p className="muted">Enter a URL to see network requests as you browse.</p>
      </div>

      <form onSubmit={start} className="url-form" noValidate>
        <label htmlFor="target-url" className="sr-only">
          URL to inspect
        </label>
        <input
          ref={input}
          id="target-url"
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(undefined);
          }}
          placeholder="https://example.com"
          aria-invalid={!!shownError}
          aria-describedby={shownError ? 'url-error' : undefined}
        />
        <button type="submit" className="primary" disabled={starting || noBrowser}>
          {starting ? 'Starting…' : 'Start session'}
        </button>
      </form>

      {shownError && (
        <p id="url-error" role="alert" className="error">
          {shownError}
        </p>
      )}
      {noBrowser && (
        <p role="alert" className="error">
          TraceThrough needs Google Chrome or Microsoft Edge to open sites. Install one, then restart TraceThrough.
        </p>
      )}

      <fieldset className="prefs">
        <legend className="sr-only">Session preferences</legend>
        <label className="pref">
          <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />
          <span>
            <strong>Mask secrets</strong>
            <span className="muted small">
              {mask
                ? 'Cookies, tokens and API keys are hidden in the list and in exports.'
                : 'Off: values are shown exactly as captured, including cookies and tokens.'}
            </span>
          </span>
        </label>
        <div className="pref">
          <input id="pref-connect" type="checkbox" checked={connect} onChange={(e) => setConnect(e.target.checked)} />
          <span>
            <label htmlFor="pref-connect">
              <strong>This is my app</strong>
            </label>
            <span className="muted small">
              Also show your server’s fetch calls. Adds a <code>traceparent</code> header to this site’s requests only.{' '}
              <button type="button" className="link" onClick={() => setMode('app')}>
                Set up Connect App
              </button>
            </span>
          </span>
        </div>
      </fieldset>

      <details className="disclosure">
        <summary>About this session</summary>
        <ul>
          <li>
            {env?.browsers[0] ? `Opens in ${env.browsers[0].label}` : 'Opens in Chrome or Edge'} with a fresh, separate profile: no cookies, no
            extensions.
          </li>
          <li>
            Without <b>This is my app</b> you see browser traffic only. A site’s own server-side requests are not visible.
          </li>
          <li>Sessions stay in memory on this computer until you export them. Only inspect sites you are authorized to access.</li>
        </ul>
      </details>
    </div>
  );
}
