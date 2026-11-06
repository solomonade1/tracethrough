import { DOC_URLS, NPM_URLS, RELEASES_LATEST_URL } from '../../../shared/links';
import { MenuButton, type MenuEntry } from './Menu';

function open(url: string) {
  void window.tracethrough.openExternal(url).catch(() => {});
}

const ENTRIES: MenuEntry[] = [
  { kind: 'label', label: 'Guides' },
  { label: 'Getting started', onSelect: () => open(DOC_URLS.gettingStarted) },
  { label: 'Inspect a website', onSelect: () => open(DOC_URLS.inspectWebsite) },
  { label: 'Connect a Next.js app', onSelect: () => open(DOC_URLS.connectNext) },
  { label: 'Connect a Node.js app', onSelect: () => open(DOC_URLS.connectNode) },
  { label: 'Inspect requests and responses', onSelect: () => open(DOC_URLS.inspectRequests) },
  { label: 'Export sessions', onSelect: () => open(DOC_URLS.exportSessions) },
  { label: 'Privacy and sensitive data', onSelect: () => open(DOC_URLS.privacy) },
  { label: 'Troubleshooting', onSelect: () => open(DOC_URLS.troubleshooting) },
  { label: 'Known limitations', onSelect: () => open(DOC_URLS.limitations) },
  { kind: 'sep' },
  { kind: 'label', label: 'Get TraceThrough' },
  { label: 'Download TraceThrough', hint: 'latest release', onSelect: () => open(RELEASES_LATEST_URL) },
  { label: '@tracethrough/next', hint: 'npm', onSelect: () => open(NPM_URLS.next) },
  { label: '@tracethrough/node', hint: 'npm', onSelect: () => open(NPM_URLS.node) },
];

/** "Read docs" plus a menu of the documentation journeys and download links. */
export function DocsMenu() {
  return (
    <span className="split-btn">
      <button type="button" className="btn" onClick={() => open(DOC_URLS.index)}>
        Read docs
      </button>
      <MenuButton className="btn" ariaLabel="More documentation and downloads" entries={ENTRIES}>
        &#9662;
      </MenuButton>
    </span>
  );
}
