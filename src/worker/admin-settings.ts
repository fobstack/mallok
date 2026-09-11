/**
 * Settings and diagnostics endpoints.
 *
 * The admin is not required to understand Workers, D1, R2 or migrations
 * (docs/PRODUCT_VISION.md §4), so those names appear only in the diagnostics
 * payload, which the UI shows under "advanced".
 */

import { z } from 'zod';
import {
  buildPublicPath,
  PIPELINE_VERSION,
  themeAssetBase,
} from '../core/index.js';
import {
  appliedMigrations,
  countStorage,
  listContentLocations,
  loadSite,
  loadSiteRenderData,
  movePaths,
  type PathMove,
  type SitePatch,
  setDefaultLocale,
  updateSite,
} from '../db/queries.js';
import { THEMES } from '../themes/index.js';
import { purgeTags } from './cache.js';
import { activeTheme } from './composition.js';
import type { Env } from './env.js';
import { json, problem, readJson } from './http.js';
import { parseSiteSettings } from './site.js';

const MIN_CACHE_TTL = 60;
const MAX_CACHE_TTL = 31_536_000;

/**
 * Path segments the Worker routes before the public site, so a content kind
 * may not claim them as its base (see `src/worker/index.ts`).
 */
const RESERVED_BASES = new Set(['media', 'theme']);

const navEntrySchema = z.object({
  label: z.string().min(1).max(80),
  href: z.string().min(1).max(512),
});

const settingsSchema = z
  .object({
    name: z.string().min(1).max(120),
    tagline: z.string().max(300).nullable(),
    locales: z.array(z.string().min(2).max(10)).min(1),
    kinds: z.record(
      z.string().regex(/^[a-z][a-z0-9_]*$/),
      z.object({ base: z.string().regex(/^[a-z0-9-]*$/) }),
    ),
    themeOptions: z.record(z.string(), z.unknown()),
    nav: z.record(z.string(), z.array(navEntrySchema)),
    seo: z.record(z.string(), z.unknown()),
    domain: z.string().max(253).nullable(),
    mediaBaseUrl: z.string().max(512).nullable(),
    cacheTtl: z.number().int().min(MIN_CACHE_TTL).max(MAX_CACHE_TTL),
    maxImageEdge: z.number().int().min(320).max(8192).nullable(),
    /** Present only so callers get a clear error instead of silent breakage. */
    defaultLocale: z.string(),
  })
  .partial();

/** Returns the site settings the admin may edit. */
export async function getSettings(env: Env): Promise<Response> {
  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(row);
  return json({
    name: settings.name,
    tagline: settings.tagline,
    defaultLocale: settings.defaultLocale,
    locales: settings.locales,
    kinds: settings.kinds,
    themeOptions: settings.themeOptions,
    nav: settings.nav,
    seo: parseJsonObject(row.seo),
    domain: settings.domain,
    mediaBaseUrl: row.media_base_url,
    cacheTtl: settings.cacheTtl,
    maxImageEdge: row.max_image_edge,
    setupCompletedAt: row.setup_completed_at,
  });
}

