/**
 * `/_mallok/api/plugins*` — the runtime side of plugins (docs/ADMIN.md §10).
 *
 * Only the enable switch, settings, secrets and panels live here; they all
 * take effect instantly. Installing, updating or removing a plugin is a
 * source change plus redeploy, and this API deliberately has no endpoint
 * that pretends otherwise.
 */

import { settingsValidator } from '../core/index.js';
import {
  findPluginState,
  listPluginState,
  loadSite,
  setPluginEnabled,
  setPluginSecrets,
  setPluginSettings,
} from '../db/queries.js';
import type { MallokPlugin } from '../plugins/types.js';
import { hasScope, type Principal, type Scope } from './auth.js';
import { purgeTags } from './cache.js';
import type { Env } from './env.js';
import { json, problem } from './http.js';
import {
  type ActivePlugin,
  buildPluginContext,
  registeredPlugins,
} from './plugin-runtime.js';
import { encryptSecret } from './secrets.js';
import { parseSiteSettings } from './site.js';

const PANEL_PAGE = 20;
const PANEL_PAGE_MAX = 100;
const ACTION_IDS_MAX = 100;

/**
 * Routes a `plugins*` admin path. Returns `null` when `route` is not a
 * plugins route, so the main router can fall through to its 404.
 */
export async function routePlugins(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  principal: Principal,
  route: string,
  method: string,
): Promise<Response | null> {
  if (route === 'plugins') {
    return method === 'GET'
      ? listPlugins(env)
      : problem(405, 'Method not allowed.');
  }
  if (!route.startsWith('plugins/')) {
    return null;
  }
  const parts = route.slice('plugins/'.length).split('/');
  const plugin = registeredPlugins().find(
    (candidate) => candidate.manifest.id === parts[0],
  );
  if (plugin === undefined) {
    return problem(404, 'No such plugin is compiled into this build.');
  }

  if (parts.length === 2 && parts[1] === 'enabled' && method === 'POST') {
    return withScope(principal, 'settings:write', () =>
      postEnabled(request, env, ctx, plugin),
    );
  }
  if (parts.length === 2 && parts[1] === 'settings' && method === 'PATCH') {
    return withScope(principal, 'settings:write', () =>
      patchPluginSettings(request, env, ctx, plugin),
    );
  }
  if (parts.length === 2 && parts[1] === 'secrets' && method === 'PUT') {
    return withScope(principal, 'settings:write', () =>
      putPluginSecrets(request, env, plugin),
    );
  }
  if (parts.length === 3 && parts[1] === 'secrets' && method === 'POST') {
    return withScope(principal, 'settings:write', () =>
      checkPluginSecret(env, ctx, plugin, parts[2] ?? ''),
    );
  }
  if (parts.length === 3 && parts[1] === 'panels' && method === 'GET') {
    return getPanel(request, env, plugin, parts[2] ?? '');
  }
  if (
    parts.length === 5 &&
    parts[1] === 'panels' &&
    parts[3] === 'actions' &&
    method === 'POST'
  ) {
    return runPanelAction(
      request,
      env,
      ctx,
      principal,
      plugin,
      parts[2] ?? '',
      parts[4] ?? '',
    );
  }
  return problem(404, 'Not found.');
}

async function withScope(
  principal: Principal,
  scope: Scope,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (!hasScope(principal, scope)) {
    return problem(403, `This operation needs the "${scope}" scope.`);
  }
  return handler();
}

