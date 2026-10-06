/**
 * The first-run wizard (docs/ADMIN.md §5, docs/ARCHITECTURE.md §15).
 *
 * All three deployment paths land here. It runs **once**: as soon as
 * `site.setup_completed_at` is set, every route in this file answers 404, so
 * a public site can never be re-seeded by someone who finds the URL.
 *
 * Two things it must say honestly rather than hide:
 *
 * - without a custom domain, the edge cache is not in play and the
 *   `.workers.dev` address is a preview, not a site (`ARCHITECTURE §2`);
 * - without a purge token, a saved change reaches readers when the cached
 *   page expires, so the wizard lowers `cache_ttl` and says why
 *   (`CLOUDFLARE_RESOURCES.md §6`).
 */

import { z } from 'zod';
import { LOCALE_PATTERN, splitTagline } from '../core/index.js';
import { countAdminUsers } from '../db/auth.js';
import {
  findContentById,
  findPluginState,
  loadSite,
  setDefaultLocale,
  setPluginEnabled,
  updateSite,
} from '../db/queries.js';
import { STARTERS } from '../starters/index.js';
import type { Starter, StarterRecord } from '../starters/types.js';
import { bootstrapAdmin } from './admin-auth.js';
import { saveContent } from './admin-content.js';
import { savePluginRecord } from './admin-plugins.js';
import { authenticate } from './auth.js';
import { purgeTags } from './cache.js';
import { activeTheme, compiledPlugins, siteStarters } from './composition.js';
import type { Env } from './env.js';
import { json, problem } from './http.js';
import { buildPluginContext } from './plugin-runtime.js';
import { parseSiteSettings } from './site.js';

/** Cache lifetime used while no purge token is configured. */
const UNPURGEABLE_TTL = 60;

const siteStepSchema = z.object({
  name: z.string().min(1).max(120),
  defaultLocale: z.string().regex(LOCALE_PATTERN),
  locales: z.array(z.string().regex(LOCALE_PATTERN)).min(1),
});

const starterStepSchema = z.object({
  starter: z.string().min(1),
});

/**
 * The starters the wizard offers: the site's own first, in the order it
 * listed them, then the ones Mallok ships (docs/ARCHITECTURE.md §11).
 *
 * The site's come first because the wizard preselects the first one, and a
 * site that brought a starter brought it to be used.
 */
function offeredStarters(): readonly Starter[] {
  return [...siteStarters(), ...STARTERS];
}

/** Reports where setup stands and what the deployment can actually do. */
export async function getSetupStatus(env: Env): Promise<Response> {
  const row = await loadSite(env.DB);
  const admins = await countAdminUsers(env.DB);
  const hasSetupKey =
    env.MALLOK_SETUP_KEY !== undefined && env.MALLOK_SETUP_KEY !== '';
  // The same judgement `checkSetupKey` makes, read from the same switch: a
  // key is required unless the explicit development switch is set.
  const allowsSetupWithoutKey =
    (env.MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY ?? '').toLowerCase() === 'true';
  return json({
    completed: row?.setup_completed_at !== null && row !== null,
    hasAdmin: admins > 0,
    site:
      row === null
        ? null
        : {
            name: row.name,
            defaultLocale: row.default_locale,
            domain: row.domain,
            mediaBaseUrl: row.media_base_url,
          },
    // Whether the wizard will ask for the one-time key `mallok create`
    // printed. The key itself is never sent anywhere, in either direction.
    //
    // A key is required unless the explicit development switch says
    // otherwise, which is the same rule `checkSetupKey` applies — the two
    // must agree, or the form asks for something the endpoint ignores.
    requiresSetupKey: !allowsSetupWithoutKey,
    /**
     * Whether the wizard can be completed at all.
     *
     * False on a site that requires a key it has not been given: the form
     * would be unsubmittable, and saying so is better than a refusal per
     * attempt.
     */
    ready: allowsSetupWithoutKey || hasSetupKey,
    theme: {
      id: activeTheme().manifest.id,
      name: activeTheme().manifest.name,
      version: activeTheme().manifest.version,
    },
    starters: offeredStarters().map((starter) => ({
      id: starter.id,
      name: starter.name,
      description: starter.description,
      theme: starter.theme,
      documents: starter.documents.length,
      // Sample data for the starter's plugins, such as product variants.
      records: starter.records?.length ?? 0,
      // Said plainly: a starter written for another theme still imports, but
      // its content types fall back to the page layout
      // (docs/THEME_FORMAT.md §5.3).
      matchesActiveTheme: starter.theme === activeTheme().manifest.id,
    })),
    // Facts the wizard has to be honest about rather than discover later.
    purgeConfigured:
      env.CF_API_TOKEN !== undefined && env.CF_ZONE_ID !== undefined,
    customDomain: row?.domain ?? null,
  });
}

