import { toHar, type BodyPreview, type NetworkEvent } from '@tracethrough/core';
import { extForMime, saveNameFor } from '../format';
import { useInspector } from '../store';

async function save(request: Parameters<typeof window.tracethrough.saveFile>[0]): Promise<void> {
  const { showToast } = useInspector.getState();
  try {
    const result = await window.tracethrough.saveFile(request);
    if (result.saved) showToast(`Saved ${result.path}`);
  } catch (err) {
    showToast(`Couldn't save: ${(err as Error).message}`);
  }
}

/** The body preview exactly as captured. */
export function saveBody(e: NetworkEvent, body: BodyPreview): Promise<void> {
  const ext = extForMime(body.mime);
  return save({ suggestedName: saveNameFor(e, ext), content: body.preview ?? '', kind: ext === 'json' ? 'json' : 'text' });
}

/** One request as a valid single-entry HAR 1.2 file. */
export async function saveRequestAsHar(e: NetworkEvent): Promise<void> {
  const { masked } = useInspector.getState().status;
  let version = '0.0.0';
  try {
    version = (await window.tracethrough.getEnvironment()).version;
  } catch {
    /* the version is cosmetic */
  }
  return save({ suggestedName: saveNameFor(e, 'har'), content: JSON.stringify(toHar([e], version, masked ?? true), null, 2), kind: 'har' });
}

/** The whole captured exchange (request and response) in TraceThrough's own event shape. */
export function saveExchange(e: NetworkEvent): Promise<void> {
  return save({ suggestedName: saveNameFor(e, 'json'), content: JSON.stringify(e, null, 2), kind: 'json' });
}
