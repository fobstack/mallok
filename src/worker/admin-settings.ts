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
  joinTagline,
  LOCALE_PATTERN,
  linkForPrefix,
  localizeThemeManifest,
  PIPELINE_VERSION,
  pickAdminCatalog,
  type SiteLocales,
  slugPlacementProblem,
  splitTagline,
  themeAssetBase,
} from '../core/index.js';
import {
  appliedMigrations,
  countStorage,
  failedJobs,
  listContentLocations,
  listTags,
  loadSite,
  loadSiteRenderData,
  movePathStatements,
  type PathMove,
  type SitePatch,
  setDefaultLocaleStatement,
  setPrefixDefaultLocaleStatement,
  updateSite,
} from '../db/queries.js';
import { THEMES } from '../themes/index.js';
import {
  type PurgeFailure,
  parsePurgeFailure,
  purgeFailureAdvice,
  purgeTags,
} from './cache.js';
import { activeTheme } from './composition.js';
import type { Env } from './env.js';
import { json, preferredLanguages, problem, readJson } from './http.js';
import { parseSiteSettings, type SiteSettings } from './site.js';
import { siteEmailView } from './site-email.js';

/** Failed background jobs listed in diagnostics, newest first. */
const FAILED_JOBS_SHOWN = 20;
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
    // One tagline, or one per language keyed by locale, the way `nav` is.
    tagline: z.union([
      z.string().max(300).nullable(),
      z.record(z.string().regex(LOCALE_PATTERN), z.string().max(300)),
    ]),
    locales: z.array(z.string().regex(LOCALE_PATTERN)).min(1),
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
    /** The same: it rewrites every URL, so it has its own endpoint. */
    prefixDefaultLocale: z.boolean(),
  })
  .partial();

/**
 * The columns a submitted tagline becomes. A string replaces the tagline for
 * every language; a map sets each language's own.
 */
function taglinePatch(
  value: string | Readonly<Record<string, string>> | null | undefined,
  defaultLocale: string,
): Pick<SitePatch, 'tagline' | 'taglines'> {
  if (value === undefined) {
    return {};
  }
  const stored = splitTagline(value, defaultLocale);
  return {
    tagline: value === null || stored.tagline === '' ? null : stored.tagline,
    taglines: JSON.stringify(stored.taglines),
  };
}

