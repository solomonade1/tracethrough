import type { NetworkEvent } from '@tracethrough/core';
import { copyText } from '../../lib/clipboard';
import { BodyViewer } from '../BodyViewer';
import { KeyValues, SectionHead } from './shared';

function queryRows(url: string): [string, string][] {
  try {
    return [...new URL(url).searchParams];
  } catch {
    return [];
  }
}

export function RequestTab({ e }: { e: NetworkEvent }) {
  const query = queryRows(e.urlSanitized);
  const noBody = e.method === 'GET' || e.method === 'HEAD' ? 'GET requests have no body.' : 'No request body.';
  return (
    <>
      <div className="pscroll fixed">
        <section aria-label="Query parameters">
          <SectionHead
            title="Query parameters"
            count={query.length}
            onCopy={query.length ? () => void copyText(new URL(e.urlSanitized).search.slice(1), 'query string') : undefined}
          />
          <KeyValues rows={query} empty="No query parameters." />
        </section>
        <SectionHead title="Body" />
      </div>
      <BodyViewer key={`${e.id}-req`} event={e} body={e.requestBody} which="request" absentText={e.method === 'GET' || e.method === 'HEAD' ? 'GET requests have no body.' : noBody} />
    </>
  );
}
