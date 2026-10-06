/**
 * The plugin runtime: enabled-state resolution, context construction, hook
 * dispatch and the `/_mallok/p/<plugin>/<path>` routes
 * (docs/PLUGIN_API.md §5–§7).
 *
 * Plugins are compiled in; the only runtime state is the per-plugin row in
 * `plugin_state` — which is why the enable switch takes effect instantly.
 */

import type { BeforeRenderHook } from '../core/index.js';
import {
  exportPathKey,
  exportPathProblem,
  matchPluginRoute,
  RAW_BODY_BYTES_DEFAULT,
  sha256Hex,
  themeStrings,
} from '../core/index.js';
import {
  completeJob,
  dueJobsByPrefix,
  enqueueJobStatement,
  failJob,
  loadSiteRenderData,
  type PluginStateRow,
  stuckJobsByPrefix,
} from '../db/queries.js';
import type {
  ContentDeleteRef,
  ContentDraft,
  MallokPlugin,
  PluginContext,
  PluginRenderContext,
  PluginRequestContext,
} from '../plugins/types.js';
import { pluginPurgeTags, purgeTags } from './cache.js';
import { activeTheme, compiledPlugins } from './composition.js';
import { queueEmail, STUCK_CLAIM_MS } from './email.js';
import type { Env } from './env.js';
import { problem } from './http.js';
import {
  crossSiteProblem,
  isPageResult,
  renderPluginPage,
} from './plugin-pages.js';
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
  ctx: Omit<PluginRenderContext, 'settings' | 't'>,
): Promise<string> {
  let out = html;
  // Read once, and only when a hook is there to use it.
  let strings: Readonly<Record<string, string>> | undefined;
  for (const { plugin, settings } of activePlugins(rows)) {
    const hook = plugin.hooks?.afterRender;
    if (hook !== undefined) {
      if (strings === undefined) {
        const theme = activeTheme();
        strings = themeStrings(theme.manifest, theme.files, ctx.locale);
      }
      out = await hook(out, { ...ctx, settings, t: strings });
    }
  }
  return out;
}

/** A save a plugin's `onContentSave` hook refused, and which plugin. */
export class ContentSaveRejected extends Error {
  readonly pluginId: string;

  constructor(pluginId: string, message: string) {
    super(message);
    this.name = 'ContentSaveRejected';
    this.pluginId = pluginId;
  }
}

/** Whether any enabled plugin implements `hook`. */
export function anyPluginHas(
  rows: readonly PluginStateRow[],
  hook: 'onContentSave' | 'onContentDelete',
): boolean {
  return activePlugins(rows).some(
    ({ plugin }) => plugin.hooks?.[hook] !== undefined,
  );
}

/**
 * Runs every enabled `onContentSave` hook, each seeing what the one before
 * it returned. A hook may return a replacement markdown, or throw to refuse
 * the save: that surfaces as {@link ContentSaveRejected}, carrying the
 * hook's message for the caller.
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
    let result: Awaited<ReturnType<typeof hook>>;
    try {
      result = await hook(current, ctx);
    } catch (error) {
      throw new ContentSaveRejected(
        active.state.plugin_id,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (result !== undefined && typeof result.markdown === 'string') {
      current = { ...current, markdown: result.markdown };
    }
  }
  return current;
}

/**
 * Runs every enabled `onContentDelete` hook after a delete.
 *
 * The content is already gone, so a failing hook cannot undo anything: it is
 * logged, the other plugins still run, and the ids of those that failed are
 * returned so the caller can say the cleanup was incomplete.
 */
export async function runOnContentDelete(
  env: Env,
  executionCtx: ExecutionContext,
  rows: readonly PluginStateRow[],
  site: SiteSettings,
  ref: ContentDeleteRef,
): Promise<string[]> {
  const failed: string[] = [];
  for (const active of activePlugins(rows)) {
    const hook = active.plugin.hooks?.onContentDelete;
    if (hook === undefined) {
      continue;
    }
    try {
      await hook(
        ref,
        await buildPluginContext(env, executionCtx, site, active),
      );
    } catch (error) {
      failed.push(active.state.plugin_id);
      console.warn(
        JSON.stringify({
          event: 'content_delete_hook_failed',
          plugin: active.state.plugin_id,
          content: ref.id,
          reason: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 200),
        }),
      );
    }
  }
  return failed;
}

