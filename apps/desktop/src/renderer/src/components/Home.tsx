import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useHome, type Mode } from '../lib/home';
import { useEnvironment } from '../lib/useEnvironment';
import { AppHeader } from './AppHeader';
import { InspectPanel } from './InspectPanel';
import { ConnectLanding } from './connect/ConnectLanding';
import { Wizard } from './connect/Wizard';

const TABS: { id: Mode; label: string; hint: string }[] = [
  { id: 'website', label: 'Inspect Website', hint: 'Any URL, no setup' },
  { id: 'app', label: 'Connect App', hint: 'Your Next.js or Node.js server' },
];

/** The launcher: one question, two paths. */
export function Home() {
  const { mode, setMode, setup } = useHome();
  const env = useEnvironment();
  const refs = useRef<Record<Mode, HTMLButtonElement | null>>({ website: null, app: null });

  // Ready to type when Home appears (first launch, or back from a session). Not on tab switches:
  // that would pull focus out of the tab list while someone is arrowing through it.
  useEffect(() => {
    if (useHome.getState().mode === 'website') document.getElementById('target-url')?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === mode);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    setMode(TABS[next]!.id);
    refs.current[TABS[next]!.id]?.focus();
  }

  return (
    <div className="home">
      <AppHeader />

      <main className="home-main">
        <div className="home-intro">
          <h1>What would you like to inspect?</h1>
          <p className="lede">Capture network requests from a website or your own application.</p>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="What to inspect" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={mode === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={mode === t.id ? 0 : -1}
              className={mode === t.id ? 'on' : ''}
              onClick={() => setMode(t.id)}
            >
              <strong>{t.label}</strong>
              <span className="muted small">{t.hint}</span>
            </button>
          ))}
        </div>

        <section className="mode-panel" role="tabpanel" id={`panel-${mode}`} aria-labelledby={`tab-${mode}`}>
          {mode === 'website' ? <InspectPanel /> : setup.active ? <Wizard /> : <ConnectLanding />}
        </section>
      </main>

      <footer className="home-foot muted small">
        <span>
          Runs on this computer. No account, no cloud
          {env && env.browsers[0] ? ` · Sessions open in ${env.browsers[0].label}` : ''}.
        </span>
      </footer>
    </div>
  );
}
