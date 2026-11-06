import { useRef, type KeyboardEvent } from 'react';
import { exchangeAsText, headerLines, toCurl, toFetch, toHarEntry, type NetworkEvent } from '@tracethrough/core';
import { formatBytes, formatMs, nameOf, statusTone } from '../format';
import { copyText } from '../lib/clipboard';
import { useInspector, type DetailTab } from '../store';
import { HeadersTab } from './detail/HeadersTab';
import { OverviewTab } from './detail/OverviewTab';
import { RequestTab } from './detail/RequestTab';
import { ResponseTab } from './detail/ResponseTab';
import { TimingTab } from './detail/TimingTab';
import { MenuButton, type MenuEntry } from './Menu';

const TAB_IDS: DetailTab[] = ['overview', 'headers', 'request', 'response', 'timing'];
const TAB_LABEL: Record<DetailTab, string> = { overview: 'Overview', headers: 'Headers', request: 'Request', response: 'Response', timing: 'Timing' };

const lines = (h: Record<string, string> | undefined) => headerLines(h).map(([k, v]) => `${k}: ${v}`).join('\n');

function copyMenu(e: NetworkEvent, events: NetworkEvent[]): MenuEntry[] {
  const go = (text: string, label: string) => () => void copyText(text, label);
  return [
    { label: 'Copy URL', onSelect: go(e.urlSanitized, 'URL') },
    { label: 'Copy as cURL', hint: 'bash', onSelect: go(toCurl(e), 'cURL') },
    { label: 'Copy as fetch', hint: 'JS', onSelect: go(toFetch(e), 'fetch call') },
    { kind: 'sep' },
    { label: 'Copy request headers', onSelect: go(lines(e.requestHeadersSanitized), 'request headers') },
    { label: 'Copy response headers', onSelect: go(lines(e.responseHeadersSanitized), 'response headers') },
    { label: 'Copy response body', disabled: e.responseBody?.preview === undefined, onSelect: go(e.responseBody?.preview ?? '', 'response body') },
    { kind: 'sep' },
    { label: 'Copy as HAR entry', onSelect: go(JSON.stringify(toHarEntry(e, events), null, 2), 'HAR entry') },
    { label: 'Copy everything', hint: 'request + response', onSelect: go(exchangeAsText(e), 'request and response') },
  ];
}

export function DetailPane() {
  const events = useInspector((s) => s.events);
  const selectedId = useInspector((s) => s.selectedId);
  const tab = useInspector((s) => s.detailTab);
  const setTab = useInspector((s) => s.setDetailTab);
  const select = useInspector((s) => s.select);
  const ref = useRef<HTMLElement>(null);
  const e = events.find((x) => x.id === selectedId);
  if (!e) return null;

  const failed = e.state === 'failed';
  const headerCount = Object.keys(e.requestHeadersSanitized ?? {}).length + headerLines(e.responseHeadersSanitized).length;
  const statusText = failed ? 'Failed' : e.state === 'pending' ? 'Pending' : `${e.status ?? ''} ${e.statusText ?? ''}`.trim();

  function onKeyDown(ev: KeyboardEvent) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f') {
      const input = ref.current?.querySelector<HTMLInputElement>('input[data-find]');
      if (input) {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    }
  }

  function onTabKeys(ev: KeyboardEvent) {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    const i = TAB_IDS.indexOf(tab);
    const next = TAB_IDS[(i + (ev.key === 'ArrowRight' ? 1 : -1) + TAB_IDS.length) % TAB_IDS.length]!;
    setTab(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${next}"]`)?.focus());
  }

  return (
    <aside className="detail" aria-label="Request details" ref={ref} onKeyDown={onKeyDown}>
      <div className="dh">
        <div className="l1">
          <span className={`st lg tone-${statusTone(e)}`}>{statusText}</span>
          <span className="meth">{e.method}</span>
          <span className="dpath" title={e.urlSanitized}>
            {nameOf(e.urlSanitized)}
          </span>
          <span className="split-btn">
            <button type="button" className="btn sm" onClick={() => void copyText(toCurl(e), 'cURL')}>
              Copy as cURL
            </button>
            <MenuButton className="btn sm" ariaLabel="More copy options" title="Masked values stay masked" entries={copyMenu(e, events)}>
              &#9662;
            </MenuButton>
          </span>
          <button type="button" className="icon-btn" aria-label="Close details" onClick={() => select(undefined)}>
            &#10005;
          </button>
        </div>
        <div className="l2">
          <span>{e.domain}</span>
          <i />
          <span>{formatMs(e.durationMs) || '…'}</span>
          <i />
          <span>{e.responseBody?.sizeBytes !== undefined ? formatBytes(e.responseBody.sizeBytes) : 'no body'}</span>
          <i />
          <span className={`badge ${e.source}`}>{e.source === 'browser' ? 'Browser' : 'Server'}</span>
          {e.protocol && (
            <>
              <i />
              <span className="mono">{e.protocol}</span>
            </>
          )}
        </div>
      </div>
      <div className="tabs" role="tablist" onKeyDown={onTabKeys}>
        {TAB_IDS.map((id) => (
          <button key={id} role="tab" data-tab={id} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {TAB_LABEL[id]}
            {id === 'headers' && headerCount > 0 && <em>{headerCount}</em>}
          </button>
        ))}
      </div>
      <div className="pane" role="tabpanel" key={e.id}>
        {tab === 'overview' && <OverviewTab e={e} events={events} />}
        {tab === 'headers' && <HeadersTab e={e} />}
        {tab === 'request' && <RequestTab e={e} />}
        {tab === 'response' && <ResponseTab e={e} />}
        {tab === 'timing' && <TimingTab e={e} />}
      </div>
    </aside>
  );
}