/**
 * Runs every enabled `scheduled` hook inside the cron tick.
 *
 * Each plugin on its own: one whose hook throws is logged with its id and
 * the rest still run. Before plugin API 2 the first failure ended the tick
 * for every plugin after it.
 */
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
    try {
      await hook(await buildPluginContext(env, executionCtx, site, active));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'plugin_scheduled_error',
          plugin: active.state.plugin_id,
          message: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 200),
        }),
      );
    }
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
  reservedPaths: readonly string[] = [],
): Promise<{
  files: { path: string; text: string }[];
  failed: { plugin: string; error: string }[];
}> {
  const files: { path: string; text: string }[] = [];
  const failed: { plugin: string; error: string }[] = [];
  let claimed = new Map<string, string>();
  for (const path of reservedPaths) {
    claimExportPath(claimed, path, 'the core export');
  }
  const exportingPlugins = [...activePlugins(rows)].sort((left, right) =>
    left.state.plugin_id < right.state.plugin_id
      ? -1
      : left.state.plugin_id > right.state.plugin_id
        ? 1
        : 0,
  );
  for (const active of exportingPlugins) {
    const hook = active.plugin.exportFiles;
    if (hook === undefined) {
      continue;
    }
    try {
      const ctx = await buildPluginContext(env, executionCtx, site, active);
      const returned: unknown = await hook(ctx);
      if (!Array.isArray(returned)) {
        throw new Error('exportFiles must return an array.');
      }

      // Validate one plugin atomically. If its last file is unsafe or collides,
      // none of its earlier files enter the manifest.
      const nextClaims = new Map(claimed);
      const nextFiles: { path: string; text: string }[] = [];
      for (const value of returned as readonly unknown[]) {
        if (
          value === null ||
          typeof value !== 'object' ||
          typeof (value as { path?: unknown }).path !== 'string' ||
          typeof (value as { text?: unknown }).text !== 'string'
        ) {
          throw new Error(
            'exportFiles entries must be { path: string, text: string } objects.',
          );
        }
        const file = value as { path: string; text: string };
        claimExportPath(
          nextClaims,
          file.path,
          `plugin "${active.state.plugin_id}"`,
        );
        nextFiles.push({ path: file.path, text: file.text });
      }
      claimed = nextClaims;
      files.push(...nextFiles);
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
 * Claims one portable export path, rejecting filesystem escapes and aliases.
 *
 * Export manifests are consumed on the operator's machine, which may use a
 * different path syntax and a case-insensitive filesystem. Backslashes and
 * drive prefixes are therefore unsafe even while this code runs on workerd.
 */
function claimExportPath(
  claimed: Map<string, string>,
  path: string,
  owner: string,
): void {
  const problem = exportPathProblem(path);
  if (problem !== null) {
    throw new Error(`Export path ${JSON.stringify(path)} ${problem}.`);
  }
  const key = exportPathKey(path);
  const previous = claimed.get(key);
  if (previous !== undefined) {
    throw new Error(
      `Export path ${JSON.stringify(path)} is already produced by ${previous}.`,
    );
  }
  claimed.set(key, owner);
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
    const ctx = await buildRequestContext(
      env,
      executionCtx,
      site,
      active,
      request,
    );
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

const PLUGIN_ROUTE_PREFIX = '/_mallok/p/';
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
/** Longest path segment a route parameter may capture. */
const ROUTE_PARAM_MAX = 200;

/**
 * Serves `/_mallok/p/<plugin>/[<locale>/]<path>` (docs/PLUGIN_API.md §7.2).
 *
 * For a plugin declaring API 2 the path may have several segments and
 * parameters, and a first segment that is one of the site's locales is the
 * request's locale rather than part of the route. A version 1 plugin's routes
 * are matched exactly as before: one segment, the default locale.
 */
export async function handlePluginRoute(
  request: Request,
  env: Env,
  executionCtx: ExecutionContext,
  pathname: string,
  rows: readonly PluginStateRow[],
  site: SiteSettings,
): Promise<Response> {
  const notFound = (): Response =>
    enforcePluginRouteNoStore(problem(404, 'Not found.'));
  if (!pathname.startsWith(PLUGIN_ROUTE_PREFIX)) {
    return notFound();
  }
  const [pluginId = '', ...rest] = pathname
    .slice(PLUGIN_ROUTE_PREFIX.length)
    .split('/');
  // An empty segment is a doubled or trailing slash: not a route.
  if (!PLUGIN_ID.test(pluginId) || rest.length === 0 || rest.includes('')) {
    return notFound();
  }
  const active = activePlugins(rows).find(
    (candidate) => candidate.state.plugin_id === pluginId,
  );
  if (active === undefined) {
    return notFound();
  }
  const manifest = active.plugin.manifest;

  let locale = site.defaultLocale;
  let segments: string[];
  if (manifest.pluginApi < 2) {
    if (rest.length !== 1) {
      return notFound();
    }
    segments = rest;
  } else {
    segments = [];
    for (const raw of rest) {
      const decoded = decodeSegment(raw);
      if (decoded === null) {
        return notFound();
      }
      segments.push(decoded);
    }
    // The locale reading wins: no version 2 route may start with a segment
    // shaped like a locale code, so nothing is hidden by it
    // (`src/core/plugin.ts`).
    const first = segments[0] ?? '';
    if (site.locales.includes(first)) {
      locale = first;
      segments = segments.slice(1);
    }
  }
  const matched = matchPluginRoute(manifest.routes, segments);
  const declaration = matched?.route;
  const handler =
    declaration === undefined
      ? undefined
      : active.plugin.routes?.[declaration.path];
  if (matched === null || declaration === undefined || handler === undefined) {
    return notFound();
  }
  if (request.method !== declaration.method) {
    return enforcePluginRouteNoStore(problem(405, 'Method not allowed.'));
  }
  // Before anything is counted, read or run: a submission another site made
  // a visitor's browser send is refused for every plugin, whichever API
  // version it declares (docs/PLUGIN_API.md §13.3).
  // A raw-body route is called by another server, which proves who it is
  // with a signature over the body; a browser's cross-site rules say nothing
  // about it, and its handler is where the request is authenticated.
  const raw = declaration.body === 'raw';
  const crossSite = raw ? null : crossSiteProblem(request);
  if (crossSite !== null) {
    return enforcePluginRouteNoStore(problem(403, crossSite));
  }

  // Rate limiting is best-effort by design (docs/SECURITY.md §12.5): with no
  // binding configured the request proceeds.
  const limiter = rateLimiterFor(env, pluginId, declaration);
  if (limiter !== undefined) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    // The declared path, not the requested one: `orders/:orderNo` is one
    // budget however many order numbers are tried, and each route has its
    // own, so a busy cart cannot use up the checkout's.
    const { success } = await limiter.limit({
      key: `${pluginId}:${declaration.path}:${ip}`,
    });
    if (!success) {
      return enforcePluginRouteNoStore(
        problem(429, 'Too many requests. Try again in a minute.'),
      );
    }
  }

  if (raw) {
    const bytes = await readCapped(
      request,
      declaration.maxBytes ?? RAW_BODY_BYTES_DEFAULT,
    );
    if (bytes === null) {
      return enforcePluginRouteNoStore(
        problem(413, 'The request body is too large.'),
      );
    }
    // The same request with the same bytes, readable once by the handler as
    // text or as a buffer. Nothing was decoded, trimmed or re-serialised.
    const untouched = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bytes,
    });
    const rawCtx = await buildRequestContext(
      env,
      executionCtx,
      site,
      active,
      untouched,
      locale,
    );
    const answered = await handler(
      { fields: {}, params: matched.params, json: undefined },
      rawCtx,
    );
    if (!(answered instanceof Response)) {
      console.warn(
        JSON.stringify({
          event: 'plugin_route_bad_result',
          plugin: pluginId,
          route: declaration.path,
          render: declaration.render,
        }),
      );
      return enforcePluginRouteNoStore(
        problem(500, 'This request could not be handled.'),
      );
    }
    // The status is the handler's, untouched: the caller decides whether to
    // deliver again from it.
    return enforcePluginRouteNoStore(answered);
  }

  const body = await parseBody(request);
  if (body === null) {
    return enforcePluginRouteNoStore(
      problem(400, 'The request body could not be read.'),
    );
  }

  const { fields } = body;
  const ctx = await buildRequestContext(
    env,
    executionCtx,
    site,
    active,
    request,
    locale,
  );

  if (declaration.turnstile) {
    const verdict = await verifyTurnstile(ctx, fields['cf-turnstile-response']);
    if (verdict === 'rejected') {
      return enforcePluginRouteNoStore(
        problem(403, 'The anti-spam check did not pass. Reload and try again.'),
      );
    }
    // 'unconfigured' proceeds: an operator who has not set Turnstile up gets
    // the honeypot-only degraded mode, not a broken form.
  }

  const returned = await handler(
    { fields, params: matched.params, json: body.json },
    ctx,
  );
  if (returned instanceof Response) {
    return enforcePluginRouteNoStore(returned);
  }
  // A manifest gives a route a layout exactly when it is a page route.
  if (declaration.layout === undefined || !isPageResult(returned)) {
    // A handler that hands back a view from a route that renders none, or
    // something that is neither. The visitor gets a plain error; the log
    // says which route, for whoever wrote it.
    console.warn(
      JSON.stringify({
        event: 'plugin_route_bad_result',
        plugin: pluginId,
        route: declaration.path,
        render: declaration.render,
      }),
    );
    return enforcePluginRouteNoStore(
      problem(500, 'This page could not be shown.'),
    );
  }
  return enforcePluginRouteNoStore(
    await renderPluginPage({
      request,
      site,
      locale,
      pluginId,
      layout: declaration.layout,
      segments,
      result: returned,
    }),
  );
}

/**
 * The binding that guards a route, or `undefined` when nothing does.
 *
 * `true` and `"strict"` are the same tier. A `relaxed` route on a site whose
 * `wrangler.jsonc` predates the second binding falls back to the strict one
 * and says so: tighter than asked for, never unguarded.
 */
function rateLimiterFor(
  env: Env,
  pluginId: string,
  declaration: { readonly path: string; readonly rateLimit: boolean | string },
): Env['RATE_LIMITER'] {
  if (declaration.rateLimit === false) {
    return undefined;
  }
  if (declaration.rateLimit !== 'relaxed') {
    return env.RATE_LIMITER;
  }
  if (env.RATE_LIMITER_RELAXED !== undefined) {
    return env.RATE_LIMITER_RELAXED;
  }
  if (env.RATE_LIMITER !== undefined) {
    console.warn(
      JSON.stringify({
        event: 'rate_limit_binding_missing',
        binding: 'RATE_LIMITER_RELAXED',
        plugin: pluginId,
        route: declaration.path,
        fallback: 'RATE_LIMITER',
      }),
    );
  }
  return env.RATE_LIMITER;
}

/** Plugin endpoints never participate in browser or shared caching in 0.1. */
export function enforcePluginRouteNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('cloudflare-cdn-cache-control', 'no-store');
  headers.set('cdn-cache-control', 'no-store');
  headers.set('surrogate-control', 'no-store');
  headers.delete('cache-tag');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

/**
 * Reads a request body, giving up as soon as it is longer than `limit`.
 *
 * Reading it all and measuring afterwards would let a caller make the Worker
 * hold whatever it chose to send.
 */
async function readCapped(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    return null;
  }
  if (request.body === null) {
    return new Uint8Array(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * One path segment, percent-decoded. `null` for a segment that is not valid
 * encoding, is longer than a parameter may be, or decodes to something that
 * would change the path's structure.
 */
function decodeSegment(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (
    decoded === '' ||
    decoded.length > ROUTE_PARAM_MAX ||
    decoded.includes('/') ||
    decoded === '.' ||
    decoded === '..'
  ) {
    return null;
  }
  return decoded;
}

/** A request body as a route handler receives it. */
interface ParsedBody {
  /** Form fields, or the string-valued top-level members of a JSON object. */
  readonly fields: Record<string, string>;
  /** The whole JSON object of a JSON request; `undefined` for a form. */
  readonly json: unknown;
}

async function parseBody(request: Request): Promise<ParsedBody | null> {
  if (request.method === 'GET') {
    return { fields: {}, json: undefined };
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
      // Numbers, booleans and nested values are not form fields, but a
      // handler that asked for JSON needs them: the object is passed whole.
      return { fields: out, json: parsed };
    }
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') {
        out[key] = value.slice(0, 10_000);
      }
    }
    return { fields: out, json: undefined };
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
    // Own namespace only, plus `site` (docs/PLUGIN_API.md §9).
    purgeTags: (tags) => purgeTags(env, pluginPurgeTags(pluginId, tags)),
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    enqueue: async (name, payload, options) => {
      const job = describeJob(active, name, payload, options);
      await enqueueJobStatement(
        env.DB,
        job.id,
        job.type,
        job.payload,
        job.runAt,
        job.now,
      ).run();
      return job.id;
    },
    enqueueStatement: (name, payload, options) => {
      const job = describeJob(active, name, payload, options);
      return enqueueJobStatement(
        env.DB,
        job.id,
        job.type,
        job.payload,
        job.runAt,
        job.now,
      );
    },
  };
}

