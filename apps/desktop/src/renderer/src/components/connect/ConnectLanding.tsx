import { FRAMEWORKS, STEP_TITLES, type Framework } from '../../lib/setup';
import { useHome } from '../../lib/home';

/** Tab B before setup starts: choose a framework, then open the guided flow. SDK details stay out of sight. */
export function ConnectLanding() {
  const { setup, chooseFramework, startSetup, resetSetup } = useHome();
  const inProgress = setup.step > 1 || !!setup.verifyBase;

  return (
    <div className="panel-body">
      <div>
        <h2 id="connect-title">Connect your application</h2>
        <p className="muted">See server requests alongside browser activity.</p>
      </div>

      <div className="fw-grid" role="radiogroup" aria-label="Your framework">
        {FRAMEWORKS.map((f) => (
          <label key={f.id} className={`fw-card ${setup.framework === f.id ? 'on' : ''}`}>
            <input type="radio" name="framework" checked={setup.framework === f.id} onChange={() => chooseFramework(f.id as Framework)} />
            <strong>{f.label}</strong>
            <span className="muted small">{f.blurb}</span>
          </label>
        ))}
      </div>

      <p className="muted">
        Add a small SDK to your app and TraceThrough lists its server <code>fetch</code> calls next to the browser requests that caused them. Your app
        and TraceThrough must run on the same computer.
      </p>

      <div className="actions">
        <button type="button" className="primary btn-lg" onClick={startSetup}>
          {inProgress ? `Continue setup · step ${setup.step} of 4: ${STEP_TITLES[setup.step - 1]}` : 'Get started'}
        </button>
        {inProgress && (
          <button type="button" className="link" onClick={resetSetup}>
            Start over
          </button>
        )}
      </div>
    </div>
  );
}