/** Returns the site settings the admin may edit. */
export async function getSettings(env: Env): Promise<Response> {
  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(row);
  return json({
    name: settings.name,
    tagline: joinTagline(settings, settings.defaultLocale),
    defaultLocale: settings.defaultLocale,
    prefixDefaultLocale: settings.prefixDefaultLocale,
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
    email: siteEmailView(row),
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

  if (
    input.prefixDefaultLocale !== undefined &&
    input.prefixDefaultLocale !== (row.prefix_default_locale === 1)
  ) {
    return problem(
      409,
      'Prefixing the default locale rewrites every URL. Use POST /_mallok/api/settings/locale-prefix.',
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

  if (input.locales !== undefined || input.kinds !== undefined) {
    const current = parseSiteSettings(row);
    const stranded = await strandedSlugs(env.DB, {
      locales: input.locales ?? current.locales,
      kinds: input.kinds ?? current.kinds,
    });
    if (stranded.length > 0) {
      return json(
        {
          error: `${stranded.length} slug${stranded.length === 1 ? '' : 's'} would start at an address the new settings give to a language or a kind. Change ${stranded.length === 1 ? 'it' : 'them'} first.`,
          stranded,
        },
        { status: 409 },
      );
    }
  }

  const patch: SitePatch = {
    ...pick('name', input.name),
    ...taglinePatch(input.tagline, row.default_locale),
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
  ctx.waitUntil(purgeTags(env, ['site'], 'settings'));
  return getSettings(env);
}

/**
 * Content whose slug of several segments the given settings would refuse.
 *
 * A save checks a slug against the languages and kind bases as they are
 * (`slugPlacementProblem`). Enabling `de`, or giving a kind the base `docs`,
 * changes what is free: a page at `/de/pricing` or `/docs/setup` would then
 * share its first segment with the language's or kind's addresses, and one
 * of the two would never be served. Only slugs with a `/` can clash, so only
 * those rows are read.
 */
async function strandedSlugs(
  db: D1Database,
  site: Pick<SiteSettings, 'locales' | 'kinds'>,
): Promise<{ id: string; path: string; problem: string }[]> {
  const { results } = await db
    .prepare(
      "SELECT id, kind, slug, path FROM content WHERE instr(slug, '/') > 0",
    )
    .all<{ id: string; kind: string; slug: string; path: string }>();
  const stranded: { id: string; path: string; problem: string }[] = [];
  for (const row of results) {
    const kind = site.kinds[row.kind];
    if (kind === undefined) {
      continue;
    }
    const refused = slugPlacementProblem(row.slug, kind.base, site);
    if (refused !== null) {
      stranded.push({ id: row.id, path: row.path, problem: refused.message });
    }
  }
  return stranded;
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
    // A purge that ran in the background and failed: the pages it named may
    // still be served stale (src/worker/cache.ts).
    lastPurgeFailure: withAdvice(
      parsePurgeFailure(data.site?.last_purge_failure ?? null),
    ),
    customDomain: data.site?.domain ?? null,
    mediaBaseUrl: data.site?.media_base_url ?? null,
  });
}

/** A stored purge failure with what the operator should check. */
function withAdvice(
  failure: PurgeFailure | null,
): (PurgeFailure & { advice: string }) | null {
  return failure === null
    ? null
    : { ...failure, advice: purgeFailureAdvice(failure.status) };
}

const defaultLocaleSchema = z.object({
  locale: z.string().regex(LOCALE_PATTERN),
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
      prefixDefaultLocale: settings.prefixDefaultLocale,
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
  // One batch, one transaction: every path and the setting move together.
  await env.DB.batch([
    ...movePathStatements(env.DB, [...gaining, ...losing], now),
    setDefaultLocaleStatement(env.DB, target, now),
  ]);
  ctx.waitUntil(purgeTags(env, ['site'], 'settings'));

  return json({
    defaultLocale: target,
    moved: gaining.length + losing.length,
    redirects: gaining.length + losing.length,
  });
}

const localePrefixSchema = z.object({
  enabled: z.boolean(),
  /** Required: this rewrites every public URL on the site. */
  confirm: z.literal(true),
});

/**
 * Turns the default locale's prefix on or off (docs/ARCHITECTURE.md §9).
 *
 * Every content row of the default locale moves — `/about` to `/en/about`,
 * or back — and a 301 is recorded from each old path, so no external link
 * breaks: an old unprefixed address answers with a redirect, never with a
 * second copy of the page. Only the default locale's rows move, all in the
 * same direction, so no row claims a path another still holds; a target that
 * is already taken refuses the whole change before anything is written.
 */
export async function postLocalePrefix(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = localePrefixSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(
      400,
      'Provide "enabled": true or false, and "confirm": true; this rewrites every URL.',
    );
  }
  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(row);
  const enabled = parsed.data.enabled;
  if (enabled === settings.prefixDefaultLocale) {
    return json({ prefixDefaultLocale: enabled, moved: 0, unchanged: true });
  }
  const result = await changeLocalePrefix(env, settings, enabled);
  if ('clash' in result) {
    return problem(
      409,
      `"${result.clash.from}" would move to "${result.clash.to}", which another item already uses. Change one of their slugs first. Nothing was changed.`,
    );
  }
  ctx.waitUntil(purgeTags(env, ['site'], 'settings'));
  return json({
    prefixDefaultLocale: enabled,
    moved: result.moved,
    redirects: result.moved,
  });
}

/**
 * The navigation, rewritten for the prefix setting.
 *
 * Its links are the site's own paths (`/products`), written for the setting
 * as it was. Left alone they would each cost a redirect, and a list page has
 * no redirect to fall back on. The view maps them while the prefix is on
 * (`linkForPrefix`), but turning it off has to put them back, and what is
 * stored should be what is served. Every locale's entries are rewritten,
 * because a link to the default locale's page can sit in any of them; a link
 * under another locale, an absolute URL or an admin path is left alone.
 */
export function prefixNavigation(
  nav: SiteSettings['nav'],
  site: SiteLocales,
  enabled: boolean,
): SiteSettings['nav'] {
  return Object.fromEntries(
    Object.entries(nav).map(([locale, entries]) => [
      locale,
      entries.map((entry) => ({
        ...entry,
        href: linkForPrefix(entry.href, site, enabled),
      })),
    ]),
  );
}

/**
 * The default locale's pages that have no content row, and so no redirect of
 * their own when the prefix changes: the home page, each list and each tag
 * archive in use. Unprefixed, as the setting off writes them.
 */
async function addressesWithoutRows(
  env: Env,
  settings: SiteSettings,
): Promise<string[]> {
  const tags = await listTags(
    env.DB,
    settings.defaultLocale,
    new Date().toISOString(),
  );
  const bases = Object.values(settings.kinds)
    .map((kind) => kind.base)
    .filter((base) => base !== '');
  return [
    '/',
    ...bases.map((base) => `/${base}`),
    ...tags.map(({ tag }) => `/tags/${encodeURIComponent(tag)}`),
  ];
}

/**
 * Redirects for {@link addressesWithoutRows} when the prefix is turned off.
 *
 * Turning it on needs none: an unprefixed list or tag address is worked out
 * and redirected as it is asked for (`content.page.ts`, `tag.page.ts`), and
 * `/` always redirects then. Turning it off leaves `/en`, `/en/products` and
 * `/en/tags/x` — in bookmarks, in search results, cached as a 301 by
 * browsers — with nothing to answer; those are recorded here, and removed
 * again if the prefix comes back on, when they are real addresses.
 */
function prefixRedirectStatements(
  db: D1Database,
  pages: readonly string[],
  defaultLocale: string,
  enabled: boolean,
  now: string,
): D1PreparedStatement[] {
  return pages.map((page) => {
    const prefixed = `/${defaultLocale}${page === '/' ? '' : page}`;
    return enabled
      ? db.prepare('DELETE FROM redirect WHERE from_path = ?').bind(prefixed)
      : db
          .prepare(
            `INSERT OR REPLACE INTO redirect
               (from_path, to_path, status, content_id, created_at)
             VALUES (?, ?, 301, NULL, ?)`,
          )
          .bind(prefixed, page, now);
  });
}

/**
 * Moves every content path to where `enabled` puts it, records a redirect
 * from each old one, and stores the setting. Refuses, writing nothing, when
 * a path would land on one another item holds. Shared by the settings
 * endpoint and the setup wizard, which applies a starter's choice.
 */
export async function changeLocalePrefix(
  env: Env,
  settings: SiteSettings,
  enabled: boolean,
): Promise<{ moved: number } | { clash: PathMove }> {
  const locations = await listContentLocations(env.DB);
  const moves: PathMove[] = [];
  for (const item of locations) {
    const to = buildPublicPath({
      kind: item.kind,
      locale: item.locale,
      defaultLocale: settings.defaultLocale,
      prefixDefaultLocale: enabled,
      slug: item.slug,
      base: settings.kinds[item.kind]?.base ?? '',
    });
    if (to !== item.path) {
      moves.push({ id: item.id, from: item.path, to });
    }
  }
  // With the paths the rules allow, no target is anybody's current path: the
  // default locale's rows all gain, or all lose, the same prefix. A path set
  // by hand can break that, and the database would then refuse halfway.
  const held = new Set(locations.map((item) => item.path));
  const targets = new Set<string>();
  const clash = moves.find((move) => {
    const taken = held.has(move.to) || targets.has(move.to);
    targets.add(move.to);
    return taken;
  });
  if (clash !== undefined) {
    return { clash };
  }
  const now = new Date().toISOString();
  const pages = await addressesWithoutRows(env, settings);
  // One batch, one transaction: every path, the navigation and the setting
  // move together, or none of them does.
  await env.DB.batch([
    ...movePathStatements(env.DB, moves, now),
    ...prefixRedirectStatements(
      env.DB,
      pages,
      settings.defaultLocale,
      enabled,
      now,
    ),
    setPrefixDefaultLocaleStatement(
      env.DB,
      enabled,
      JSON.stringify(prefixNavigation(settings.nav, settings, enabled)),
      now,
    ),
  ]);
  return { moved: moves.length };
}

/**
 * The active theme: what it is, what it can render, and its templates.
 *
 * The admin needs the templates so its live preview runs the same stage-two
 * render as the site does (docs/ADMIN.md §6.3), and it needs the manifest to
 * generate the field and option forms. There is nothing to POST here: the
 * theme is a build-time constant.
 *
 * The words of the manifest — kind, field, group and option labels, help,
 * the description — are in the admin's interface language when the theme
 * has an admin catalog for it (`Accept-Language`; docs/THEME_FORMAT.md
 * §10.1). `declared` keeps them as the theme wrote them, because the preview
 * must render exactly what the site renders, and a page reads a kind's
 * label. No response under `/_mallok/` is cached, so the header varies
 * nothing at the edge.
 */
export function getTheme(request: Request): Response {
  const { manifest: declared, files } = activeTheme();
  const manifest = localizeThemeManifest(
    declared,
    pickAdminCatalog(
      files,
      preferredLanguages(request.headers.get('accept-language')),
    ),
  );
  return json({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? '',
    kinds: manifest.kinds,
    options: manifest.options,
    declared: {
      name: declared.name,
      description: declared.description ?? '',
      kinds: declared.kinds,
      options: declared.options,
      clientScripts: declared.clientScripts,
    },
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
  const [counts, migrations, failed] = await Promise.all([
    countStorage(env.DB),
    appliedMigrations(env.DB),
    failedJobs(env.DB, FAILED_JOBS_SHOWN),
  ]);
  return json({
    counts,
    migrations,
    // Background work that ran out of attempts: an email that could not be
    // sent, a plugin's job that kept throwing. Shown so that it is found by
    // looking, not by a customer asking where their confirmation went.
    failedJobs: failed.map((job) => ({
      type: job.type,
      lastError: job.last_error,
      updatedAt: job.updated_at,
    })),
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
