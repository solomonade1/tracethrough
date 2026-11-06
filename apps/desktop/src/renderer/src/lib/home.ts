import { create } from 'zustand';
import type { ConnectInfo } from '../../../shared/api';
import { baseFrom, type VerifyBase } from './verify';
import type { Framework, PackageManager, ShellKind } from './setup';

export type Mode = 'website' | 'app';
export type WizardStep = 1 | 2 | 3 | 4;

const PM_KEY = 'tt.packageManager';

function loadPm(): PackageManager {
  try {
    const v = localStorage.getItem(PM_KEY);
    if (v === 'npm' || v === 'pnpm' || v === 'yarn') return v;
  } catch {
    /* storage may be unavailable */
  }
  return 'npm';
}

interface HomeState {
  mode: Mode;
  /** What is typed in the URL box; kept so switching tabs or finishing setup never loses it. */
  url: string;
  mask: boolean;
  connect: boolean;
  setup: {
    /** The wizard is on screen. Leaving it keeps `step`, `framework` and the rest, so setup can resume. */
    active: boolean;
    step: WizardStep;
    framework: Framework | undefined;
    pm: PackageManager;
    shell: ShellKind | undefined;
    /** Collector counters when the Verify step began (or was retried). */
    verifyBase: VerifyBase | undefined;
  };
  setMode(mode: Mode): void;
  setUrl(url: string): void;
  setMask(on: boolean): void;
  setConnect(on: boolean): void;
  /** Back to the defaults (masking off, "This is my app" off) so each session starts from an explicit choice. The URL is kept. */
  resetSessionPrefs(): void;
  chooseFramework(fw: Framework): void;
  startSetup(): void;
  goToStep(step: WizardStep, info?: ConnectInfo): void;
  exitSetup(): void;
  resetSetup(): void;
  setPackageManager(pm: PackageManager): void;
  setShell(shell: ShellKind): void;
  retryVerify(info: ConnectInfo | undefined): void;
  /** Wizard finished: go inspect the app with "This is my app" on. */
  inspectApp(): void;
}

export const useHome = create<HomeState>((set, get) => ({
  mode: 'website',
  url: '',
  mask: false,
  connect: false,
  setup: { active: false, step: 1, framework: undefined, pm: loadPm(), shell: undefined, verifyBase: undefined },

  setMode: (mode) => set({ mode }),
  setUrl: (url) => set({ url }),
  setMask: (mask) => set({ mask }),
  setConnect: (connect) => set({ connect }),
  resetSessionPrefs: () => set({ mask: false, connect: false }),

  chooseFramework: (framework) => set((s) => ({ setup: { ...s.setup, framework } })),
  // A framework picked on the Connect tab skips straight to Install; Back still reaches the choice.
  startSetup: () =>
    set((s) => ({
      mode: 'app',
      setup: { ...s.setup, active: true, step: s.setup.framework && s.setup.step === 1 ? 2 : s.setup.step },
    })),
  goToStep: (step, info) =>
    set((s) => ({
      setup: {
        ...s.setup,
        step,
        // Verification starts counting from the first time the Verify step opens, not from each visit.
        verifyBase: step === 4 && !s.setup.verifyBase ? baseFrom(info, Date.now()) : s.setup.verifyBase,
      },
    })),
  exitSetup: () => set((s) => ({ setup: { ...s.setup, active: false } })),
  resetSetup: () =>
    set((s) => ({ setup: { ...s.setup, active: false, step: 1, framework: undefined, verifyBase: undefined } })),
  setPackageManager: (pm) => {
    try {
      localStorage.setItem(PM_KEY, pm);
    } catch {
      /* storage may be unavailable */
    }
    set((s) => ({ setup: { ...s.setup, pm } }));
  },
  setShell: (shell) => set((s) => ({ setup: { ...s.setup, shell } })),
  retryVerify: (info) => set((s) => ({ setup: { ...s.setup, verifyBase: baseFrom(info, Date.now()) } })),
  inspectApp: () => {
    const { url, setup } = get();
    // Next.js dev servers listen on 3000 unless told otherwise; Node apps pick their own port.
    const suggested = !url.trim() && setup.framework === 'next' ? 'http://localhost:3000' : url;
    set({ mode: 'website', connect: true, url: suggested, setup: { ...setup, active: false } });
  },
}));