/** Largest job payload, serialised. A job carries ids, not documents. */
const JOB_PAYLOAD_MAX = 16 * 1024;
/** Plugin jobs attempted per cron tick, across all plugins. */
export const PLUGIN_JOBS_PER_TICK = 5;

/** What a job is told happened when its Worker never came back. */
const STOPPED = 'The Worker stopped while this job was running.';

/** The `job.type` of one plugin's job (docs/DATA_MODEL.md §2.9). */
function jobType(pluginId: string, name: string): string {
  return `plugin:${pluginId}:${name}`;
}

/**
 * Checks a job a plugin wants queued and works out its row. Refused here,
 * where the plugin author sees it, rather than failing five times in a cron
 * tick nobody is watching.
 */
function describeJob(
  active: ActivePlugin,
  name: string,
  payload: unknown,
  options: { readonly runAt?: Date } | undefined,
): { id: string; type: string; payload: string; runAt: string; now: string } {
  const pluginId = active.state.plugin_id;
  if (active.plugin.jobs?.[name] === undefined) {
    throw new Error(
      `Plugin "${pluginId}" has no job named "${name}". Add it to \`jobs\`.`,
    );
  }
  const serialised = JSON.stringify(payload ?? null);
  if (serialised === undefined || serialised.length > JOB_PAYLOAD_MAX) {
    throw new Error(
      `The payload of job "${name}" must be JSON of at most ${JOB_PAYLOAD_MAX} bytes. Queue ids and look the rest up when the job runs.`,
    );
  }
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    type: jobType(pluginId, name),
    payload: serialised,
    runAt: (options?.runAt ?? now).toISOString(),
    now: now.toISOString(),
  };
}

