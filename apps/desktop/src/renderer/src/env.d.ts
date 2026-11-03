import type { TraceLensApi } from '../../shared/api';

declare global {
  interface Window {
    tracelens: TraceLensApi;
  }
}
