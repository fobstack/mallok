/**
 * `/_mallok/api/plugins*` — the runtime side of plugins (docs/ADMIN.md §10).
 *
 * Only the enable switch, settings, secrets and panels live here; they all
 * take effect instantly. Installing, updating or removing a plugin is a
 * source change plus redeploy, and this API deliberately has no endpoint
 * that pretends otherwise.
 */

import { settingsValidator, validateRecord } from '../core/index.js';
import {
  findPluginState,
  listPluginState,
  listTranslationsOf,
  loadSite,
  setPluginEnabled,
  setPluginSecrets,
  setPluginSettings,
} from '../db/queries.js';
import { isOfficialPlugin } from '../plugins/define.js';
import type { MallokPlugin, PluginContext } from '../plugins/types.js';
import { hasScope, type Principal, type Scope } from './auth.js';
import { purgeTags } from './cache.js';
import { activeTheme } from './composition.js';
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
/** Most rows of a related table shown with one parent row. */
const RELATED_MAX = 100;
/** Longest search term a panel list accepts. */
const SEARCH_MAX = 100;
/** Longest record id accepted in a path. */
const RECORD_ID_MAX = 200;

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
    // Panel rows are plugin business data — the inquiry panel holds buyers'
    // names, addresses and messages. The site export and a panel's download
    // action already require `export` for the same rows, so reading them here
    // does too; reads elsewhere in the API stay unscoped.
    return withScope(principal, 'export', () =>
      getPanel(request, env, plugin, parts[2] ?? ''),
    );
  }
  if (
    (parts.length === 4 || parts.length === 5) &&
    parts[1] === 'panels' &&
    parts[3] === 'records'
  ) {
    return routeRecords(
      request,
      env,
      ctx,
      principal,
      plugin,
      parts[2] ?? '',
      parts[4] ?? null,
      method,
    );
  }
  if (
    parts.length === 5 &&
    parts[1] === 'panels' &&
    parts[3] === 'related' &&
    method === 'GET'
  ) {
    // The same business data as the panel's own rows, under the same scope.
    return withScope(principal, 'export', () =>
      getRelated(request, env, plugin, parts[2] ?? '', parts[4] ?? ''),
    );
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
  const themeLayouts = activeTheme().manifest.pluginLayouts;
  const plugins = registeredPlugins().map((plugin) => {
    const manifest = plugin.manifest;
    const state = states.get(manifest.id);
    const stored = parseJson(state?.secrets ?? '{}');
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? '',
      official: isOfficialPlugin(plugin),
      enabled: state?.enabled === 1,
      hooks: manifest.hooks,
      routes: manifest.routes.map((route) => route.path),
      // Which of this plugin's pages the active theme has a layout for. A
      // page without one is shown in Mallok's plain built-in layout, and the
      // admin has to say so rather than let it be found on the live site
      // (docs/THEME_FORMAT.md §16).
      pageLayouts: [
        ...new Set(
          manifest.routes
            .map((route) => route.layout)
            .filter((layout): layout is string => layout !== undefined),
        ),
      ].map((layout) => ({
        layout,
        provided: Object.hasOwn(themeLayouts, layout),
      })),
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
      // `canRemove` is the one thing about a records panel the manifest
      // cannot say: whether the plugin gave it a `remove` handler.
      panels: manifest.panels.map((panel) => ({
        ...panel,
        canRemove: plugin.records?.[panel.id]?.remove !== undefined,
      })),
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
  // A panel attached to content lists the records of one item: the one
  // whose translation group the editor names. The column is the manifest's.
  const attached = url.searchParams.get('attached');
  if (panel.attachTo !== undefined && attached !== null) {
    conditions.push(`${panel.attachTo.column} = ?`);
    bindings.push(attached);
  }
  // Text search: a substring match over the columns the panel declares, with
  // the wildcards in what was typed taken literally.
  const term = (url.searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX);
  if (term !== '' && panel.search.length > 0) {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      `(${panel.search.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
    );
    for (const _field of panel.search) {
      bindings.push(pattern);
    }
  }
  // Sorting: only by a column the manifest marks sortable. Anything else
  // asked for falls back to the panel's own order rather than reaching SQL.
  const requested = url.searchParams.get('sort');
  const sortable = panel.columns.find(
    (column) => column.sortable && column.field === requested,
  );
  const order =
    sortable === undefined
      ? `${panel.orderBy} DESC`
      : `${sortable.field} ${url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC'}, id`;
  const where =
    conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  const rows = await env.DB.prepare(
    `SELECT * FROM ${panel.table}${where}
       ORDER BY ${order} LIMIT ? OFFSET ?`,
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

/**
 * `…/panels/<panel>/records[/<id>]`: the create and edit form of a records
 * panel (docs/PLUGIN_API.md §7.5).
 *
 * Reading a record needs `export`, like the list it came from; writing one
 * needs `content:write`, like a panel's update actions. **Nothing here runs
 * SQL of its own**: the record is loaded, saved and removed by handlers the
 * plugin wrote, and what this does is check the shape of what was submitted
 * against the fields the plugin declared.
 */
async function routeRecords(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  principal: Principal,
  plugin: MallokPlugin,
  panelId: string,
  recordId: string | null,
  method: string,
): Promise<Response> {
  const panel = plugin.manifest.panels.find(
    (entry) => entry.id === panelId && entry.type === 'records',
  );
  const handlers = plugin.records?.[panelId];
  if (
    panel === undefined ||
    panel.fields === undefined ||
    handlers === undefined
  ) {
    return problem(404, 'No such records panel.');
  }
  if (recordId !== null && recordId.length > RECORD_ID_MAX) {
    return problem(404, 'No such record.');
  }
  const reading = method === 'GET' && recordId !== null;
  const creating = method === 'POST' && recordId === null;
  const updating = method === 'PUT' && recordId !== null;
  const removing = method === 'DELETE' && recordId !== null;
  if (!reading && !creating && !updating && !removing) {
    return problem(405, 'Method not allowed.');
  }
  const scope: Scope = reading ? 'export' : 'content:write';
  if (!hasScope(principal, scope)) {
    return problem(403, `This operation needs the "${scope}" scope.`);
  }
  if (removing && handlers.remove === undefined) {
    return problem(405, 'Records of this panel cannot be deleted here.');
  }

  const siteRow = await loadSite(env.DB);
  if (siteRow === null) {
    return problem(503, 'Site is not initialized.');
  }
  const state = await findPluginState(env.DB, plugin.manifest.id);
  if (state === null) {
    return problem(404, 'Plugin state row is missing.');
  }
  const pluginCtx = await buildPluginContext(
    env,
    ctx,
    parseSiteSettings(siteRow),
    { plugin, settings: parseJson(state.settings), state },
  );

  if (reading) {
    const record = await handlers.load(recordId ?? '', pluginCtx);
    return record === null
      ? problem(404, 'No such record.')
      : json({ id: recordId, values: record });
  }
  if (removing) {
    await handlers.remove?.(recordId ?? '', pluginCtx);
    return json({ ok: true, id: recordId });
  }

  const body = await readJson(request);
  const outcome = await savePluginRecord(env, plugin, panelId, pluginCtx, {
    id: recordId,
    values: body?.values,
    attachedTo: body?.attachedTo,
  });
  if ('problem' in outcome) {
    return outcome.errors === undefined
      ? problem(outcome.status, outcome.problem)
      : json(
          { error: outcome.problem, errors: outcome.errors },
          { status: outcome.status },
        );
  }
  return json({ id: outcome.id }, { status: creating ? 201 : 200 });
}

/** What saving a record came to: its id, or why it was not saved. */
export type RecordSaveOutcome =
  | { readonly id: string }
  | {
      readonly status: number;
      readonly problem: string;
      /** Messages by field, when the values were the problem. */
      readonly errors?: Readonly<Record<string, string>>;
    };

/**
 * Saves one record of a records panel through the plugin's own handler.
 *
 * The one path a record takes to a plugin, whoever submitted it: the admin's
 * form, a token, or a starter's sample data (`setup.ts`). The values are
 * checked against the fields the panel declares, an attached record's owner
 * is checked to exist, and only then is the plugin's `save` called.
 */
export async function savePluginRecord(
  env: Env,
  plugin: MallokPlugin,
  panelId: string,
  pluginCtx: PluginContext,
  input: {
    readonly id: string | null;
    readonly values: unknown;
    /** The owner's translation group, for a panel attached to content. */
    readonly attachedTo: unknown;
  },
): Promise<RecordSaveOutcome> {
  const panel = plugin.manifest.panels.find(
    (entry) => entry.id === panelId && entry.type === 'records',
  );
  const handlers = plugin.records?.[panelId];
  if (
    panel === undefined ||
    panel.fields === undefined ||
    handlers === undefined
  ) {
    return { status: 404, problem: 'No such records panel.' };
  }
  const submitted = input.values;
  if (
    submitted === null ||
    submitted === undefined ||
    typeof submitted !== 'object' ||
    Array.isArray(submitted)
  ) {
    return { status: 400, problem: 'Body must be {"values": { … }}.' };
  }
  // An attached panel's record belongs to a content item, and the plugin is
  // told which — after the core has made sure it is a real one of the kind
  // the panel is for. A handler can then key its rows by the group without
  // checking that a caller did not make it up.
  let attachedTo: { translationGroup: string; kind: string } | null = null;
  if (panel.attachTo !== undefined) {
    const group = input.attachedTo;
    if (typeof group !== 'string' || group === '') {
      return {
        status: 400,
        problem:
          'This panel belongs to a content item: send its translation group as "attachedTo".',
      };
    }
    const owner = (await listTranslationsOf(env.DB, group)).find(
      (item) => item.kind === panel.attachTo?.kind,
    );
    if (owner === undefined) {
      return {
        status: 404,
        problem: `No ${panel.attachTo.kind} with that translation group exists.`,
      };
    }
    attachedTo = { translationGroup: group, kind: panel.attachTo.kind };
  }
  const checked = validateRecord(
    panel.fields,
    submitted as Record<string, unknown>,
  );
  if (Object.keys(checked.errors).length > 0) {
    return {
      status: 422,
      problem: 'Some fields need attention.',
      errors: checked.errors,
    };
  }
  const saved = await handlers.save(
    { id: input.id, values: checked.values, attachedTo },
    pluginCtx,
  );
  if ('errors' in saved) {
    return {
      status: 422,
      problem: 'Some fields need attention.',
      errors: saved.errors,
    };
  }
  return { id: saved.id };
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
  // What the action asks for, checked against its declaration before the
  // plugin sees it, exactly as a record's values are.
  let params: Record<string, unknown> = {};
  if (action.params !== undefined) {
    const submitted = body?.params;
    const checked = validateRecord(
      action.params,
      submitted !== null &&
        typeof submitted === 'object' &&
        !Array.isArray(submitted)
        ? (submitted as Record<string, unknown>)
        : {},
    );
    if (Object.keys(checked.errors).length > 0) {
      return json(
        { error: 'Some fields need attention.', errors: checked.errors },
        { status: 422 },
      );
    }
    params = checked.values;
  }

  const pluginCtx = await buildPluginContext(env, ctx, site, active);
  const response = await handler(ids, pluginCtx, params);
  return response ?? json({ ok: true, ids });
}

/**
 * `…/panels/<panel>/related/<id>?parent=<row id>`: the rows of a declared
 * child table that belong to one row of the panel. Read-only, and read by
 * the core the way a panel's own list is: table and column names come from
 * the manifest, never from the request.
 */
async function getRelated(
  request: Request,
  env: Env,
  plugin: MallokPlugin,
  panelId: string,
  relatedId: string,
): Promise<Response> {
  const panel = plugin.manifest.panels.find((entry) => entry.id === panelId);
  const related = panel?.related.find((entry) => entry.id === relatedId);
  if (panel === undefined || related === undefined) {
    return problem(404, 'No such related table.');
  }
  const parent = new URL(request.url).searchParams.get('parent');
  if (parent === null || parent === '') {
    return problem(400, 'Name the row with ?parent=<id>.');
  }
  const rows = await env.DB.prepare(
    `SELECT * FROM ${related.table} WHERE ${related.foreignKey} = ?
       ORDER BY ${related.orderBy ?? 'rowid'} LIMIT ?`,
  )
    .bind(parent, RELATED_MAX + 1)
    .all<Record<string, unknown>>();
  const fields = related.columns.map((column) => column.field);
  return json({
    rows: rows.results.slice(0, RELATED_MAX).map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in row) {
          out[field] = row[field];
        }
      }
      return out;
    }),
    hasMore: rows.results.length > RELATED_MAX,
  });
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
