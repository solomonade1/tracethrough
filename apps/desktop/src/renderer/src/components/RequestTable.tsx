import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { NetworkEvent } from '@tracethrough/core';
import { formatBytes, formatMs, nameOf, statusLabel, statusTone } from '../format';
import { buildRows, serverCallsOf, triggerOf } from '../lib/rows';
import { useLinks } from '../lib/useLinks';
import { useInspector } from '../store';

const ROW_HEIGHT = 30;
const GROUP_HEIGHT = 28;

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
  if (body?.sizeBytes !== undefined && body.unavailableReason !== 'empty') {
    return (
      <>
        {formatBytes(body.sizeBytes)}
        {body.truncated && <span title="Truncated preview">*</span>}
      </>
    );
  }
  if (body?.unavailableReason) return <span className="muted">{SHORT_REASON[body.unavailableReason] ?? 'n/a'}</span>;
  return '';
}

const COLUMNS = ['Status', 'Method', 'Name', 'Domain', 'Size', 'Time', 'Source'];

export function RequestTable({ events }: { events: NetworkEvent[] }) {
  const selectedId = useInspector((s) => s.selectedId);
  const select = useInspector((s) => s.select);
  const picked = useInspector((s) => s.picked);
  const togglePick = useInspector((s) => s.togglePick);
  const setPicked = useInspector((s) => s.setPicked);
  const group = useInspector((s) => s.groupByPage);
  const total = useInspector((s) => s.events.length);
  const resetFilter = useInspector((s) => s.resetFilter);
  const links = useLinks();
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Follow new requests while the user is parked at the bottom, like DevTools. */
  const following = useRef(true);

  const rows = useMemo(() => buildRows(events, links, group), [events, links, group]);
  const eventRows = useMemo(() => rows.flatMap((r, i) => (r.kind === 'event' ? [{ id: r.event.id, index: i }] : [])), [rows]);
  const allPicked = events.length > 0 && events.every((e) => picked.has(e.id));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'group' ? GROUP_HEIGHT : ROW_HEIGHT),
    overscan: 20,
  });

  useEffect(() => {
    if (following.current && rows.length) virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
  }, [rows.length, virtualizer]);

  // A link card or keyboard move can select a row that is off screen.
  useEffect(() => {
    const at = eventRows.find((r) => r.id === selectedId);
    if (at) virtualizer.scrollToIndex(at.index, { align: 'auto' });
  }, [selectedId, eventRows, virtualizer]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!eventRows.length) return;
    const current = eventRows.findIndex((r) => r.id === selectedId);
    let next: number | undefined;
    if (e.key === 'ArrowDown') next = Math.min(eventRows.length - 1, current + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, current < 0 ? 0 : current - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = eventRows.length - 1;
    else if (e.key === ' ' && selectedId) {
      e.preventDefault();
      return togglePick(selectedId);
    } else if (e.key === 'Escape') return select(undefined);
    if (next === undefined) return;
    e.preventDefault();
    following.current = false;
    select(eventRows[next]!.id);
  }

  return (
    <div className="table" role="grid" aria-label="Network requests" aria-rowcount={rows.length + 1}>
      <div className="row head" role="row" aria-rowindex={1}>
        <div role="columnheader" className="cell c-pick">
          <input
            type="checkbox"
            aria-label="Select all shown"
            checked={allPicked}
            disabled={!events.length}
            onChange={() => setPicked(events.map((x) => x.id), !allPicked)}
          />
        </div>
        {COLUMNS.map((c) => (
          <div key={c} role="columnheader" className={`cell c-${c.toLowerCase()}`}>
            {c}
          </div>
        ))}
      </div>
      <div className="body" ref={scrollRef} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown}>
        {rows.length === 0 ? (
          total === 0 ? (
            <p className="empty">No requests yet. Browse the site in the capture window.</p>
          ) : (
            <p className="empty">
              No requests match these filters.{' '}
              <button type="button" className="link" onClick={resetFilter}>
                Reset filters
              </button>
            </p>
          )
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = rows[item.index]!;
              if (r.kind === 'group') {
                return (
                  <div key={`g-${r.key}`} role="row" data-kind="group" aria-rowindex={item.index + 2} className="row group" style={{ transform: `translateY(${item.start}px)`, height: GROUP_HEIGHT }}>
                    <div role="rowheader" className="group-cell">
                      <b>{r.label}</b>
                      <span>
                        {r.count} requests{r.note ? ` · ${r.note}` : ''}
                      </span>
                    </div>
                  </div>
                );
              }
              const e = r.event;
              const trigger = triggerOf(links, e);
              const calls = serverCallsOf(links, e);
              return (
                <div
                  key={e.id}
                  role="row"
                  aria-rowindex={item.index + 2}
                  aria-selected={e.id === selectedId}
                  aria-level={r.child ? 2 : undefined}
                  className={`row tone-${statusTone(e)} ${e.id === selectedId ? 'selected' : ''} ${r.child ? 'child' : ''}`}
                  style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                  onClick={() => select(e.id)}
                >
                  <div role="gridcell" className="cell c-pick" onClick={(ev) => ev.stopPropagation()}>
                    <input type="checkbox" aria-label="Select request" checked={picked.has(e.id)} onChange={() => togglePick(e.id)} />
                  </div>
                  <div role="gridcell" className="cell c-status">
                    <span className="st">{statusLabel(e)}</span>
                  </div>
                  <div role="gridcell" className="cell c-method">
                    {e.method}
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
                  <div role="gridcell" className={`cell c-time ${(e.durationMs ?? 0) > 1000 ? 'slow' : ''}`}>
                    {formatMs(e.durationMs)}
                  </div>
                  <div role="gridcell" className="cell c-source">
                    <span className={`badge ${e.source}`}>{e.source === 'browser' ? 'Browser' : 'Server'}</span>
                    {e.source === 'browser' && calls.length > 0 && (
                      <span className="lk" title="Server calls linked by trace ID">
                        {calls.length} linked
                      </span>
                    )}
                    {e.source === 'server' &&
                      (trigger ? (
                        <span className="lk">linked</span>
                      ) : (
                        <span className="lk no" title="No browser request carried a matching trace context">
                          not linked
                        </span>
                      ))}
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
