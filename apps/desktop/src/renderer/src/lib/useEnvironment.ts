import { useEffect, useState } from 'react';
import type { AppEnvironment } from '../../../shared/api';

let cached: Promise<AppEnvironment> | undefined;

/** Machine facts (version, platform, browsers). Asked once per window, then shared. */
export function useEnvironment(): AppEnvironment | undefined {
  const [env, setEnv] = useState<AppEnvironment | undefined>();
  useEffect(() => {
    cached ??= window.tracethrough.getEnvironment();
    let alive = true;
    cached.then(
      (e) => alive && setEnv(e),
      () => {
        cached = undefined;
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return env;
}
