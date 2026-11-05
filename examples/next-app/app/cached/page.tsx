import { upstream } from '../upstream';

// Statically generated and refreshed in the background every second: framework cache work that no
// browser request asked for, used to check TraceThrough never invents a trace for it.
export const revalidate = 1;

export default async function Cached() {
  const items = await fetch(`${upstream}/api/ok?case=cached`, { next: { revalidate: 1 } })
    .then((r) => r.json() as Promise<{ items: string[] }>)
    .then((d) => d.items)
    // The upstream is not running while `next build` prerenders this page.
    .catch(() => [] as string[]);
  return (
    <main>
      <h1>Cached page</h1>
      <p id="cached">Cached items: {items.join(', ')}</p>
    </main>
  );
}
