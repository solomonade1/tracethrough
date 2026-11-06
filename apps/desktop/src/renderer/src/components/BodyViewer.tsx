import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsonPathToString, type BodyPreview, type NetworkEvent } from '@tracethrough/core';
import { formatBytes, unavailableMessage } from '../format';
import { copyText } from '../lib/clipboard';
import { saveBody, saveExchange, saveRequestAsHar } from '../lib/save';
import { useInspector, type BodyViewMode } from '../store';
import { Masked } from './detail/shared';
import { JsonTree, type TreeSelection } from './JsonTree';
import { MenuButton } from './Menu';

/** Splits text on a case-insensitive needle, marking each hit; `current` gets an accent outline. */
function Highlighted({ text, needle, current }: { text: string; needle: string; current: number }) {
  const ref = useRef<HTMLElement>(null);
  const parts = useMemo(() => {
    if (!needle) return [{ text, hit: -1 }];
    const out: { text: string; hit: number }[] = [];
    const lower = text.toLowerCase();
    let i = 0;
    let n = 0;
    for (;;) {
      const at = lower.indexOf(needle, i);
      if (at < 0) break;
      if (at > i) out.push({ text: text.slice(i, at), hit: -1 });
      out.push({ text: text.slice(at, at + needle.length), hit: n++ });
      i = at + needle.length;
    }
    if (i < text.length) out.push({ text: text.slice(i), hit: -1 });
    return out;
  }, [text, needle]);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, [current, needle]);

  return (
    <>
      {parts.map((p, i) =>
        p.hit < 0 ? (
          <Masked key={i} text={p.text} />
        ) : (
          <mark key={i} className={`find-hit ${p.hit === current ? 'cur' : ''}`} ref={p.hit === current ? ref : undefined}>
            <Masked text={p.text} />
          </mark>
        ),
      )}
    </>
  );
}

const countText = (text: string, needle: string) => {
  if (!needle) return 0;
  const lower = text.toLowerCase();
  let n = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) n++;
  return n;
};

/**
 * The one body viewer used by the Request and Response tabs: Tree / Pretty / Raw, copy and save menus,
 * find, and (in Tree view) a breadcrumb with Copy value and Copy path. Missing bodies say why.
 */