/** Applies one wizard step. */
export async function handleSetup(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  step: string,
): Promise<Response> {
  const row = await loadSite(env.DB);
  if (row !== null && row.setup_completed_at !== null) {
    // Setup is over for good; the routes stop existing.
    return problem(404, 'Not found.');
  }

  if (request.method === 'GET' && step === 'status') {
    return getSetupStatus(env);
  }
  if (request.method !== 'POST') {
    return problem(405, 'Method not allowed.');
  }

  // The first step creates the administrator and is the only unauthenticated
  // one; everything after it needs that account.
  if (step === 'admin') {
    return bootstrapAdmin(request, env, new Date());
  }
  const principal = await authenticate(request, env, new Date());
  if (principal === null) {
    return problem(401, 'Sign in as the administrator to continue.');
  }

  switch (step) {
    case 'site':
      return applySite(request, env, ctx);
    case 'starter':
      return applyStarter(request, env, ctx);
    case 'complete':
      return complete(env, ctx);
    default:
      return problem(404, 'Not found.');
  }
}

async function applySite(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = siteStepSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return problem(
      400,
      'Provide a site name, a default language and a language list.',
    );
  }
  const input = parsed.data;
  if (!input.locales.includes(input.defaultLocale)) {
    return problem(400, 'The language list must include the default language.');
  }
  const purgeConfigured =
    env.CF_API_TOKEN !== undefined && env.CF_ZONE_ID !== undefined;
  // `SitePatch` deliberately excludes `default_locale`, because changing it
  // on a live site rewrites every URL (docs/DATA_MODEL.md §2.2). During setup
  // there is no content yet, so there is nothing to rewrite — which is why
  // this is the one place that may set it directly.
  await setDefaultLocale(env.DB, input.defaultLocale, new Date().toISOString());
  await updateSite(
    env.DB,
    {
      name: input.name,
      locales: JSON.stringify(input.locales),
      // An honest degradation, not a failure: without a purge token a shorter
      // cache lifetime is what keeps edits visible in a reasonable time.
      ...(purgeConfigured ? {} : { cache_ttl: UNPURGEABLE_TTL }),
    },
    new Date().toISOString(),
  );
  ctx.waitUntil(purgeTags(env, ['site']));
  return json({ ok: true, cacheTtlLowered: !purgeConfigured });
}