/** Applies a partial settings update and purges the site-wide cache tag. */
export async function patchSettings(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = settingsSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return json(
      { error: 'Invalid settings.', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  const input = parsed.data;

  if (
    input.defaultLocale !== undefined &&
    input.defaultLocale !== row.default_locale
  ) {
    // It rewrites every public path and writes a redirect for each, so it has
    // its own endpoint that requires an explicit confirmation.
    return problem(
      409,
      'Changing the default locale rewrites every URL. Use POST /_mallok/api/settings/default-locale.',
    );
  }

  if (input.kinds !== undefined) {
    const clash = Object.entries(input.kinds).find(([, config]) =>
      RESERVED_BASES.has(config.base),
    );
    if (clash !== undefined) {
      return problem(
        400,
        `"${clash[1].base}" is reserved for stored files and cannot be a content base path.`,
      );
    }
  }

  if (
    input.locales !== undefined &&
    !input.locales.includes(row.default_locale)
  ) {
    return problem(
      400,
      `The enabled locales must include the default locale "${row.default_locale}".`,
    );
  }

  const patch: SitePatch = {
    ...pick('name', input.name),
    ...pick('tagline', input.tagline),
    ...pick('locales', jsonOrUndefined(input.locales)),
    ...pick('kinds', jsonOrUndefined(input.kinds)),
    ...pick('theme_options', jsonOrUndefined(input.themeOptions)),
    ...pick('nav', jsonOrUndefined(input.nav)),
    ...pick('seo', jsonOrUndefined(input.seo)),
    ...pick('domain', emptyToNull(input.domain)),
    ...pick('media_base_url', emptyToNull(input.mediaBaseUrl)),
    ...pick('cache_ttl', input.cacheTtl),
    ...pick('max_image_edge', input.maxImageEdge),
  };

  await updateSite(env.DB, patch, new Date().toISOString());
  // Any of these can change every rendered page, so drop the whole site tag.
  ctx.waitUntil(purgeTags(env, ['site']));
  return getSettings(env);
}

/** Liveness plus the facts the admin's diagnostics page needs. */
export async function getHealth(env: Env): Promise<Response> {
  const data = await loadSiteRenderData(env.DB);
  return json({
    ok: data.site !== null,
    site: data.site?.name ?? null,
    theme: `${activeTheme().manifest.id}@${activeTheme().manifest.version}`,
    pipeline: PIPELINE_VERSION,
    purgeConfigured:
      env.CF_API_TOKEN !== undefined && env.CF_ZONE_ID !== undefined,
    customDomain: data.site?.domain ?? null,
    mediaBaseUrl: data.site?.media_base_url ?? null,
  });
}

const defaultLocaleSchema = z.object({
  locale: z.string().min(2).max(10),
  /** Required: this rewrites every public URL on the site. */
  confirm: z.literal(true),
});

/**
 * Changes which locale lives at the root of the site.
 *
 * Every content row's path is recomputed and a 301 is recorded for the old
 * one, so no external link breaks. `content.path` is unique, which makes the
 * order matter: rows that *gain* a locale prefix move first and free up the
 * unprefixed paths, then the rows of the new default locale take them. The
 * two sets are disjoint by locale, so no cycle is possible and each phase can
 * be chunked freely.
 */
export async function postDefaultLocale(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = defaultLocaleSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(
      400,
      'Provide the target locale and "confirm": true; this rewrites every URL.',
    );
  }
  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(row);
  const target = parsed.data.locale;

  if (target === settings.defaultLocale) {
    return json({ defaultLocale: target, moved: 0, unchanged: true });
  }
  if (!settings.locales.includes(target)) {
    return problem(400, `Locale "${target}" is not enabled on this site.`);
  }

  const locations = await listContentLocations(env.DB);
  const gaining: PathMove[] = [];
  const losing: PathMove[] = [];

  for (const item of locations) {
    const base = settings.kinds[item.kind]?.base ?? '';
    const to = buildPublicPath({
      kind: item.kind,
      locale: item.locale,
      defaultLocale: target,
      slug: item.slug,
      base,
    });
    if (to === item.path) {
      continue;
    }
    const move: PathMove = { id: item.id, from: item.path, to };
    // The old default loses its bare paths; the new default claims them.
    if (item.locale === settings.defaultLocale) {
      gaining.push(move);
    } else {
      losing.push(move);
    }
  }

  const now = new Date().toISOString();
  await movePaths(env.DB, gaining, now);
  await movePaths(env.DB, losing, now);
  await setDefaultLocale(env.DB, target, now);
  ctx.waitUntil(purgeTags(env, ['site']));

  return json({
    defaultLocale: target,
    moved: gaining.length + losing.length,
    redirects: gaining.length + losing.length,
  });
}

/**
 * The active theme: what it is, what it can render, and its templates.
 *
 * The admin needs the templates so its live preview runs the same stage-two
 * render as the site does (docs/ADMIN.md §6.3), and it needs the manifest to
 * generate the field and option forms. There is nothing to POST here: the
 * theme is a build-time constant.
 */
export function getTheme(): Response {
  const { manifest, files } = activeTheme();
  return json({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? '',
    kinds: manifest.kinds,
    options: manifest.options,
    locales: manifest.locales,
    defaultLocale: manifest.defaultLocale,
    imageWidths: manifest.imageWidths,
    // Shown verbatim so the cost of a theme is never hidden
    // (docs/THEME_FORMAT.md §9).
    clientScripts: manifest.clientScripts,
    assetBase: themeAssetBase(manifest.id, manifest.version),
    files,
    // The official themes the `mallok` package ships, so the admin can say
    // what switching would require without pretending it can do it. A
    // project's own theme lives in its repository and is not listed here.
    available: Object.keys(THEMES),
    switchRequiresDeploy: true,
  });
}

/**
 * Storage counts and schema state.
 *
 * Note what is absent: D1 row-read and row-write quota usage. Those numbers
 * live in the Cloudflare analytics API, not in a binding, so this endpoint
 * cannot report them and does not pretend to (docs/ADMIN.md §11).
 */
export async function getDiagnostics(env: Env): Promise<Response> {
  const [counts, migrations] = await Promise.all([
    countStorage(env.DB),
    appliedMigrations(env.DB),
  ]);
  return json({
    counts,
    migrations,
    pipeline: PIPELINE_VERSION,
    quotaUsage: null,
    quotaUsageNote:
      'D1 row read and write quotas are reported by the Cloudflare dashboard, not by a Worker binding.',
  });
}

function pick<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function jsonOrUndefined(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function emptyToNull(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === '' ? null : value;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
