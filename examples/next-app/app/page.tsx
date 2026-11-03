import { Stock } from './stock';
import { apiKey, upstream } from './upstream';

// Rendered per request so the SSR fetch below happens on every navigation.
export const dynamic = 'force-dynamic';

export default async function Page() {
  // Server-side fetch during render: App Connect links it to the browser's document request.
  const catalog = await fetch(`${upstream}/api/ok?api_key=${apiKey}`, { cache: 'no-store' }).then((r) => r.json());
  return (
    <main>
      <h1>Sample shop (Next.js)</h1>
      <p id="ssr">SSR items: {catalog.items.join(', ')}</p>
      <Stock />
    </main>
  );
}
