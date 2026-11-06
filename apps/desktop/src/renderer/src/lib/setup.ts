import { NPM_URLS, DOC_URLS } from '../../../shared/links';

/**
 * Connect App setup content. Everything here mirrors the published SDKs (@tracethrough/next and
 * @tracethrough/node 0.3.x: README, exports, env var names); `setup.test.ts` fails if a snippet drifts
 * from the package READMEs.
 */
export type Framework = 'next' | 'node';
export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export type ShellKind = 'bash' | 'powershell' | 'dotenv';

export const FRAMEWORKS: { id: Framework; label: string; blurb: string }[] = [
  { id: 'next', label: 'Next.js', blurb: 'Server components, route handlers and server actions on the Node.js runtime.' },
  { id: 'node', label: 'Node.js', blurb: 'Any Node.js server that makes outgoing requests with the built-in fetch.' },
];

export const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn'];

export const SHELLS: { id: ShellKind; label: string }[] = [
  { id: 'bash', label: 'macOS / Linux / Git Bash' },
  { id: 'powershell', label: 'Windows PowerShell' },
  { id: 'dotenv', label: '.env file' },
];

export const PACKAGE_NAME: Record<Framework, string> = { next: '@tracethrough/next', node: '@tracethrough/node' };
export const NPM_PAGE: Record<Framework, string> = { next: NPM_URLS.next, node: NPM_URLS.node };
export const SETUP_DOC: Record<Framework, string> = { next: DOC_URLS.connectNext, node: DOC_URLS.connectNode };
export const FRAMEWORK_LABEL: Record<Framework, string> = { next: 'Next.js', node: 'Node.js' };

export const STEP_TITLES = ['Choose framework', 'Install SDK', 'Configure', 'Verify connection'] as const;

export function installCommand(pm: PackageManager, fw: Framework): string {
  return `${pm === 'npm' ? 'npm install' : `${pm} add`} ${PACKAGE_NAME[fw]}`;
}

export function devCommand(pm: PackageManager, fw: Framework): string {
  if (fw === 'node') return 'node server.js';
  return pm === 'npm' ? 'npm run dev' : `${pm} dev`;
}

export const NEXT_SNIPPET = `// instrumentation.ts (project root, or src/)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('@tracethrough/next');
    register();
  }
}`;

export const NODE_SNIPPET = `// first import in your server entry
import { register } from '@tracethrough/node';

register();`;

export const NODE_CHECK_SNIPPET = `const handle = register();
console.log(handle.enabled ? 'TraceThrough connected' : \`TraceThrough off: \${handle.disabledReason}\`);`;

export function snippetFor(fw: Framework): string {
  return fw === 'next' ? NEXT_SNIPPET : NODE_SNIPPET;
}

/** What the setup screen shows in place of the collector token. */
export const TOKEN_MASK = '••••••••••••••••';

export interface EnvBlock {
  label: string;
  text: string;
  /** Short instruction shown above the block. */
  hint: string;
}

/**
 * Environment variables for the user's app, written for their shell. Pass `TOKEN_MASK` for what is shown
 * on screen and the real token for what the Copy button puts on the clipboard.
 */
export function envBlock(opts: { shell: ShellKind; fw: Framework; pm: PackageManager; collectorUrl: string; token: string }): EnvBlock {
  const { shell, fw, pm, collectorUrl, token } = opts;
  const run = devCommand(pm, fw);
  if (shell === 'powershell') {
    return {
      label: 'PowerShell',
      hint: 'Run this in the terminal you start your app from. It sets the variables for that window only.',
      text: `$env:TRACETHROUGH_COLLECTOR_URL="${collectorUrl}"; $env:TRACETHROUGH_TOKEN="${token}"; ${run}`,
    };
  }
  if (shell === 'dotenv') {
    const file = fw === 'next' ? '.env.local' : '.env';
    const vars = `TRACETHROUGH_COLLECTOR_URL=${collectorUrl}\nTRACETHROUGH_TOKEN=${token}`;
    return {
      label: file,
      hint:
        fw === 'next'
          ? 'Save as .env.local in the project root (keep it out of version control). Next.js loads it on start.'
          : 'Save as .env (keep it out of version control), then start with --env-file (Node.js 20.6 or later).',
      text: fw === 'next' ? vars : `${vars}\n\n# start with:\nnode --env-file=.env server.js`,
    };
  }
  return {
    label: 'Terminal',
    hint: 'Run this in the terminal you start your app from.',
    text: `TRACETHROUGH_COLLECTOR_URL=${collectorUrl} TRACETHROUGH_TOKEN=${token} ${run}`,
  };
}

export function defaultShell(platform: string | undefined): ShellKind {
  return platform === 'win32' ? 'powershell' : 'bash';
}

export interface Tip {
  title: string;
  body: string;
}

/** Targeted troubleshooting; the most relevant tips for the current verification state come first. */
export function troubleshootingTips(fw: Framework, state: 'waiting' | 'detected' | 'connected' | 'issue' | 'none', collectorProblem: boolean): Tip[] {
  const setup: Tip[] =
    fw === 'next'
      ? [
          { title: 'instrumentation.ts is in the right place', body: 'It belongs in the project root, or in src/ if your app uses a src folder, next to (not inside) the app folder.' },
          { title: 'Node.js runtime only', body: 'The SDK does nothing on the Edge runtime. Server components, route handlers and server actions on the Node.js runtime are supported.' },
          { title: 'Restart after installing', body: 'Stop and start the dev server so Next.js picks up instrumentation.ts and the environment variables.' },
        ]
      : [
          { title: 'register() runs first', body: 'Call register() before your server makes any request, ideally as the first import in your entry file.' },
          { title: 'Check what the SDK says', body: 'register() returns a handle. Log handle.enabled and handle.disabledReason (shown under Advanced in the Configure step) to see why it is off.' },
          { title: 'Restart after installing', body: 'Stop and start your server so it loads the new code and environment variables.' },
        ];
  const env: Tip = {
    title: 'Both variables are set in the process that runs your app',
    body: 'TRACETHROUGH_COLLECTOR_URL and TRACETHROUGH_TOKEN must both be set in the same terminal (or .env file) your app starts from. The SDK stays silent when either is missing.',
  };
  const prod: Tip = {
    title: 'Not running in production mode',
    body: 'The SDK is off when NODE_ENV=production unless you set TRACETHROUGH_ALLOW_PRODUCTION=1. Use your development server.',
  };
  const local: Tip = {
    title: 'App and TraceThrough on the same machine',
    body: 'The collector only accepts connections from this computer (127.0.0.1). Remote and container-to-host setups are not supported.',
  };
  const fetchOnly: Tip = {
    title: 'Make a server-side fetch',
    body: 'Only Node fetch calls made on the server are recorded. Load a page or API route that fetches data on the server. Axios and node:http clients are not recorded yet.',
  };
  const token: Tip = {
    title: 'Copy the connection details again',
    body: 'A rejected request usually means an old token or port. Regenerating the token, or the collector falling back to another port when 47811 is busy, changes what your app needs. Copy the Configure step again and restart your app.',
  };
  const session: Tip = {
    title: 'Start a session with “This is my app”',
    body: 'Server events are only kept while a session is recording. Start one for your app’s URL with “This is my app” ticked, then reload the page.',
  };
  if (collectorProblem) return [token, local, ...setup];
  if (state === 'issue') return [token, env, local, ...setup];
  if (state === 'detected') return [session, fetchOnly];
  if (state === 'connected') return [fetchOnly, session];
  return [env, ...setup, prod, local, fetchOnly];
}
