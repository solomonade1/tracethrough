import { toCurl } from '@tracethrough/core';
import { copyText } from '../lib/clipboard';
import { useInspector } from '../store';

/** Appears under the table while rows are ticked. */
export function SelectionBar() {
  const picked = useInspector((s) => s.picked);
  const events = useInspector((s) => s.events);
  const clearPicked = useInspector((s) => s.clearPicked);
  const openExport = useInspector((s) => s.openExport);
  const n = picked.size;
  if (!n) return null;

  function copyCurl() {
    const chosen = events.filter((e) => picked.has(e.id));
    void copyText(chosen.map(toCurl).join('\n\n'), `${chosen.length} cURL command${chosen.length === 1 ? '' : 's'}`);
  }

  return (
    <div className="selbar" role="region" aria-label="Selection">
      <b>
        {n} {n === 1 ? 'request' : 'requests'} selected
      </b>
      <span className="spacer" />
      <button type="button" className="btn sm" onClick={copyCurl}>
        Copy as cURL
      </button>
      <button type="button" className="btn sm" onClick={() => openExport('sel')}>
        Export selected
      </button>
      <button type="button" className="link" onClick={clearPicked}>
        Clear selection
      </button>
    </div>
  );
}