export function BodyViewer({
  event,
  body,
  which,
  absentText,
}: {
  event: NetworkEvent;
  body: BodyPreview | undefined;
  which: 'request' | 'response';
  absentText: string;
}) {
  const stored = useInspector((s) => (which === 'request' ? s.requestView : s.responseView));
  const setBodyView = useInspector((s) => s.setBodyView);
  const showToast = useInspector((s) => s.showToast);

  const [find, setFind] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [treeCount, setTreeCount] = useState(0);
  const [selection, setSelection] = useState<TreeSelection>();
  const [expandSignal, setExpandSignal] = useState<{ mode: 'open' | 'close'; n: number }>({ mode: 'open', n: 0 });
  const [needle, setNeedle] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setNeedle(find.trim().toLowerCase());
      setMatchIndex(0);
    }, 120);
    return () => clearTimeout(t);
  }, [find]);

  const readable = !!body && !body.unavailableReason && body.preview !== undefined;
  const parsed = useMemo(() => {
    if (!readable || body!.truncated || !body!.mime?.includes('json')) return undefined;
    try {
      return { value: JSON.parse(body!.preview!) as unknown };
    } catch {
      return undefined;
    }
  }, [readable, body]);
  const isJson = !!parsed;
  const mode: BodyViewMode = isJson ? stored : 'raw';

  const text = useMemo(() => {
    if (!readable) return '';
    if (isJson && mode === 'pretty') return JSON.stringify(parsed!.value, null, 2);
    return body!.preview!;
  }, [readable, isJson, mode, parsed, body]);

  const onMatches = useCallback((n: number) => setTreeCount(n), []);
  const textCount = useMemo(() => (mode === 'tree' ? 0 : countText(text, needle)), [mode, text, needle]);
  const count = mode === 'tree' ? treeCount : textCount;

  function step(delta: number) {
    if (count) setMatchIndex((i) => (((i + delta) % count) + count) % count);
  }

  const noun = which === 'request' ? 'request' : 'response';
  const copyBody = () => void copyText(body!.preview ?? '', 'body');
  const copyPretty = () => void copyText(isJson ? JSON.stringify(parsed!.value, null, 2) : (body!.preview ?? ''), 'pretty JSON');
  const copyValue = () => {
    if (!selection) return showToast('Click a value in the tree first');
    const v = selection.value;
    void copyText(typeof v === 'string' ? v : JSON.stringify(v, null, typeof v === 'object' && v !== null ? 2 : 0), 'value');
  };
  const copyPath = () => {
    if (!selection) return showToast('Click a value in the tree first');
    const path = jsonPathToString(selection.segments);
    if (!path) return showToast('Select a nested value to copy its path');
    void copyText(path, `path ${path}`);
  };

  const missing = !readable;
  const segments = selection?.segments ?? [];

  return (
    <div className="bodyviewer">
      <div className="bar">
        {isJson ? (
          <div className="seg" role="group" aria-label="View">
            {(['tree', 'pretty', 'raw'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setBodyView(which, m)}>
                {m[0]!.toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        ) : (
          <span className="muted small">{missing ? '' : 'Shown as text, never run'}</span>
        )}
        <span className="spacer" />
        <span className="split-btn">
          <button type="button" className="btn sm primary" disabled={missing} onClick={copyBody}>
            Copy body
          </button>
          <MenuButton className="btn sm primary" ariaLabel="More copy options" disabled={missing} entries={[
            { label: 'Copy body', hint: 'as captured', onSelect: copyBody },
            { label: 'Copy pretty JSON', disabled: !isJson, onSelect: copyPretty },
            { label: 'Copy selected value', disabled: !isJson || mode !== 'tree', onSelect: copyValue },
            { label: 'Copy selected path', disabled: !isJson || mode !== 'tree', onSelect: copyPath },
          ]}>
            &#9662;
          </MenuButton>
        </span>
        <MenuButton
          className="btn sm"
          ariaLabel="Save"
          entries={[
            ...(readable ? [{ label: 'Save body', hint: '.' + (body!.mime?.includes('json') ? 'json' : 'txt'), onSelect: () => void saveBody(event, body!) }] : []),
            { label: 'Save this request', hint: '.har', onSelect: () => void saveRequestAsHar(event) },
            { label: 'Save request + response', hint: '.json', onSelect: () => void saveExchange(event) },
          ]}
        >
          Save &#9662;
        </MenuButton>
      </div>

      {missing ? (
        <div className="pscroll">
          <p className="unavailable">{body?.unavailableReason ? unavailableMessage(body) : body && body.preview === undefined ? 'Body unavailable.' : absentText}</p>
        </div>
      ) : (
        <>
          <div className="meta">
            <span className="mime">{body!.mime ?? 'unknown type'}</span>
            <span>Captured preview · {formatBytes(body!.sizeBytes)}</span>
            {body!.truncated && <span className="warn">Truncated: the body is larger than the capture limit</span>}
            <span className="spacer" />
            {mode === 'tree' && (
              <>
                <button type="button" className="link" onClick={() => setExpandSignal((s) => ({ mode: 'open', n: s.n + 1 }))}>
                  Expand all
                </button>
                <button type="button" className="link" onClick={() => setExpandSignal((s) => ({ mode: 'close', n: s.n + 1 }))}>
                  Collapse all
                </button>
              </>
            )}
          </div>
          <div className="find">
            <input
              type="search"
              data-find
              aria-label={`Find in ${noun}`}
              placeholder={`Find in ${noun}…`}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                }
              }}
            />
            <span className="count" aria-live="polite">
              {count} {count === 1 ? 'match' : 'matches'}
            </span>
          </div>
          <div className="pscroll">
            {mode === 'tree' ? (
              <JsonTree
                value={parsed!.value}
                query={needle}
                matchIndex={matchIndex}
                onMatches={onMatches}
                onSelect={setSelection}
                expandSignal={expandSignal}
              />
            ) : (
              <pre className="code">
                <Highlighted text={text} needle={needle} current={matchIndex % Math.max(count, 1)} />
              </pre>
            )}
          </div>
          {mode === 'tree' && (
            <div className="foot">
              <span className="crumb">
                {selection ? (
                  segments.length ? (
                    segments.map((s, i) => (
                      <Fragment key={i}>
                        {i > 0 && ' › '}
                        {i === segments.length - 1 ? <b>{String(s)}</b> : String(s)}
                      </Fragment>
                    ))
                  ) : (
                    <b>root</b>
                  )
                ) : (
                  'Click a value to see its path'
                )}
              </span>
              <button type="button" className="btn sm" disabled={!selection} onClick={copyValue}>
                Copy value
              </button>
              <button type="button" className="btn sm" disabled={!selection} onClick={copyPath}>
                Copy path
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
