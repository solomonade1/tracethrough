import { useMemo } from 'react';
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
const TYPES: [RequestType, string][] = [
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

function toggle<T>(list: readonly T[] | undefined, value: T): T[] {
  const set = new Set(list ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: [T, string][];
  selected: readonly T[] | undefined;
  onToggle: (v: T) => void;
}) {
  return (
    <div className="chip-group" role="group" aria-label={label}>
      {options.map(([value, text]) => (
        <button
          key={value}
          className={`chip ${selected?.includes(value) ? 'active' : ''}`}
          aria-pressed={!!selected?.includes(value)}
          onClick={() => onToggle(value)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ events, shown, dropped }: { events: NetworkEvent[]; shown: number; dropped: number }) {
  const filter = useInspector((s) => s.filter);
  const setFilter = useInspector((s) => s.setFilter);
  const resetFilter = useInspector((s) => s.resetFilter);

  const methods = useMemo(() => [...new Set(events.map((e) => e.method))].sort(), [events]);
  const domains = useMemo(() => [...new Set(events.map((e) => e.domain))].sort(), [events]);
  const active = Object.values(filter as EventFilter).some((v) => (Array.isArray(v) ? v.length : !!v));

  return (
    <div className="filterbar">
      <input
        type="search"
        aria-label="Search requests"
        placeholder="Search URL, method or status"
        value={filter.text ?? ''}
        onChange={(e) => setFilter({ text: e.target.value })}
      />
      <label className="check">
        <input type="checkbox" checked={!!filter.searchBodies} onChange={(e) => setFilter({ searchBodies: e.target.checked })} />
        Bodies
      </label>
      <ChipGroup label="Status" options={STATUS} selected={filter.statusClasses} onToggle={(v) => setFilter({ statusClasses: toggle(filter.statusClasses, v) })} />
      <ChipGroup label="Type" options={TYPES} selected={filter.types} onToggle={(v) => setFilter({ types: toggle(filter.types, v) })} />
      <ChipGroup label="Source" options={SOURCES} selected={filter.sources} onToggle={(v) => setFilter({ sources: toggle(filter.sources, v) })} />
      <select
        aria-label="Method"
        value={filter.methods?.[0] ?? ''}
        onChange={(e) => setFilter({ methods: e.target.value ? [e.target.value] : [] })}
      >
        <option value="">All methods</option>
        {methods.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <select
        aria-label="Domain"
        value={filter.domains?.[0] ?? ''}
        onChange={(e) => setFilter({ domains: e.target.value ? [e.target.value] : [] })}
      >
        <option value="">All domains</option>
        {domains.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
      {active && (
        <button className="link" onClick={resetFilter}>
          Reset
        </button>
      )}
      <span className="counts" aria-live="polite">
        {shown === events.length ? `${events.length} requests` : `${shown} / ${events.length} requests`}
        {dropped > 0 && <span className="warn"> · {dropped} dropped (session cap)</span>}
      </span>
    </div>
  );
}
