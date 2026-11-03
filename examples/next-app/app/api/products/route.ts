import { upstream } from '../../upstream';

export const dynamic = 'force-dynamic';

// Route handler: the browser calls this, and it calls upstream server-side.
export async function GET() {
  const stock = await fetch(`${upstream}/api/slow?ms=40`, { cache: 'no-store' }).then((r) => r.json());
  return Response.json(stock);
}
