import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MenuEntry =
  | { kind?: 'item'; label: string; hint?: string; disabled?: boolean; onSelect(): void }
  | { kind: 'label'; label: string }
  | { kind: 'sep' };

/**
 * A button that opens a `role="menu"`. Arrow keys move, Enter runs, Esc closes and returns focus to
 * the button, and a click outside closes it.
 */
export function MenuButton({
  children,
  entries,
  className = 'btn',
  ariaLabel,
  disabled,
  title,
}: {
  children: ReactNode;
  entries: MenuEntry[];
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return close(true);
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]!.focus();
    }
  }

  return (
    <span className="menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open && (
        <div className="menu" role="menu" id={id}>
          {entries.map((entry, i) => {
            if (entry.kind === 'sep') return <hr key={i} />;
            if (entry.kind === 'label') {
              return (
                <div key={i} className="menu-label">
                  {entry.label}
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => {
                  close(true);
                  entry.onSelect();
                }}
              >
                <span>{entry.label}</span>
                {entry.hint && <small>{entry.hint}</small>}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
