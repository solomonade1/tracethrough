import { useSyncExternalStore } from 'react';

/** "system" follows the OS; "light" and "dark" pin the palette (styles.css reads `data-theme` on <html>). */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'tt.theme';
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let current: ThemePreference = read();

function apply(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

/** Call once before the first render so the stored choice is applied without a flash. */
export function applyStoredTheme(): void {
  apply(current);
}

export function setTheme(pref: ThemePreference): void {
  current = pref;
  apply(pref);
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage unavailable: the choice lasts until the window reloads.
  }
  for (const l of listeners) l();
}

export function useTheme(): ThemePreference {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
