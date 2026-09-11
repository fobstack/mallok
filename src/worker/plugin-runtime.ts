/**
 * The plugin runtime: enabled-state resolution, context construction, hook
 * dispatch and the `/_mallok/p/<plugin>/<path>` routes
 * (docs/PLUGIN_API.md §5–§7).
 *
 * Plugins are compiled in; the only runtime state is the per-plugin row in
 * `plugin_state` — which is why the enable switch takes effect instantly.
 */

import type { BeforeRenderHook } from '../core/index.js';
import { sha256Hex } from '../core/index.js';
import { loadSiteRenderData, type PluginStateRow } from '../db/queries.js';
import type {
  ContentDraft,
  MallokPlugin,
  PluginContext,
  PluginRenderContext,
  PluginRequestContext,
} from '../plugins/types.js';
import { purgeTags } from './cache.js';
import { compiledPlugins } from './composition.js';
import { queueEmail } from './email.js';
import type { Env } from './env.js';
import { problem } from './http.js';
import { decryptSecret } from './secrets.js';
import { parseSiteSettings, type SiteSettings } from './site.js';

/** Registry lookup by id, built from the composition this build declared. */
function byId(): Map<string, MallokPlugin> {
  return new Map(
    compiledPlugins().map((plugin) => [plugin.manifest.id, plugin]),
  );
}

/** Migrations of every compiled-in plugin, for the boot migrator. */
export function pluginMigrations() {
  return compiledPlugins().flatMap((plugin) => plugin.migrations ?? []);
}

/** Registered plugins with their manifests, for boot seeding and the admin. */
export function registeredPlugins(): readonly MallokPlugin[] {
  return compiledPlugins();
}

/** A plugin the current request may run: implementation plus its state. */
export interface ActivePlugin {
  readonly plugin: MallokPlugin;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly state: PluginStateRow;
}

/** Resolves the enabled plugins out of the state rows a query returned. */
export function activePlugins(rows: readonly PluginStateRow[]): ActivePlugin[] {
  const out: ActivePlugin[] = [];
  for (const row of rows) {
    if (row.enabled !== 1) {
      continue;
    }
    const plugin = byId().get(row.plugin_id);
    if (plugin === undefined) {
      continue;
    }
    out.push({ plugin, settings: parseJson(row.settings), state: row });
  }
  return out;
}

/**
 * The stage-one cache key covers only plugins that declare they change the
 * fragment (docs/PLUGIN_API.md §9); toggling a purely stage-two plugin must
 * not invalidate every fragment.
 */
export async function fragmentPluginHash(
  rows: readonly PluginStateRow[],
): Promise<string> {
  const relevant = activePlugins(rows)
    .filter(({ plugin }) => plugin.manifest.affectsFragmentCache)
    .map(({ state }) => ({
      id: state.plugin_id,
      version: state.version,
      settings: state.settings,
    }));
  if (relevant.length === 0) {
    return '';
  }
  return sha256Hex(JSON.stringify(relevant));
}

/** The `beforeRender` hooks of the enabled plugins, settings bound. */
export function beforeRenderHooks(
  rows: readonly PluginStateRow[],
): BeforeRenderHook[] {
  const hooks: BeforeRenderHook[] = [];
  for (const { plugin, settings } of activePlugins(rows)) {
    const hook = plugin.hooks?.beforeRender;
    if (hook !== undefined) {
      hooks.push((tree, ctx) => hook(tree, { ...ctx, settings }));
    }
  }
  return hooks;
}

/** Runs every enabled `afterRender` hook over the page HTML. */
export async function runAfterRender(
  rows: readonly PluginStateRow[],
  html: string,
  ctx: Omit<PluginRenderContext, 'settings'>,
): Promise<string> {
  let out = html;
  for (const { plugin, settings } of activePlugins(rows)) {
    const hook = plugin.hooks?.afterRender;
    if (hook !== undefined) {
      out = await hook(out, { ...ctx, settings });
    }
  }
  return out;
}

/**
 * Runs every enabled `onContentSave` hook. A hook may throw to reject the
 * save (the message reaches the caller) or return a replacement markdown.
 */