async function applyStarter(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = starterStepSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return problem(400, 'Name a starter to install.');
  }
  const starter = offeredStarters().find(
    (candidate) => candidate.id === parsed.data.starter,
  );
  if (starter === undefined) {
    return problem(404, `No starter named "${parsed.data.starter}".`);
  }

  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(row);

  // A starter proposes settings; they are written before the content so the
  // documents land at the paths the starter's navigation points at.
  //
  // Locales are merged, not replaced: the operator's choice in step 2 stays,
  // and the starter's languages are added so its translations have somewhere
  // to live.
  const locales = [...settings.locales];
  for (const locale of starter.settings.locales ?? []) {
    if (!locales.includes(locale)) {
      locales.push(locale);
    }
  }
  await updateSite(
    env.DB,
    {
      ...starterTagline(starter.settings.tagline, settings.defaultLocale),
      locales: JSON.stringify(locales),
      kinds: JSON.stringify(starter.settings.kinds),
      nav: JSON.stringify(starter.settings.nav),
      theme_options: JSON.stringify(starter.settings.themeOptions),
    },
    new Date().toISOString(),
  );

  for (const pluginId of starter.plugins) {
    await setPluginEnabled(env.DB, pluginId, true, new Date().toISOString());
  }

  // Imported one at a time through the ordinary save path, so a starter's
  // content is indistinguishable from typed content the moment it lands
  // (docs/ARCHITECTURE.md §11).
  const created: string[] = [];
  const failed: { slug: string; error: string }[] = [];
  /** Where each default-locale document landed, for records attached to it. */
  const documentIds = new Map<string, string>();

  const save = async (
    body: Record<string, unknown>,
  ): Promise<string | null> => {
    const response = await saveContent(
      new Request('https://setup.internal/_mallok/api/content', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, assets: {}, status: 'published' }),
      }),
      env,
      ctx,
    );
    if (response.ok) {
      const result = (await response.json()) as { id?: string };
      return result.id ?? '';
    }
    const error = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    failed.push({
      slug: String(body.slug ?? ''),
      error: error?.error ?? `HTTP ${response.status}`,
    });
    return null;
  };

  for (const document of starter.documents) {
    const id = await save({
      kind: document.kind,
      locale: settings.defaultLocale,
      slug: document.slug,
      markdown: document.markdown,
    });
    if (id === null) {
      continue;
    }
    created.push(document.slug);
    documentIds.set(`${document.kind}/${document.slug}`, id);

    // Translations join the item's own group, so hreflang is correct on a
    // brand-new site rather than being left to the owner
    // (docs/ARCHITECTURE.md §9).
    const entries = Object.entries(document.translations ?? {});
    if (entries.length === 0) {
      continue;
    }
    const detail = await findContentById(env.DB, id);
    if (detail === null) {
      continue;
    }
    for (const [locale, translation] of entries) {
      if (!locales.includes(locale)) {
        continue;
      }
      const translated = await save({
        kind: document.kind,
        locale,
        slug: translation.slug,
        translationGroup: detail.translation_group,
        markdown: translation.markdown,
      });
      if (translated !== null) {
        created.push(`${translation.slug} (${locale})`);
      }
    }
  }

  const records = await importRecords(
    env,
    ctx,
    starter.records ?? [],
    documentIds,
  );

  ctx.waitUntil(purgeTags(env, ['site']));
  return json({
    starter: starter.id,
    created: created.length,
    failed,
    plugins: starter.plugins,
    records: records.created,
    failedRecords: records.failed,
  });
}

/**
 * Imports a starter's sample plugin data, one record at a time, through the
 * path the admin's own form takes (`savePluginRecord`): the values are
 * checked against the fields the panel declares and the plugin's `save`
 * handler does the writing. The wizard never touches a plugin's tables.
 *
 * A record that is refused, or whose handler throws, is reported and the
 * rest go on: sample data that is partly there is more use than a wizard
 * that stops halfway through a site.
 */
