import { startTransition, useEffect, useMemo, useState } from 'react';
import type { EventFilter, EventSource, NetworkEvent, RequestType, StatusClass } from '@tracethrough/core';
import { useInspector } from '../store';

const STATUS: [StatusClass, string][] = [
  ['2xx', '2xx'],
  ['3xx', '3xx'],
  ['4xx', '4xx'],
  ['5xx', '5xx'],
  ['failed', 'Failed'],
  ['pending', 'Pending'],
];
const TYPES: [string, string][] = [
  ['fetchxhr', 'Fetch / XHR'],
  ['document', 'Doc'],
  ['fetch', 'Fetch'],
  ['xhr', 'XHR'],
  ['asset', 'Asset'],
  ['other', 'Other'],
];
const SOURCES: [EventSource, string][] = [
  ['browser', 'Browser'],
  ['server', 'Server'],
];

const typeValue = (types: readonly RequestType[] | undefined) => {
  if (!types?.length) return '';
  return types.length === 2 && types.includes('fetch') && types.includes('xhr') ? 'fetchxhr' : types[0]!;
};

function Select({ label, value, onChange, all, options }: { label: string; value: string; onChange(v: string): void; all: string; options: [string, string][] }) {
  return (
    <select className={`dd ${value ? 'on' : ''}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

export function FilterBar({ events, shown, dropped }: { events: NetworkEvent[]; shown: number; dropped: number }) {
  const filter = useInspector((s) => s.filter);
  const setFilter = useInspector((s) => s.setFilter);
  const resetFilter = useInspector((s) => s.resetFilter);
  const group = useInspector((s) => s.groupByPage);
  const setGroup = useInspector((s) => s.setGroupByPage);

  // The box stays responsive while a large session re-filters: the filter change is a low-priority
  // transition, so there is no artificial delay and Reset clears the box at once.
  const [text, setText] = useState(filter.text ?? '');
  useEffect(() => setText(filter.text ?? ''), [filter.text]);
  function onSearch(value: string) {
    setText(value);
    startTransition(() => setFilter({ text: value }));
  }

  const methods = useMemo(() => [...new Set(events.map((e) => e.method))].sort(), [events]);
  const domains = useMemo(() => [...new Set(events.map((e) => e.domain))].sort(), [events]);
  const active = Object.values(filter as EventFilter).some((v) => (Array.isArray(v) ? v.length : !!v));

  return (
    <div className="filterbar">
      <div className="search">
        <input type="search" aria-label="Search requests" placeholder="Filter by URL, method or status" value={text} onChange={(e) => onSearch(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={!!filter.searchBodies} onChange={(e) => setFilter({ searchBodies: e.target.checked })} />
          Bodies
        </label>
      </div>
      <Select
        label="Type"
        all="All types"
        value={typeValue(filter.types)}
        options={TYPES}
        onChange={(v) => setFilter({ types: v === '' ? [] : v === 'fetchxhr' ? ['fetch', 'xhr'] : [v as RequestType] })}
      />
      <Select label="Source" all="All sources" value={filter.sources?.[0] ?? ''} options={SOURCES} onChange={(v) => setFilter({ sources: v ? [v as EventSource] : [] })} />
      <Select label="Status" all="All statuses" value={filter.statusClasses?.[0] ?? ''} options={STATUS} onChange={(v) => setFilter({ statusClasses: v ? [v as StatusClass] : [] })} />
      <Select label="Method" all="All methods" value={filter.methods?.[0] ?? ''} options={methods.map((m) => [m, m])} onChange={(v) => setFilter({ methods: v ? [v] : [] })} />
      <Select label="Domain" all="All domains" value={filter.domains?.[0] ?? ''} options={domains.map((d) => [d, d])} onChange={(v) => setFilter({ domains: v ? [v] : [] })} />
      {active && (
        <button type="button" className="link" onClick={resetFilter}>
          Reset
        </button>
      )}
      <span className="spacer" />
      <label className="check">
        <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
        Group by page
      </label>
      <span className="counts" aria-live="polite">
        {shown === events.length ? `${events.length} requests` : `${shown} of ${events.length} requests`}
        {dropped > 0 && <span className="warn"> · {dropped} dropped (session cap)</span>}
      </span>
    </div>
  );
}
