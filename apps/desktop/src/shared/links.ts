/**
 * Every outside link the app offers. The renderer may only ask main to open URLs that pass
 * `parseExternalUrl`, so a compromised page cannot turn "open link" into "open anything".
 */
export const REPO_URL = 'https://github.com/solomonade1/tracethrough';

/** GitHub redirects this to the newest release, so no version is hardcoded anywhere. */
export const RELEASES_LATEST_URL = `${REPO_URL}/releases/latest`;

export const NPM_URLS = {
  next: 'https://www.npmjs.com/package/@tracethrough/next',
  node: 'https://www.npmjs.com/package/@tracethrough/node',
  core: 'https://www.npmjs.com/package/@tracethrough/core',
} as const;

/** Documentation lives in this repository's `docs/` folder, one page per user journey. */
export const DOC_FILES = {
  index: 'README.md',
  gettingStarted: 'getting-started.md',
  inspectWebsite: 'inspect-a-website.md',
  connectNext: 'connect-nextjs.md',
  connectNode: 'connect-nodejs.md',
  inspectRequests: 'inspect-requests.md',
  exportSessions: 'export-sessions.md',
  privacy: 'privacy-and-sensitive-data.md',
  troubleshooting: 'troubleshooting.md',
  limitations: 'known-limitations.md',
} as const;

export type DocKey = keyof typeof DOC_FILES;

const DOCS_BASE = `${REPO_URL}/blob/main/docs`;

export const DOC_URLS = Object.fromEntries(
  Object.entries(DOC_FILES).map(([key, file]) => [key, `${DOCS_BASE}/${file}`]),
) as Record<DocKey, string>;

const ALLOWED: { host: string; prefix: string }[] = [
  { host: 'github.com', prefix: '/solomonade1/tracethrough' },
  { host: 'www.npmjs.com', prefix: '/package/@tracethrough' },
];

/** Returns the normalized URL when it is one of ours (https, no credentials, allowlisted path); throws otherwise. */
export function parseExternalUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid link');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid link');
  }
  const allowed = ALLOWED.some(
    (a) => url.hostname === a.host && (url.pathname === a.prefix || url.pathname.startsWith(`${a.prefix}/`)),
  );
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) {
    throw new Error('This link is not one TraceThrough opens');
  }
  return url.href;
}