async function listPlugins(env: Env): Promise<Response> {
  const states = new Map(
    (await listPluginState(env.DB)).map((row) => [row.plugin_id, row]),
  );
  const plugins = registeredPlugins().map((plugin) => {
    const manifest = plugin.manifest;
    const state = states.get(manifest.id);
    const stored = parseJson(state?.secrets ?? '{}');
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? '',
      official: manifest.official,
      enabled: state?.enabled === 1,
      hooks: manifest.hooks,
      routes: manifest.routes.map((route) => route.path),
      affectsFragmentCache: manifest.affectsFragmentCache,
      clientScripts: manifest.clientScripts,
      // The admin must warn that an onRequest plugin runs on every visitor
      // request, cache hits included (docs/PLUGIN_API.md §5.1).
      runsOnEveryRequest: manifest.hooks.includes('onRequest'),
      settings: manifest.settings,
      values: parseJson(state?.settings ?? '{}'),
      secrets: Object.entries(manifest.secrets).map(([name, decl]) => ({
        name,
        label: decl.label,
        required: decl.required,
        configured: typeof stored[name] === 'string' && stored[name] !== '',
        checkable: plugin.checkSecrets?.[name] !== undefined,
      })),
      panels: manifest.panels,
    };
  });
  return json({ plugins });
}

async function postEnabled(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  plugin: MallokPlugin,
): Promise<Response> {
  const body = await readJson(request);
  if (body === null || typeof body.enabled !== 'boolean') {
    return problem(400, 'Body must be {"enabled": true | false}.');
  }
  const now = new Date().toISOString();
  const changed = await setPluginEnabled(
    env.DB,
    plugin.manifest.id,
    body.enabled,
    now,
  );
  if (!changed) {
    return problem(404, 'Plugin state row is missing.');
  }
  // Cached pages may embed (or now lack) this plugin's stage-two output.
  ctx.waitUntil(purgeTags(env, ['site']));
  return json({ id: plugin.manifest.id, enabled: body.enabled });
}

async function patchPluginSettings(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  plugin: MallokPlugin,
): Promise<Response> {
  const body = await readJson(request);
  if (body === null) {
    return problem(400, 'Body must be a JSON object of settings.');
  }
  const parsed = settingsValidator(plugin.manifest).safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join('.') ?? '';
    return problem(
      400,
      `Invalid settings${where === '' ? '' : ` at "${where}"`}: ${first?.message ?? 'validation failed'}.`,
    );
  }
  const now = new Date().toISOString();
  await setPluginSettings(
    env.DB,
    plugin.manifest.id,
    JSON.stringify(parsed.data),
    now,
  );
  ctx.waitUntil(purgeTags(env, ['site']));
  return json({ id: plugin.manifest.id, settings: parsed.data });
}

async function putPluginSecrets(
  request: Request,
  env: Env,
  plugin: MallokPlugin,
): Promise<Response> {
  const body = await readJson(request);
  if (body === null) {
    return problem(400, 'Body must be a JSON object of secret values.');
  }
  const state = await findPluginState(env.DB, plugin.manifest.id);
  if (state === null) {
    return problem(404, 'Plugin state row is missing.');
  }
  const stored = parseJson(state.secrets);
  for (const [name, value] of Object.entries(body)) {
    if (!(name in plugin.manifest.secrets)) {
      return problem(400, `Unknown secret "${name}".`);
    }
    if (value === null || value === '') {
      delete stored[name];
      continue;
    }
    if (typeof value !== 'string') {
      return problem(400, `Secret "${name}" must be a string or null.`);
    }
    stored[name] = await encryptSecret(
      env.MALLOK_SECRET,
      plugin.manifest.id,
      name,
      value,
    );
  }
  await setPluginSecrets(
    env.DB,
    plugin.manifest.id,
    JSON.stringify(stored),
    new Date().toISOString(),
  );
  // Secret values are write-only; only which names are set is reported.
  return json({
    id: plugin.manifest.id,
    configured: Object.keys(plugin.manifest.secrets).filter(
      (name) => typeof stored[name] === 'string',
    ),
  });
}

/**
 * Runs a plugin's own check for one secret.
 *
 * The core cannot tell a good Resend key from a bad one; the plugin can, and
 * declares how (docs/PLUGIN_API.md §7.3). The stored value never leaves the
 * Worker — only the plugin's verdict comes back.
 */
