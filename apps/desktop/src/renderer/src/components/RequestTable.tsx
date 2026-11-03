import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { NetworkEvent } from '@tracethrough/core';
import { formatBytes, formatMs, nameOf, statusLabel, statusTone } from '../format';
import { useInspector } from '../store';

const ROW_HEIGHT = 26;

const SHORT_REASON: Record<string, string> = {
  binary: 'binary',
  redirect: 'redirect',
  empty: '0 B',
  'too-large': 'too large',
  streamed: 'stream',
  'read-failed': 'n/a',
  'omitted-by-policy': 'omitted',
};

/** Known size wins; otherwise a short reason (full explanation lives in the Response tab). */
function sizeCell(e: NetworkEvent) {
  const body = e.responseBody;
  if (body?.sizeBytes !== undefined && body.unavailableReason !== 'empty') return formatBytes(body.sizeBytes);
  if (body?.unavailableReason) return <span className="muted">{SHORT_REASON[body.unavailableReason] ?? 'n/a'}</span>;
  return '';
}
const COLUMNS = ['Status', 'Method', 'Type', 'Name', 'Domain', 'Size', 'Time', 'Source'];

export function RequestTable({ events }: { events: NetworkEvent[] }) {
  const selectedId = useInspector((s) => s.selectedId);
  const select = useInspector((s) => s.select);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Follow new requests while the user is parked at the bottom, like DevTools. */
  const following = useRef(true);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  useEffect(() => {
    if (following.current && events.length) virtualizer.scrollToIndex(events.length - 1, { align: 'end' });
  }, [events.length, virtualizer]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!events.length) return;
    const current = events.findIndex((ev) => ev.id === selectedId);
    let next: number | undefined;
    if (e.key === 'ArrowDown') next = Math.min(events.length - 1, current + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, current < 0 ? 0 : current - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = events.length - 1;
    else if (e.key === 'Escape') return select(undefined);
    if (next === undefined) return;
    e.preventDefault();
    following.current = false;
    select(events[next]!.id);
    virtualizer.scrollToIndex(next);
  }

  return (
    <div className="table" role="grid" aria-label="Network requests" aria-rowcount={events.length + 1}>
      <div className="row head" role="row" aria-rowindex={1}>
        {COLUMNS.map((c) => (
          <div key={c} role="columnheader" className={`cell c-${c.toLowerCase()}`}>
            {c}
          </div>
        ))}
      </div>
      <div className="body" ref={scrollRef} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown}>
        {events.length === 0 ? (
          <p className="empty">No requests yet. Browse the site in the capture window.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const e = events[item.index]!;
              const tone = statusTone(e);
              return (
                <div
                  key={e.id}
                  role="row"
                  aria-rowindex={item.index + 2}
                  aria-selected={e.id === selectedId}
                  className={`row tone-${tone} ${e.id === selectedId ? 'selected' : ''}`}
                  style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                  onClick={() => select(e.id)}
                >
                  <div role="gridcell" className="cell c-status">
                    {statusLabel(e)}
                  </div>
                  <div role="gridcell" className="cell c-method">
                    {e.method}
                  </div>
                  <div role="gridcell" className="cell c-type">
                    {e.isNavigation ? 'doc ⤷' : e.type}
                  </div>
                  <div role="gridcell" className="cell c-name" title={e.urlSanitized}>
                    {nameOf(e.urlSanitized)}
                  </div>
                  <div role="gridcell" className="cell c-domain" title={e.domain}>
                    {e.domain}
                  </div>
                  <div role="gridcell" className="cell c-size">
                    {sizeCell(e)}
                  </div>
                  <div role="gridcell" className="cell c-time">
                    {formatMs(e.durationMs)}
                  </div>
                  <div role="gridcell" className="cell c-source">
                    <span className={`badge ${e.source}`}>{e.source === 'browser' ? 'Browser' : 'Server'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