async function importRecords(
  env: Env,
  ctx: ExecutionContext,
  records: readonly StarterRecord[],
  documentIds: ReadonlyMap<string, string>,
): Promise<{
  created: number;
  failed: { record: string; error: string }[];
}> {
  const failed: { record: string; error: string }[] = [];
  let created = 0;
  if (records.length === 0) {
    return { created, failed };
  }
  // Read again: the starter's settings were written a moment ago, and a
  // plugin's context carries the site as it now is.
  const row = await loadSite(env.DB);
  if (row === null) {
    return { created, failed };
  }
  const site = parseSiteSettings(row);
  const groups = new Map<string, string | null>();

  for (const [index, record] of records.entries()) {
    const label = `${record.plugin}/${record.panel} #${index + 1}`;
    try {
      const plugin = compiledPlugins().find(
        (candidate) => candidate.manifest.id === record.plugin,
      );
      const state =
        plugin === undefined
          ? null
          : await findPluginState(env.DB, record.plugin);
      if (plugin === undefined || state === null) {
        failed.push({ record: label, error: 'The plugin is not installed.' });
        continue;
      }

      let attachedTo: string | undefined;
      if (record.attachedTo !== undefined) {
        const key = `${record.attachedTo.kind}/${record.attachedTo.slug}`;
        if (!groups.has(key)) {
          const id = documentIds.get(key);
          const owner =
            id === undefined ? null : await findContentById(env.DB, id);
          groups.set(key, owner?.translation_group ?? null);
        }
        const group = groups.get(key) ?? null;
        if (group === null) {
          failed.push({
            record: label,
            error: `The ${key} it belongs to was not imported.`,
          });
          continue;
        }
        attachedTo = group;
      }

      const outcome = await savePluginRecord(
        env,
        plugin,
        record.panel,
        await buildPluginContext(env, ctx, site, {
          plugin,
          settings: parseSettings(state.settings),
          state,
        }),
        { id: null, values: record.values, attachedTo },
      );
      if ('problem' in outcome) {
        const fields = Object.entries(outcome.errors ?? {})
          .map(([field, message]) => `${field}: ${message}`)
          .join('; ');
        failed.push({
          record: label,
          error: fields === '' ? outcome.problem : fields,
        });
        continue;
      }
      created += 1;
    } catch (error) {
      failed.push({
        record: label,
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          200,
        ),
      });
    }
  }
  return { created, failed };
}

/** A starter's tagline — one string or one per language — as columns. */
function starterTagline(
  value: Starter['settings']['tagline'],
  defaultLocale: string,
): { tagline: string; taglines: string } {
  const stored = splitTagline(value, defaultLocale);
  return { tagline: stored.tagline, taglines: JSON.stringify(stored.taglines) };
}

/** A plugin's stored settings; an unreadable value is no settings. */
function parseSettings(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function complete(env: Env, ctx: ExecutionContext): Promise<Response> {
  const now = new Date().toISOString();
  const row = await loadSite(env.DB);
  // Mutable while it is assembled; `SitePatch`'s fields are readonly.
  const patch: {
    setup_completed_at: string;
    domain?: string;
    media_base_url?: string;
  } = { setup_completed_at: now };

  // The domain provisioning bound, written where the renderer reads it.
  // `site.domain` decides canonical URLs, hreflang and the sitemap; a site
  // serving example.com while the database says nothing publishes canonical
  // links to its `.workers.dev` preview.
  const provisioned = env.MALLOK_DOMAIN ?? '';
  if (provisioned !== '' && (row?.domain ?? '') === '') {
    patch.domain = provisioned;
  }

  // `media_base_url` is deliberately **not** guessed here.
  //
  // Attaching `media.<domain>` to the R2 bucket happens in the Cloudflare
  // dashboard, so whether it exists is a fact about the account rather than
  // about this deployment. An earlier version probed the hostname with a
  // HEAD from inside the Worker, which made the wizard's last step depend on
  // DNS and left a "Network connection lost" in the logs when it did not
  // resolve. `mallok create` reports the bucket's real custom domains through
  // `wrangler r2 bucket domain list`, and the value is set in
  // Settings → Site, where the person who attached it can confirm it.

  await updateSite(env.DB, patch, now);
  ctx.waitUntil(purgeTags(env, ['site']));
  return json({
    completed: now,
    domain: patch.domain ?? row?.domain ?? null,
    mediaBaseUrl: patch.media_base_url ?? row?.media_base_url ?? null,
  });
}