/**
 * Runs a bounded number of due plugin jobs. Cron entry point.
 *
 * At least once: a job is claimed, run, and marked done. A handler that
 * throws is retried on the schedule email uses — five attempts, 2, 4, 8 and
 * 16 minutes apart — and then marked failed, where the admin's diagnostics
 * show it. Jobs of a plugin that is switched off wait.
 *
 * A Worker that stops while a job runs leaves it claimed. Such a claim is
 * released after {@link STUCK_CLAIM_MS} and **counts as a failed attempt**:
 * the job may simply have been unlucky, or it may be what stopped the Worker,
 * and a job that does that every time must run out of attempts like any
 * other rather than come back for ever.
 */
export async function processPluginJobs(
  env: Env,
  executionCtx: ExecutionContext,
  rows: readonly PluginStateRow[],
  site: SiteSettings,
): Promise<{ done: number; failed: number }> {
  const withJobs = activePlugins(rows).filter(
    ({ plugin }) => Object.keys(plugin.jobs ?? {}).length > 0,
  );
  if (withJobs.length === 0) {
    return { done: 0, failed: 0 };
  }
  const now = new Date();
  const prefixes = withJobs.map(({ state }) => `plugin:${state.plugin_id}:`);
  const stuck = await stuckJobsByPrefix(
    env.DB,
    prefixes,
    new Date(now.getTime() - STUCK_CLAIM_MS).toISOString(),
    PLUGIN_JOBS_PER_TICK,
  );
  for (const job of stuck) {
    await failJob(env.DB, job, STOPPED, now);
    const [, pluginId = '', name = ''] = job.type.split(':');
    console.warn(
      JSON.stringify({
        event: 'plugin_job_failed',
        plugin: pluginId,
        job: name,
        attempt: job.attempts + 1,
        final: job.attempts + 1 >= job.max_attempts,
        reason: STOPPED,
      }),
    );
  }
  const due = await dueJobsByPrefix(
    env.DB,
    prefixes,
    now.toISOString(),
    PLUGIN_JOBS_PER_TICK,
  );
  let done = 0;
  let failed = 0;
  for (const job of due) {
    // Claimed atomically, so two ticks that overlap cannot both run it.
    const claim = await env.DB.prepare(
      "UPDATE job SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(now.toISOString(), job.id)
      .run();
    if (claim.meta.changes !== 1) {
      continue;
    }
    const [, pluginId = '', name = ''] = job.type.split(':');
    const active = withJobs.find(
      (candidate) => candidate.state.plugin_id === pluginId,
    );
    const handler = active?.plugin.jobs?.[name];
    try {
      if (active === undefined || handler === undefined) {
        throw new Error(`No handler for the job "${name}".`);
      }
      await handler(
        JSON.parse(job.payload) as unknown,
        await buildPluginContext(env, executionCtx, site, active),
      );
      await completeJob(env.DB, job.id, new Date().toISOString());
      done += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await failJob(env.DB, job, message, new Date());
      console.warn(
        JSON.stringify({
          event: 'plugin_job_failed',
          plugin: pluginId,
          job: name,
          attempt: job.attempts + 1,
          final: job.attempts + 1 >= job.max_attempts,
          reason: message.slice(0, 200),
        }),
      );
    }
  }
  return { done, failed };
}

async function buildRequestContext(
  env: Env,
  executionCtx: ExecutionContext,
  site: SiteSettings,
  active: ActivePlugin,
  request: Request,
  locale: string = site.defaultLocale,
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
    locale,
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