async function checkPluginSecret(
  env: Env,
  ctx: ExecutionContext,
  plugin: MallokPlugin,
  name: string,
): Promise<Response> {
  const check = plugin.checkSecrets?.[name];
  if (check === undefined) {
    return problem(404, `"${name}" cannot be checked automatically.`);
  }
  const siteRow = await loadSite(env.DB);
  if (siteRow === null) {
    return problem(503, 'Site is not initialized.');
  }
  const state = await findPluginState(env.DB, plugin.manifest.id);
  if (state === null) {
    return problem(404, 'Plugin state row is missing.');
  }
  const active: ActivePlugin = {
    plugin,
    settings: parseJson(state.settings),
    state,
  };
  const pluginCtx = await buildPluginContext(
    env,
    ctx,
    parseSiteSettings(siteRow),
    active,
  );
  const verdict = await check(pluginCtx);
  return json(verdict);
}

async function getPanel(
  request: Request,
  env: Env,
  plugin: MallokPlugin,
  panelId: string,
): Promise<Response> {
  const panel = plugin.manifest.panels.find((entry) => entry.id === panelId);
  if (panel === undefined) {
    return problem(404, 'No such panel.');
  }
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(
      Number(url.searchParams.get('limit') ?? PANEL_PAGE) || PANEL_PAGE,
      1,
    ),
    PANEL_PAGE_MAX,
  );
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const conditions: string[] = [];
  const bindings: string[] = [];
  for (const field of panel.filters) {
    const value = url.searchParams.get(field);
    if (value !== null) {
      // Field names come from the compiled-in manifest, never the request.
      conditions.push(`${field} = ?`);
      bindings.push(value);
    }
  }
  const where =
    conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  const rows = await env.DB.prepare(
    `SELECT * FROM ${panel.table}${where}
       ORDER BY ${panel.orderBy} DESC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, limit + 1, offset)
    .all<Record<string, unknown>>();

  const visible = new Set<string>([
    'id',
    panel.orderBy,
    ...panel.columns.map((column) => column.field),
    ...panel.detail,
    ...panel.filters,
  ]);
  const projected = rows.results.slice(0, limit).map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of visible) {
      if (field in row) {
        out[field] = row[field];
      }
    }
    return out;
  });
  return json({ rows: projected, hasNext: rows.results.length > limit });
}

async function runPanelAction(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  principal: Principal,
  plugin: MallokPlugin,
  panelId: string,
  actionId: string,
): Promise<Response> {
  const panel = plugin.manifest.panels.find((entry) => entry.id === panelId);
  const action = panel?.actions.find((entry) => entry.id === actionId);
  const handler = plugin.actions?.[actionId];
  if (panel === undefined || action === undefined || handler === undefined) {
    return problem(404, 'No such panel action.');
  }
  const scope: Scope = action.type === 'download' ? 'export' : 'content:write';
  if (!hasScope(principal, scope)) {
    return problem(403, `This operation needs the "${scope}" scope.`);
  }

  const body = await readJson(request);
  const ids = Array.isArray(body?.ids)
    ? body.ids
        .filter((id): id is string => typeof id === 'string')
        .slice(0, ACTION_IDS_MAX)
    : [];
  if (action.type === 'update' && ids.length === 0) {
    return problem(400, 'Body must carry the row ids to act on.');
  }

  const siteRow = await loadSite(env.DB);
  if (siteRow === null) {
    return problem(503, 'Site is not initialized.');
  }
  const site = parseSiteSettings(siteRow);
  const state = await findPluginState(env.DB, plugin.manifest.id);
  if (state === null) {
    return problem(404, 'Plugin state row is missing.');
  }
  const active: ActivePlugin = {
    plugin,
    settings: parseJson(state.settings),
    state,
  };
  const pluginCtx = await buildPluginContext(env, ctx, site, active);
  const response = await handler(ids, pluginCtx);
  return response ?? json({ ok: true, ids });
}

async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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
