import {
  register as registerNode,
  type FrameworkRequestContext,
  type TraceLensHandle,
  type TraceLensNodeOptions,
} from '@tracelens/node';

export type { TraceLensHandle, TraceLensNodeOptions };

/** Minimal view of Next.js's internal request store (`workUnitAsyncStorage`, type "request"). */
interface NextRequestStore {
  type?: string;
  headers?: { get(name: string): string | null };
  url?: { pathname: string; search: string };
}
interface StoreLike {
  getStore(): unknown;
}

const STORAGE_PREFIX = '@next/work-unit-async-storage@';
let storage: StoreLike | undefined;

/**
 * Next.js keeps the request being rendered in a global AsyncLocalStorage registered under
 * `Symbol.for('@next/work-unit-async-storage@<version>')` (Next 16). Reading it by prefix avoids
 * importing Next internals. Returns undefined on versions without it, falling back to the
 * SDK's own tracking.
 */
function findNextStorage(): StoreLike | undefined {
  if (storage) return storage;
  const g = globalThis as Record<symbol, unknown>;
  for (const sym of Object.getOwnPropertySymbols(g)) {
    if (!sym.description?.startsWith(STORAGE_PREFIX)) continue;
    const candidate = g[sym] as Partial<StoreLike> | undefined;
    if (typeof candidate?.getStore === 'function') return (storage = candidate as StoreLike);
  }
  return undefined;
}

export function nextRequestContext(): FrameworkRequestContext | undefined {
  const store = findNextStorage()?.getStore() as NextRequestStore | undefined;
  // Only real requests: prerender/cache stores have no incoming request to link to.
  if (store?.type !== 'request' || !store.headers) return undefined;
  return {
    traceparent: store.headers.get('traceparent') ?? undefined,
    path: store.url ? `${store.url.pathname}${store.url.search}` : undefined,
  };
}

/**
 * Call from `instrumentation.ts`. Only the Node.js runtime is supported; on the Edge runtime this
 * is a no-op. Import it dynamically inside a `NEXT_RUNTIME === 'nodejs'` check so Node built-ins
 * are never bundled for Edge:
 *
 * ```ts
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === 'nodejs') {
 *     const { register } = await import('@tracelens/next');
 *     register();
 *   }
 * }
 * ```
 */
export function register(opts?: TraceLensNodeOptions): TraceLensHandle | undefined {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return undefined;
  return registerNode({ requestContext: nextRequestContext, ...opts });
}
