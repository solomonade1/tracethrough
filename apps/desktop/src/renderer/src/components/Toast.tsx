import { useEffect, useState } from 'react';
import { useInspector } from '../store';

/** One message at a time, bottom centre, gone after 1.5 s. */
export function Toast() {
  const toast = useInspector((s) => s.toast);
  const [visibleN, setVisibleN] = useState(0);

  useEffect(() => {
    if (!toast) return;
    setVisibleN(toast.n);
    const t = setTimeout(() => setVisibleN(0), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className={`toast ${toast && visibleN === toast.n ? 'on' : ''}`} aria-live="polite">
      {toast?.text}
    </div>
  );
}
