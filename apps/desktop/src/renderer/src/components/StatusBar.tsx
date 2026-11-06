import { useMemo } from 'react';
import { triggerOf } from '../lib/rows';
import { useLinks } from '../lib/useLinks';
import { useInspector } from '../store';

export function StatusBar() {
  const events = useInspector((s) => s.events);
  const dropped = useInspector((s) => s.status.dropped);
  const links = useLinks();
  const counts = useMemo(() => {
    let linked = 0;
    let unlinked = 0;
    let failed = 0;
    for (const e of events) {
      if (e.state === 'failed') failed++;
      if (e.source === 'server') (triggerOf(links, e) ? linked++ : unlinked++);
    }
    return { linked, unlinked, failed };
  }, [events, links]);

  return (
    <footer className="statusbar">
      <span>
        <b>{events.length}</b> requests
      </span>
      <span>
        <b>{counts.linked}</b> server calls linked
      </span>
      <span>
        <b>{counts.unlinked}</b> not linked
      </span>
      <span>
        <b>{counts.failed}</b> failed
      </span>
      <span className="spacer" />
      {dropped > 0 ? <span className="warn">{dropped} dropped (session cap)</span> : <span>No dropped events · cap 10,000</span>}
      <span>Arrow keys move through the list</span>
    </footer>
  );
}
