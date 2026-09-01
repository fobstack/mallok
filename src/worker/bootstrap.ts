/**
 * First-boot work: apply schema migrations and create the `site` row. Runs
 * once per isolate; the result is memoized so the hot path pays nothing after
 * the first request.
 *
 * The theme is not part of this: it is compiled into the build, so there is
 * nothing to install (docs/THEME_FORMAT.md §1).
 */

import { CORE_MIGRATIONS, ensureMigrated } from '../db/migrate.js';
import { ensurePluginRow, ensureSiteRow, loadSite } from '../db/queries.js';
import type { Env } from './env.js';
import {
  defaultSettingsJson,
  pluginMigrations,
  registeredPlugins,
} from './plugin-runtime.js';

/** Default site settings used until the setup wizard runs. */
export const SITE_DEFAULTS = {
  name: 'My Mallok site',
  defaultLocale: 'en',
  locales: ['en'],
  kinds: { page: { base: '' }, article: { base: 'news' } },
} as const;

let booted: Promise<void> | undefined;

/** Ensures the database is migrated and seeded. Idempotent and memoized. */
export function boot(env: Env): Promise<void> {
  if (booted === undefined) {
    booted = runBoot(env).catch((error: unknown) => {
      // Let the next request retry instead of caching the failure forever.
      booted = undefined;
      throw error;
    });
  }
  return booted;
}

async function runBoot(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await ensureMigrated(env.DB, [...CORE_MIGRATIONS, ...pluginMigrations()]);
  const site = await loadSite(env.DB);
  if (site === null) {
    await ensureSiteRow(env.DB, SITE_DEFAULTS, now);
  }
  // Register compiled-in plugins, disabled by default. Enabling is a runtime
  // switch; being present in this list is a property of the build.
  for (const plugin of registeredPlugins()) {
    await ensurePluginRow(
      env.DB,
      plugin.manifest.id,
      plugin.manifest.version,
      defaultSettingsJson(plugin),
      now,
    );
  }
}

/** Test hook: forgets the memoized boot so a fresh database is re-seeded. */
export function resetBootForTests(): void {
  booted = undefined;
}
