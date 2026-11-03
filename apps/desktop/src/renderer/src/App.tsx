import { useEffect } from 'react';
import { Home } from './components/Home';
import { Workspace } from './components/Workspace';
import { useInspector } from './store';

export function App() {
  const state = useInspector((s) => s.status.state);

  useEffect(() => {
    const { applyBatch, setStatus } = useInspector.getState();
    const offEvents = window.tracethrough.onEvents(applyBatch);
    const offStatus = window.tracethrough.onStatus(setStatus);
    return () => {
      offEvents();
      offStatus();
    };
  }, []);

  return state === 'idle' || state === 'starting' ? <Home /> : <Workspace />;
}
