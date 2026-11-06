import { RELEASES_LATEST_URL } from '../../../shared/links';
import { useEnvironment } from '../lib/useEnvironment';
import { BrandMark } from './BrandMark';
import { DocsMenu } from './DocsMenu';
import { ThemeMenu } from './ThemeMenu';

/** Home header: brand and version on the left; docs, a download link (browser mode only) and the theme on the right. */
export function AppHeader() {
  const env = useEnvironment();
  return (
    <header className="home-brand">
      <BrandMark size={26} />
      <span className="home-name">TraceThrough</span>
      {env && <span className="muted small">v{env.version}</span>}
      <span className="spacer" />
      {env?.runtime === 'web' && (
        <button type="button" className="btn" onClick={() => void window.tracethrough.openExternal(RELEASES_LATEST_URL).catch(() => {})}>
          Download TraceThrough
        </button>
      )}
      <DocsMenu />
      <ThemeMenu />
    </header>
  );
}
