import { useEffect, useState } from 'react';
import type { ConnectInfo } from '../../../../shared/api';
import { useHome } from '../../lib/home';
import {
  FRAMEWORKS,
  FRAMEWORK_LABEL,
  NODE_CHECK_SNIPPET,
  NPM_PAGE,
  PACKAGE_MANAGERS,
  PACKAGE_NAME,
  SETUP_DOC,
  SHELLS,
  TOKEN_MASK,
  defaultShell,
  envBlock,
  installCommand,
  snippetFor,
  troubleshootingTips,
  type Framework,
} from '../../lib/setup';
import { deriveVerification } from '../../lib/verify';
import { useEnvironment } from '../../lib/useEnvironment';
import { CodeBlock } from '../CodeBlock';
import { ExternalLink } from '../ExternalLink';

interface Collector {
  info: ConnectInfo | undefined;
  unreachable: boolean;
  refresh(info: ConnectInfo): void;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.id} className={value === o.id ? 'on' : ''}>
          <input type="radio" name={label} checked={value === o.id} onChange={() => onChange(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function ChooseStep() {
  const { setup, chooseFramework } = useHome();
  return (
    <>
      <p className="muted">Which kind of app do you want to connect?</p>
      <div className="fw-grid" role="radiogroup" aria-label="Framework">
        {FRAMEWORKS.map((f) => (
          <label key={f.id} className={`fw-card ${setup.framework === f.id ? 'on' : ''}`}>
            <input type="radio" name="wizard-framework" checked={setup.framework === f.id} onChange={() => chooseFramework(f.id)} />
            <strong>{f.label}</strong>
            <span className="muted small">{f.blurb}</span>
          </label>
        ))}
      </div>
      <p className="muted small">Needs Node.js 20 or later. Other frameworks and runtimes (such as the Edge runtime) are not supported yet.</p>
    </>
  );
}

export function InstallStep({ fw }: { fw: Framework }) {
  const { setup, setPackageManager } = useHome();
  return (
    <>
      <p className="muted">Add the SDK to your project. It works with npm, pnpm and yarn.</p>
      <Segmented
        label="Package manager"
        value={setup.pm}
        options={PACKAGE_MANAGERS.map((id) => ({ id, label: id }))}
        onChange={setPackageManager}
      />
      <CodeBlock label="Install command" text={installCommand(setup.pm, fw)} />
      <p className="muted small">
        {fw === 'next' && (
          <>
            <code>{PACKAGE_NAME.next}</code> includes <code>{PACKAGE_NAME.node}</code>.{' '}
          </>
        )}
        <ExternalLink href={NPM_PAGE[fw]}>Open npm package</ExternalLink>
      </p>
    </>
  );
}

export function ConfigureStep({ fw, collector }: { fw: Framework; collector: Collector }) {
  const { setup, setShell } = useHome();
  const env = useEnvironment();
  const [showToken, setShowToken] = useState(false);
  const { info } = collector;
  const shell = setup.shell ?? defaultShell(env?.platform);

  if (!info) return <p className="muted">Checking the collector…</p>;
  if (!info.listening || !info.collectorUrl || !info.token) {
    return (
      <div className="notice-card bad" role="alert">
        <strong>The collector is not running</strong>
        <span>{info.error ?? 'TraceThrough could not start its local collector.'} Your app has nowhere to send events. Restart TraceThrough, then come back.</span>
      </div>
    );
  }

  const base = { shell, fw, pm: setup.pm, collectorUrl: info.collectorUrl };
  const shown = envBlock({ ...base, token: showToken ? info.token : TOKEN_MASK });
  const real = envBlock({ ...base, token: info.token });

  return (
    <>
      <section className="sub">
        <h4>1. Register the SDK</h4>
        <CodeBlock label={fw === 'next' ? 'instrumentation.ts' : 'Server entry'} text={snippetFor(fw)} />
        {fw === 'node' && <p className="muted small">Put this before your server makes any request.</p>}
      </section>

      <section className="sub">
        <h4>2. Start your app with the connection details</h4>
        <Segmented label="Where you run your app" value={shell} options={SHELLS} onChange={setShell} />
        <p className="muted small">{real.hint}</p>
        <CodeBlock
          label={real.label}
          text={shown.text}
          copyText={real.text}
          actions={
            <button type="button" className="btn sm" onClick={() => setShowToken((v) => !v)} aria-pressed={showToken}>
              {showToken ? 'Hide token' : 'Show token'}
            </button>
          }
        />
        <p className="muted small" role="status">
          Collector listening on <code>{info.collectorUrl}</code> (this computer only). The token stays on this machine; Copy puts the real one on your clipboard.
        </p>
      </section>

      <details className="disclosure">
        <summary>Advanced</summary>
        <ul>
          <li>
            Off when <code>NODE_ENV=production</code>. To opt in, set <code>TRACETHROUGH_ALLOW_PRODUCTION=1</code>. It is not enabled by default.
          </li>
          <li>
            Server bodies are previewed up to 64 KB each. <code>TRACETHROUGH_CAPTURE_BODIES=0</code> turns body capture off;{' '}
            <code>allowTargets</code> restricts which hosts are recorded; <code>TRACETHROUGH_DISABLED=1</code> forces the SDK off.
          </li>
          {fw === 'next' && (
            <li>
              Next.js’s own telemetry calls show up as unlinked Server rows. Set <code>NEXT_TELEMETRY_DISABLED=1</code> to hide them.
            </li>
          )}
          <li>The SDK sends values as captured. Whether they are masked is decided by each session’s “Mask secrets” setting.</li>
        </ul>
        {fw === 'node' && <CodeBlock label="Check that it is on" text={NODE_CHECK_SNIPPET} />}
        <p className="small">
          <button
            type="button"
            className="link"
            onClick={() => {
              if (confirm('Regenerate the token? Apps using the current token will stop sending until you update them.'))
                void window.tracethrough.regenerateToken().then(collector.refresh);
            }}
          >
            Regenerate token
          </button>
        </p>
      </details>
    </>
  );
}

export function VerifyStep({ fw, collector, now }: { fw: Framework; collector: Collector; now: number }) {
  const { setup, retryVerify, inspectApp } = useHome();
  const result = deriveVerification({ info: collector.info, unreachable: collector.unreachable, base: setup.verifyBase, now });
  const tips = troubleshootingTips(fw, result.state, result.collectorProblem);
  const tone = result.state === 'connected' ? 'ok' : result.state === 'issue' ? 'bad' : result.state === 'waiting' ? 'idle' : 'warn';

  // Details open on their own when something needs attention.
  const [open, setOpen] = useState(result.state === 'issue' || result.state === 'none');
  useEffect(() => {
    if (result.state === 'issue' || result.state === 'none') setOpen(true);
  }, [result.state]);

  return (
    <>
      <ol className="todo">
        <li>
          Start, or restart, your {FRAMEWORK_LABEL[fw]} app with the connection details from the last step.
        </li>
        <li>
          Load a page or API route that makes a server-side <code>fetch</code>.
        </li>
        <li>
          Start an inspection session for your app with <b>This is my app</b> ticked, so server calls can be linked to the browser request that caused them.
        </li>
      </ol>

      <div className={`notice-card ${tone}`} role="status" aria-live="polite">
        <strong>
          <span className={`dot ${tone === 'idle' ? 'off' : tone}`} aria-hidden="true" /> {result.title}
        </strong>
        <span>{result.detail}</span>
        {collector.info?.listening && (
          <span className="muted small">
            {collector.info.received} server event{collector.info.received === 1 ? '' : 's'} received and {collector.info.ignored} set aside since
            TraceThrough started.
          </span>
        )}
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={inspectApp}>
          Inspect my app
        </button>
        <button type="button" className="btn" onClick={() => retryVerify(collector.info)}>
          Retry
        </button>
      </div>

      <details className="disclosure" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Troubleshooting</summary>
        <ul>
          {tips.map((t) => (
            <li key={t.title}>
              <b>{t.title}.</b> {t.body}
            </li>
          ))}
        </ul>
      </details>
      <p className="small">
        <ExternalLink href={SETUP_DOC[fw]}>Read full documentation</ExternalLink>
      </p>
    </>
  );
}
