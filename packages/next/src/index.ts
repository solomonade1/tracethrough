import { register as registerNode, type TraceLensHandle, type TraceLensNodeOptions } from '@tracelens/node';

export type { TraceLensHandle, TraceLensNodeOptions };

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
  return registerNode(opts);
}
