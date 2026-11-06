import type { NetworkEvent } from '@tracethrough/core';
import { BodyViewer } from '../BodyViewer';

export function ResponseTab({ e }: { e: NetworkEvent }) {
  return (
    <BodyViewer
      key={`${e.id}-res`}
      event={e}
      body={e.responseBody}
      which="response"
      absentText={e.state === 'pending' ? 'Waiting for response…' : 'No response body (request did not complete).'}
    />
  );
}