export async function runOnContentSave(
  env: Env,
  executionCtx: ExecutionContext,
  rows: readonly PluginStateRow[],
  site: SiteSettings,
  draft: ContentDraft,
): Promise<ContentDraft> {
  let current = draft;
  for (const active of activePlugins(rows)) {
    const hook = active.plugin.hooks?.onContentSave;
    if (hook === undefined) {
      continue;
    }
    const ctx = await buildPluginContext(env, executionCtx, site, active);
    const result = await hook(current, ctx);
    if (result !== undefined && typeof result.markdown === 'string') {
      current = { ...current, markdown: result.markdown };
    }
  }
  return current;
}

/** Runs every enabled `scheduled` hook inside the cron tick. */
export async function runScheduledHooks(
  env: Env,
  executionCtx: ExecutionContext,
  rows: readonly PluginStateRow[],
  site: SiteSettings,
): Promise<void> {
  for (const active of activePlugins(rows)) {
    const hook = active.plugin.hooks?.scheduled;
    if (hook === undefined) {
      continue;
    }
    const ctx = await buildPluginContext(env, executionCtx, site, active);
    await hook(ctx);
  }
}

/**
 * Collects the files enabled plugins add to a site export.
 *
 * A plugin that fails is reported rather than silently dropped: an export
 * missing its inquiries is worse than one that says which part failed.
 */
export async function collectPluginExports(
  env: Env,
  executionCtx: ExecutionContext,
  rows: readonly PluginStateRow[],
  site: SiteSettings,
): Promise<{
  files: { path: string; text: string }[];
  failed: { plugin: string; error: string }[];
}> {
  const files: { path: string; text: string }[] = [];
  const failed: { plugin: string; error: string }[] = [];
  for (const active of activePlugins(rows)) {
    const hook = active.plugin.exportFiles;
    if (hook === undefined) {
      continue;
    }
    try {
      const ctx = await buildPluginContext(env, executionCtx, site, active);
      for (const file of await hook(ctx)) {
        files.push({ path: file.path, text: file.text });
      }
    } catch (error) {
      failed.push({
        plugin: active.state.plugin_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { files, failed };
}

/**
 * Whether any compiled-in plugin declares `onRequest`. A compile-time
 * constant: when false, the visitor path never reads plugin state before the
 * cache lookup, keeping the cache-hit path at near-zero cost
 * (docs/PLUGIN_API.md §5.1).
 */
export function registryDeclaresOnRequest(): boolean {
  return compiledPlugins().some((plugin) =>
    plugin.manifest.hooks.includes('onRequest'),
  );
}

/**
 * Runs `onRequest` hooks before the cache lookup. The first hook returning a
 * Response short-circuits the request.
 */
export async function runOnRequest(
  request: Request,
  env: Env,
  executionCtx: ExecutionContext,
): Promise<Response | undefined> {
  const data = await loadSiteRenderData(env.DB);
  if (data.site === null) {
    return undefined;
  }
  const site = parseSiteSettings(data.site);
  for (const active of activePlugins(data.plugins)) {
    const hook = active.plugin.hooks?.onRequest;
    if (hook === undefined) {
      continue;
    }
    const ctx = await buildPluginContext(env, executionCtx, site, active);
    const response = await hook(request, ctx);
    if (response !== undefined) {
      return response;
    }
  }
  return undefined;
}

/** JSON of a manifest's declared setting defaults, for first-boot seeding. */
export function defaultSettingsJson(plugin: MallokPlugin): string {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(plugin.manifest.settings)) {
    if (field.default !== undefined) {
      out[key] = field.default;
    }
  }
  return JSON.stringify(out);
}

/** Serves `/_mallok/p/<plugin>/<path>` (docs/PLUGIN_API.md §7.2). */
export async function handlePluginRoute(
  request: Request,
  env: Env,
  executionCtx: ExecutionContext,
  pathname: string,
  rows: readonly PluginStateRow[],
  site: SiteSettings,
): Promise<Response> {
  const match = /^\/_mallok\/p\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/.exec(
    pathname,
  );
  if (match === null) {
    return problem(404, 'Not found.');
  }
  const [, pluginId = '', routePath = ''] = match;
  const active = activePlugins(rows).find(
    (candidate) => candidate.state.plugin_id === pluginId,
  );
  if (active === undefined) {
    return problem(404, 'Not found.');
  }
  const declaration = active.plugin.manifest.routes.find(
    (route) => route.path === routePath,
  );
  const handler = active.plugin.routes?.[routePath];
  if (declaration === undefined || handler === undefined) {
    return problem(404, 'Not found.');
  }
  if (request.method !== declaration.method) {
    return problem(405, 'Method not allowed.');
  }

  // Rate limiting is best-effort by design (docs/SECURITY.md §12.5): with no
  // binding configured the request proceeds.
  if (declaration.rateLimit !== undefined && env.RATE_LIMITER !== undefined) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.RATE_LIMITER.limit({
      key: `${pluginId}:${ip}`,
    });
    if (!success) {
      return problem(429, 'Too many requests. Try again in a minute.');
    }
  }

  const fields = await parseBody(request);
  if (fields === null) {
    return problem(400, 'The request body could not be read.');
  }

  const ctx = await buildRequestContext(
    env,
    executionCtx,
    site,
    active,
    request,
  );

  if (declaration.turnstile) {
    const verdict = await verifyTurnstile(ctx, fields['cf-turnstile-response']);
    if (verdict === 'rejected') {
      return problem(
        403,
        'The anti-spam check did not pass. Reload and try again.',
      );
    }
    // 'unconfigured' proceeds: an operator who has not set Turnstile up gets
    // the honeypot-only degraded mode, not a broken form.
  }

  return handler({ fields }, ctx);
}

async function verifyTurnstile(
  ctx: PluginRequestContext,
  token: string | undefined,
): Promise<'ok' | 'rejected' | 'unconfigured'> {
  const secret = ctx.secrets.turnstile_secret;
  if (secret === undefined || secret === '') {
    return 'unconfigured';
  }
  if (token === undefined || token === '') {
    return 'rejected';
  }
  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token }),
      },
    );
    const body = (await response.json()) as { success?: boolean };
    return body.success === true ? 'ok' : 'rejected';
  } catch {
    return 'rejected';
  }
}

