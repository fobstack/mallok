/**
 * Application state.
 *
 * Signals rather than a store: the admin has a handful of globals (who is
 * signed in, the site settings, the active theme) and everything else is page
 * local. A state library would be more machinery than the app has state.
 */

import { computed, signal } from '@preact/signals-react';
import { api, setCsrf } from './api.js';
import type { Health, Session, Settings, ThemeInfo } from './types.js';

/** Null until `restore()` has run; then either a session or `false`. */
export const session = signal<Session | null | false>(null);
export const settings = signal<Settings | null>(null);
export const theme = signal<ThemeInfo | null>(null);
export const health = signal<Health | null>(null);

/** A banner shown across the app: the last error, or an empty string. */
export const notice = signal('');

/** Locale currently selected in the content area. */
export const activeLocale = signal('');

/** True once the session, settings and theme are all loaded. */
export const ready = computed(
  () =>
    session.value !== null &&
    (session.value === false ||
      (settings.value !== null && theme.value !== null)),
);

/**
 * How long a saved change takes to reach visitors.
 *
 * With a purge token, saving drops the affected cached pages and the change
 * is live in seconds. Without one, visitors keep the cached page until it
 * expires. The difference is real, so the UI states it instead of saying
 * "saved" and leaving the user to discover the delay (docs/ADMIN.md §5).
 */
export const liveDelay = computed<
  | { readonly instant: true }
  | { readonly instant: false; readonly seconds: number }
>(() => {
  if (health.value?.purgeConfigured === true) {
    return { instant: true };
  }
  return { instant: false, seconds: settings.value?.cacheTtl ?? 0 };
});

/** Loads everything the shell needs after a successful sign-in. */
export async function loadWorkspace(): Promise<void> {
  const [loadedSettings, loadedTheme, loadedHealth] = await Promise.all([
    api<Settings>('/settings'),
    api<ThemeInfo>('/theme'),
    api<Health>('/health'),
  ]);
  settings.value = loadedSettings;
  theme.value = loadedTheme;
  health.value = loadedHealth;
  if (activeLocale.value === '') {
    activeLocale.value = loadedSettings.defaultLocale;
  }
}

/**
 * Restores an existing session on load. A 401 is the normal signed-out
 * state, not an error to report.
 */
export async function restore(): Promise<void> {
  try {
    const me = await api<Session>('/auth/me');
    setCsrf(me.csrf);
    session.value = me;
    await loadWorkspace();
  } catch {
    session.value = false;
  }
}

/** Signs in and loads the workspace. Throws with the server's message. */
export async function signIn(email: string, password: string): Promise<void> {
  const result = await api<{ csrf: string }>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  setCsrf(result.csrf);
  const me = await api<Session>('/auth/me');
  session.value = me;
  await loadWorkspace();
}

/** Signs out and clears the workspace. */
export async function signOut(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    session.value = false;
    settings.value = null;
    theme.value = null;
    health.value = null;
  }
}

/** Applies a settings patch and stores what the server echoed back. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings.value = await api<Settings>('/settings', {
    method: 'PATCH',
    body: patch,
  });
}
