import { useEffect, useRef, useState } from 'react';
import { useHome, type WizardStep } from '../../lib/home';
import { STEP_TITLES } from '../../lib/setup';
import { useConnectInfo } from '../../lib/useConnectInfo';
import { ChooseStep, ConfigureStep, InstallStep, VerifyStep } from './steps';

/** Re-renders every `ms` while mounted, so "no events after 30 seconds" can appear without any other change. */
function useNow(ms: number, on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

/** The four-step Connect App flow. Progress lives in the home store, so leaving and returning resumes it. */
export function Wizard() {
  const { setup, goToStep, exitSetup } = useHome();
  const collector = useConnectInfo(1000);
  const now = useNow(1000, setup.step === 4);
  const heading = useRef<HTMLHeadingElement>(null);
  const fw = setup.framework;
  const step = setup.step;

  // Moving between steps moves focus to the new step's heading so keyboard and screen-reader users follow along.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  // Landing on Verify (e.g. via the stepper) records the counters it will measure against.
  useEffect(() => {
    if (step === 4 && !setup.verifyBase && collector.info) goToStep(4, collector.info);
  }, [step, setup.verifyBase, collector.info, goToStep]);

  const go = (next: WizardStep) => goToStep(next, collector.info);
  const canAdvance = step === 1 ? !!fw : true;

  return (
    <div className="panel-body wizard">
      <ol className="stepper" aria-label="Setup steps">
        {STEP_TITLES.map((title, i) => {
          const n = (i + 1) as WizardStep;
          return (
            <li key={title} className={n === step ? 'current' : n < step ? 'done' : ''}>
              <button type="button" aria-current={n === step ? 'step' : undefined} disabled={n > 1 && !fw} onClick={() => go(n)}>
                <span className="step-num" aria-hidden="true">
                  {n < step ? '✓' : n}
                </span>
                <span className="step-title">{title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <h2 ref={heading} tabIndex={-1} id="wizard-title">
        <span className="muted small">Step {step} of 4 · </span>
        {STEP_TITLES[step - 1]}
      </h2>

      {step === 1 && <ChooseStep />}
      {step === 2 && fw && <InstallStep fw={fw} />}
      {step === 3 && fw && <ConfigureStep fw={fw} collector={collector} />}
      {step === 4 && fw && <VerifyStep fw={fw} collector={collector} now={now} />}

      <div className="wizard-foot">
        <button type="button" className="link" onClick={exitSetup}>
          Exit setup
        </button>
        <span className="spacer" />
        {step > 1 && (
          <button type="button" className="btn" onClick={() => go((step - 1) as WizardStep)}>
            Back
          </button>
        )}
        {step < 4 && (
          <>
            {!canAdvance && <span className="muted small">Choose a framework to continue</span>}
            <button type="button" className="primary" disabled={!canAdvance} onClick={() => go((step + 1) as WizardStep)}>
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
