import type { TraceThroughApi } from '../../shared/api';

declare global {
  interface Window {
    tracethrough: TraceThroughApi;
  }
}
