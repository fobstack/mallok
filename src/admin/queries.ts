/**
 * The admin's server state, on TanStack Query (docs/ADMIN_MIGRATION.md,
 * phase 5).
 *
 * Every read the admin makes is a query under one key scheme, so a write
 * says which part of the cache it made stale instead of each page keeping
 * its own copy. The four things the whole shell needs — who is signed in,
 * the site's settings, its theme and its health — are loaded by the root
 * route before anything renders; pages read them with `useSuspenseQuery`,
 * which never suspends for data that is already there.
 */

import {
  QueryClient,
  queryOptions,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { api, setCsrf } from './api.js';
import type {
  Health,
  PluginInfo,
  Session,
  Settings,
  ThemeInfo,
} from './types.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A failed request is reported, not retried behind the operator's
      // back: the admin must never look like it is still trying when it
      // has already failed (docs/ADMIN.md §13).
      retry: false,
      // An operator switching back to the tab is not a reason to refetch
      // every list; saves invalidate what they change.
      refetchOnWindowFocus: false,
    },
  },
});

/** The key scheme: the first element names the resource, the rest narrow it. */
export const keys = {
  session: ['session'] as const,
  settings: ['settings'] as const,
  theme: ['theme'] as const,
  health: ['health'] as const,
  diagnostics: ['diagnostics'] as const,
  content: ['content'] as const,
  tokens: ['tokens'] as const,
  media: ['media'] as const,
  plugins: ['plugins'] as const,
  setup: ['setup'] as const,
};

/** The key of anything under one plugin panel: its rows, a record, a child list. */
export function panelKey(
  pluginId: string,
  panelId: string,
  ...rest: readonly string[]
): readonly string[] {
  return [...keys.plugins, pluginId, 'panels', panelId, ...rest];
}

/**
 * Who is signed in, or `null`. A failure to ask is the signed-out state,
 * not an error to report: the sign-in form is the answer either way.
 */
export const sessionQuery = queryOptions({
  queryKey: keys.session,
  queryFn: async (): Promise<Session | null> => {
    try {
      const me = await api<Session>('/auth/me');
      setCsrf(me.csrf);
      return me;
    } catch {
      return null;
    }
  },
  staleTime: Number.POSITIVE_INFINITY,
});

export const settingsQuery = queryOptions({
  queryKey: keys.settings,
  queryFn: () => api<Settings>('/settings'),
  staleTime: Number.POSITIVE_INFINITY,
});

export const themeQuery = queryOptions({
  queryKey: keys.theme,
  queryFn: () => api<ThemeInfo>('/theme'),
  staleTime: Number.POSITIVE_INFINITY,
});

export const healthQuery = queryOptions({
  queryKey: keys.health,
  queryFn: () => api<Health>('/health'),
  staleTime: Number.POSITIVE_INFINITY,
});

/** The compiled-in plugins, their switches, settings and panels. */
export const pluginsQuery = queryOptions({
  queryKey: [...keys.plugins, 'list'],
  queryFn: () => api<{ plugins: PluginInfo[] }>('/plugins'),
});

/**
 * Loads what the signed-in shell needs, fresh: after a sign-in, say.
 * `staleTime: 0` here because the queries' own `Infinity` would otherwise
 * hand back what is cached without asking.
 */
async function fetchWorkspace(): Promise<void> {
  await Promise.all([
    queryClient.fetchQuery({ ...settingsQuery, staleTime: 0 }),
    queryClient.fetchQuery({ ...themeQuery, staleTime: 0 }),
    queryClient.fetchQuery({ ...healthQuery, staleTime: 0 }),
  ]);
}

/**
 * The root route's loader: the session, and for a signed-in operator the
 * workspace, before the first screen renders.
 */
export async function loadShell(): Promise<null> {
  const session = await queryClient.ensureQueryData(sessionQuery);
  if (session !== null) {
    await Promise.all([
      queryClient.ensureQueryData(settingsQuery),
      queryClient.ensureQueryData(themeQuery),
      queryClient.ensureQueryData(healthQuery),
    ]);
  }
  return null;
}

/** Signs in and loads the workspace. Throws with the server's message. */
export async function signIn(email: string, password: string): Promise<void> {
  const result = await api<{ csrf: string }>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  setCsrf(result.csrf);
  const me = await api<Session>('/auth/me');
  // The workspace first: the shell renders the moment the session lands.
  await fetchWorkspace();
  queryClient.setQueryData(keys.session, me);
}

/** Signs out; the next sign-in loads the workspace again. */
export async function signOut(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    queryClient.setQueryData(keys.session, null);
  }
}

/** Applies a settings patch and keeps what the server echoed back. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const stored = await api<Settings>('/settings', {
    method: 'PATCH',
    body: patch,
  });
  queryClient.setQueryData(keys.settings, stored);
}

/**
 * Reloads the workspace after a change that rewrote more than one part of
 * it — a new default language moves every URL.
 */
export async function reloadWorkspace(): Promise<void> {
  await fetchWorkspace();
}

/** The signed-in operator. Only under the shell, where one is certain. */
export function useSession(): Session {
  const session = useSuspenseQuery(sessionQuery).data;
  if (session === null) {
    throw new Error('useSession() is for the signed-in shell only.');
  }
  return session;
}

export function useSettings(): Settings {
  return useSuspenseQuery(settingsQuery).data;
}

export function useTheme(): ThemeInfo {
  return useSuspenseQuery(themeQuery).data;
}

export function useHealth(): Health {
  return useSuspenseQuery(healthQuery).data;
}

/**
 * The site's settings when they are known, for the sign-in screen, which
 * shows the site's name if this browser has already loaded it and never
 * asks for it: reading them needs a session.
 */
export function useKnownSettings(): Settings | undefined {
  return useQuery({ ...settingsQuery, enabled: false }).data;
}

/**
 * How long a saved change takes to reach visitors.
 *
 * With a purge token, saving drops the affected cached pages and the change
 * is live in seconds. Without one, visitors keep the cached page until it
 * expires. The difference is real, so the UI states it instead of saying
 * "saved" and leaving the user to discover the delay (docs/ADMIN.md §5).
 */
export function useLiveDelay():
  | { readonly instant: true }
  | { readonly instant: false; readonly seconds: number } {
  const health = useHealth();
  const settings = useSettings();
  if (health.purgeConfigured) {
    return { instant: true };
  }
  return { instant: false, seconds: settings.cacheTtl };
}