async function parseBody(
  request: Request,
): Promise<Record<string, string> | null> {
  if (request.method === 'GET') {
    return {};
  }
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const parsed: unknown = await request.json();
      if (parsed === null || typeof parsed !== 'object') {
        return null;
      }
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          out[key] = value;
        }
      }
      return out;
    }
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') {
        out[key] = value.slice(0, 10_000);
      }
    }
    return out;
  } catch {
    return null;
  }
}

export async function buildPluginContext(
  env: Env,
  executionCtx: ExecutionContext,
  site: SiteSettings,
  active: ActivePlugin,
): Promise<PluginContext> {
  const secrets = await decryptAll(env, active);
  const pluginId = active.state.plugin_id;
  const from =
    typeof active.settings.from_address === 'string'
      ? active.settings.from_address
      : '';
  return {
    db: env.DB,
    media: env.MEDIA,
    settings: active.settings,
    secrets,
    site,
    sendEmail: (message) =>
      queueEmail(env, executionCtx, pluginId, from, message),
    purgeTags: (tags) => purgeTags(env, tags),
    waitUntil: (promise) => executionCtx.waitUntil(promise),
  };
}

async function buildRequestContext(
  env: Env,
  executionCtx: ExecutionContext,
  site: SiteSettings,
  active: ActivePlugin,
  request: Request,
): Promise<PluginRequestContext> {
  const base = await buildPluginContext(env, executionCtx, site, active);
  const url = new URL(request.url);
  const ip = request.headers.get('cf-connecting-ip');
  const country =
    (request.cf as { country?: string } | undefined)?.country ?? null;
  return {
    ...base,
    request,
    url,
    locale: site.defaultLocale,
    country,
    ipHash: ip === null ? null : await sha256Hex(`${ip}${env.MALLOK_SECRET}`),
  };
}

async function decryptAll(
  env: Env,
  active: ActivePlugin,
): Promise<Record<string, string>> {
  const stored = parseJson(active.state.secrets);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(stored)) {
    if (typeof value !== 'string') {
      continue;
    }
    const plain = await decryptSecret(
      env.MALLOK_SECRET,
      active.state.plugin_id,
      name,
      value,
    );
    if (plain !== null) {
      out[name] = plain;
    }
  }
  return out;
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
