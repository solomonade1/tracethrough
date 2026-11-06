import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Masked } from './detail/shared';

export type Seg = string | number;
export interface TreeSelection {
  segments: Seg[];
  value: unknown;
}

interface TNode {
  id: string;
  depth: number;
  segments: Seg[];
  key: Seg | null;
  value: unknown;
  kind: 'object' | 'array' | 'leaf';
  count: number;
}
type Row = { type: 'node'; node: TNode; open: boolean } | { type: 'more'; id: string; arrayId: string; remaining: number; depth: number };

const PAGE = 100;
const OPEN_DEPTH = 4; // root plus three levels, as in the design
const idOf = (segments: readonly Seg[]) => JSON.stringify(segments);

const kindOf = (v: unknown): TNode['kind'] => (Array.isArray(v) ? 'array' : v !== null && typeof v === 'object' ? 'object' : 'leaf');
const childEntries = (v: unknown): [Seg, unknown][] =>
  Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v as Record<string, unknown>);

function leafText(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function Value({ v }: { v: unknown }) {
  if (v === null) return <span className="j-null">null</span>;
  if (typeof v === 'string')
    return (
      <span className="j-str">
        &quot;
        <Masked text={v} />
        &quot;
      </span>
    );
  if (typeof v === 'number') return <span className="j-num">{v}</span>;
  return <span className="j-bool">{String(v)}</span>;
}

export function JsonTree({
  value,
  query,
  matchIndex,
  onMatches,
  onSelect,
  expandSignal,
}: {
  value: unknown;
  query: string;
  matchIndex: number;
  onMatches(count: number): void;
  onSelect(selection: TreeSelection): void;
  expandSignal: { mode: 'open' | 'close'; n: number };
}) {
  const uid = useId();
  const [defaultDepth, setDefaultDepth] = useState(OPEN_DEPTH);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [limits, setLimits] = useState<Map<string, number>>(new Map());
  const [selectedId, setSelectedId] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expandSignal.n) return;
    setDefaultDepth(expandSignal.mode === 'open' ? Number.POSITIVE_INFINITY : 1);
    setOverrides(new Map());
  }, [expandSignal]);

  // Matches over the whole tree, not only the visible rows.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const found: { id: string; ancestors: string[]; needs: [string, number][] }[] = [];
    if (!needle) return found;
    const walk = (v: unknown, segments: Seg[], ancestors: string[], needs: [string, number][]) => {
      const id = idOf(segments);
      const key = segments[segments.length - 1];
      const keyHit = key !== undefined && String(key).toLowerCase().includes(needle);
      if (kindOf(v) === 'leaf') {
        if (keyHit || leafText(v).toLowerCase().includes(needle)) found.push({ id, ancestors, needs });
        return;
      }
      if (keyHit) found.push({ id, ancestors, needs });
      for (const [k, child] of childEntries(v)) {
        const nextNeeds = Array.isArray(v) && typeof k === 'number' && k >= PAGE ? [...needs, [id, k + 1] as [string, number]] : needs;
        walk(child, [...segments, k], [...ancestors, id], nextNeeds);
      }
    };
    walk(value, [], [], []);
    return found;
  }, [value, query]);

  useEffect(() => {
    onMatches(matches.length);
    if (!matches.length) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const m of matches) for (const a of m.ancestors) next.set(a, true);
      return next;
    });
    setLimits((prev) => {
      const next = new Map(prev);
      for (const m of matches) for (const [arr, n] of m.needs) next.set(arr, Math.max(next.get(arr) ?? PAGE, n));
      return next;
    });
  }, [matches, onMatches]);

  const hitIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);
  const currentId = matches.length ? matches[((matchIndex % matches.length) + matches.length) % matches.length]!.id : undefined;

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (v: unknown, segments: Seg[], depth: number) => {
      const id = idOf(segments);
      const kind = kindOf(v);
      const key = segments.length ? segments[segments.length - 1]! : null;
      const count = kind === 'leaf' ? 0 : childEntries(v).length;
      const open = kind !== 'leaf' && (overrides.get(id) ?? depth < defaultDepth);
      out.push({ type: 'node', node: { id, depth, segments, key, value: v, kind, count }, open });
      if (!open) return;
      const entries = childEntries(v);
      const limit = kind === 'array' ? (limits.get(id) ?? PAGE) : entries.length;
      for (const [k, child] of entries.slice(0, limit)) walk(child, [...segments, k], depth + 1);
      if (entries.length > limit) out.push({ type: 'more', id: `${id}#more`, arrayId: id, remaining: entries.length - limit, depth: depth + 1 });
    };
    walk(value, [], 0);
    return out;
  }, [value, overrides, limits, defaultDepth]);

  useEffect(() => {
    if (!currentId) return;
    document.getElementById(`${uid}-${currentId}`)?.scrollIntoView({ block: 'nearest' });
  }, [currentId, uid, rows]);

  const toggle = (node: TNode, open: boolean) => setOverrides((prev) => new Map(prev).set(node.id, open));
  const select = (node: TNode) => {
    setSelectedId(node.id);
    setFocusId(node.id);
    onSelect({ segments: node.segments, value: node.value });
  };

  function onKeyDown(e: KeyboardEvent) {
    const navigable = rows.filter((r): r is Extract<Row, { type: 'node' }> => r.type === 'node');
    if (!navigable.length) return;
    const at = Math.max(0, navigable.findIndex((r) => r.node.id === (focusId ?? selectedId)));
    const cur = navigable[at]!;
    const move = (i: number) => {
      const target = navigable[Math.min(navigable.length - 1, Math.max(0, i))]!;
      setFocusId(target.node.id);
      document.getElementById(`${uid}-${target.node.id}`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return move(at + 1);
      case 'ArrowUp':
        e.preventDefault();
        return move(at - 1);
      case 'Home':
        e.preventDefault();
        return move(0);
      case 'End':
        e.preventDefault();
        return move(navigable.length - 1);
      case 'ArrowRight':
        e.preventDefault();
        if (cur.node.kind !== 'leaf' && !cur.open) toggle(cur.node, true);
        else move(at + 1);
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (cur.node.kind !== 'leaf' && cur.open) return toggle(cur.node, false);
        const parentId = idOf(cur.node.segments.slice(0, -1));
        const parent = navigable.findIndex((r) => r.node.id === parentId);
        if (cur.node.segments.length && parent >= 0) move(parent);
        return;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        return select(cur.node);
    }
  }

  const activeId = focusId ?? selectedId;
  return (
    <div
      className="tree"
      role="tree"
      aria-label="JSON"
      tabIndex={0}
      ref={treeRef}
      aria-activedescendant={activeId ? `${uid}-${activeId}` : undefined}
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        if (row.type === 'more') {
          return (
            <div key={row.id} className="t-row" style={{ paddingLeft: row.depth * 16 + 14 }}>
              <button type="button" className="link" onClick={() => setLimits((prev) => new Map(prev).set(row.arrayId, Number.POSITIVE_INFINITY))}>
                Show {row.remaining} more
              </button>
            </div>
          );
        }
        const { node, open } = row;
        const container = node.kind !== 'leaf';
        const cls = ['t-row', node.id === selectedId ? 'sel' : '', hitIds.has(node.id) ? 'hit' : '', node.id === currentId ? 'cur' : '', node.id === focusId ? 'focus' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={node.id}
            id={`${uid}-${node.id}`}
            role="treeitem"
            aria-level={node.depth + 1}
            aria-expanded={container ? open : undefined}
            aria-selected={node.id === selectedId}
            className={cls}
            style={{ paddingLeft: node.depth * 16 }}
            onClick={() => select(node)}
          >
            {container ? (
              <button
                type="button"
                tabIndex={-1}
                className="caret-btn"
                aria-label={open ? 'Collapse' : 'Expand'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node, !open);
                }}
              >
                {open ? '▾' : '▸'}
              </button>
            ) : (
              <span className="caret-btn" aria-hidden="true" />
            )}
            {node.key !== null && <span className="j-key">{String(node.key)}:&nbsp;</span>}
            {container ? (
              <span className="j-sum">{node.kind === 'array' ? `[ ${node.count} items ]` : `{ ${node.count} properties }`}</span>
            ) : (
              <Value v={node.value} />
            )}
          </div>
        );
      })}
    </div>
  );
}
