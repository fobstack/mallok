/**
 * Light, dark, or whatever the system uses (docs/ADMIN_MIGRATION.md §8).
 *
 * shadcn/ui's styles switch on a `.dark` class on `<html>`, so the class is
 * the single source of truth and this module is the only thing that sets it.
 * It runs before the first render: the admin's page is empty until then, so
 * there is no flash of the wrong scheme.
 *
 * The choice is a convenience of one browser, kept in `localStorage`. Where
 * that is unavailable — a private window, blocked storage — the admin simply
 * follows the system.
 */

import { useSyncExternalStore } from 'react';

/** What the operator chose. */
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

const STORAGE_KEY = 'mallok-admin-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

let mode: ThemeMode = read();
const listeners = new Set<() => void>();

function read(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(): void {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Applies the stored choice and follows the system while it is "system". */
export function startThemeMode(): void {
  apply();
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (mode === 'system') {
      apply();
    }
  });
}

/** Changes the scheme now and remembers it in this browser. */
export function setThemeMode(next: ThemeMode): void {
  mode = next;
  try {
    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // Not remembered; it still applies to this page.
  }
  apply();
  for (const listener of listeners) {
    listener();
  }
}

/** The current choice, re-rendering when it changes. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => mode,
  );
}
