import { useEffect, useState } from 'react';
import type { ConnectInfo } from '../../../shared/api';

/** Live collector status: polled while the component is mounted. `unreachable` is true once a poll fails. */
export function useConnectInfo(intervalMs = 1500): {
  info: ConnectInfo | undefined;
  unreachable: boolean;
  refresh(info: ConnectInfo): void;
} {
  const [info, setInfo] = useState<ConnectInfo | undefined>();
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      window.tracethrough.getConnectInfo().then(
        (next) => {
          if (!alive) return;
          setInfo(next);
          setUnreachable(false);
        },
        () => alive && setUnreachable(true),
      );
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { info, unreachable, refresh: setInfo };
}
