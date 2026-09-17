/**
 * `definePlugin` — the one way to build a plugin, for official and
 * third-party authors alike.
 *
 * `docs/PLUGIN_API.md §1` says there is no private interface, and the runtime
 * took that literally in the wrong direction: it read
 * `plugin.manifest.hooks.includes(...)` and
 * `Object.entries(plugin.manifest.settings)` straight off whatever object it
 * was handed. Mallok's own plugins are fine, because their manifests are
 * parsed from `plugin.json` by `parsePluginManifest`, which supplies every
 * default. A third-party author writing the object in TypeScript has no such
 * step — both fields are optional in the documented format — so the first
 * visitor request threw `TypeError: Cannot read properties of undefined`
 * from inside Mallok, naming nothing the author could act on.
 *
 * So this is where a plugin is checked and normalised, once, at module scope.
 * It runs the manifest through the same schema `plugin.json` goes through,
 * which fills the defaults the runtime assumed were always present, and then
 * checks the two halves against each other:
 *
 * - a hook the manifest **declares** must have an implementation, or it
 *   silently does nothing on every request;
 * - an implementation the manifest does **not** declare must not exist, or it
 *   never runs and its author has no way to tell.
 *
 * The same for routes. Both are mistakes a type system cannot catch, because
 * the manifest is data, and both are silent at run time — which is why they
 * are worth failing a build over.
 */

import { PLUGIN_HOOKS, parsePluginManifest } from '../core/index.js';
import type { MallokPlugin, PluginInput } from './types.js';

export type { PluginInput } from './types.js';

/** Runtime provenance. Neither marker is a field a third party can forge. */
const definedPlugins = new WeakSet<object>();
const officialPlugins = new WeakSet<object>();

/**
 * A refusal from `definePlugin`, with somewhere to put the detail.
 *
 * Its own class rather than the CLI's `CliError`: this runs inside the
 * Worker bundle, which must not import the command line tool. `hint` carries
 * what to do about it, and `message` stays short enough to read in a build
 * log.
 */
export class PluginDefinitionError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = 'PluginDefinitionError';
    this.hint = hint;
  }
}

/** Refuses, naming the plugin so a build log says which one. */
function refuse(id: string, what: string, hint: string): never {
  throw new PluginDefinitionError(`Plugin "${id}": ${what}`, hint);
}

/**
 * Validates and normalises a plugin.
 *
 * Call it once, at module scope, and export the result:
 *
 * ```ts
 * import { definePlugin } from 'mallok/worker';
 * import manifest from './plugin.json';
 *
 * export default definePlugin({ manifest, hooks: { … }, routes: { … } });
 * ```
 */
export function definePlugin(input: PluginInput): MallokPlugin {
  if (
    input !== null &&
    typeof input === 'object' &&
    definedPlugins.has(input)
  ) {
    return input as MallokPlugin;
  }
  if (input?.manifest === undefined || input.manifest === null) {
    throw new PluginDefinitionError(
      'A plugin needs a manifest.',
      'Pass the parsed contents of its plugin.json as `manifest` ' +
        '(docs/PLUGIN_API.md §4).',
    );
  }

  // Hook names are checked before the schema, because zod's enum error names
  // the allowed options and not the offending value — so an author who typed
  // `onRequests` would read "its manifest is not valid" and have to guess
  // which of the fields it meant.
  const declaredHooks = (input.manifest as { hooks?: unknown }).hooks;
  if (Array.isArray(declaredHooks)) {
    for (const name of declaredHooks) {
      if (!(PLUGIN_HOOKS as readonly unknown[]).includes(name)) {
        const id = (input.manifest as { id?: unknown }).id;
        refuse(
          typeof id === 'string' ? id : 'unknown',
          `"${String(name)}" is not a hook this version knows.`,
          `The hooks are: ${PLUGIN_HOOKS.join(', ')} (docs/PLUGIN_API.md §5).`,
        );
      }
    }
  }

  // The same schema `plugin.json` goes through, so a hand-written object and
  // a parsed file end up identical — including every default the runtime
  // reads without checking.
  let manifest: MallokPlugin['manifest'];
  try {
    manifest = parsePluginManifest(input.manifest);
  } catch (error) {
    const id =
      typeof (input.manifest as { id?: unknown }).id === 'string'
        ? ((input.manifest as { id: string }).id ?? 'unknown')
        : 'unknown';
    throw new PluginDefinitionError(
      `Plugin "${id}": its manifest is not valid (docs/PLUGIN_API.md §4).`,
      error instanceof Error ? error.message : String(error),
    );
  }

  const { id } = manifest;

  // ---- hooks: declared and implemented have to be the same set ------------
  const hookEntries = Object.entries(input.hooks ?? {});
  for (const [name, handler] of hookEntries) {
    if (typeof handler !== 'function') {
      refuse(
        id,
        `the hook "${name}" is not a function.`,
        'Every hook implementation must be a function.',
      );
    }
  }
  const implemented = hookEntries.map(([name]) => name);

  for (const name of manifest.hooks) {
    if (!implemented.includes(name)) {
      refuse(
        id,
        `its manifest declares the hook "${name}", but the plugin has no implementation for it.`,
        'The runtime calls only what the manifest lists, so this hook would ' +
          'do nothing on every request. Implement it, or remove it from ' +
          '`hooks` in plugin.json.',
      );
    }
  }
  for (const name of implemented) {
    if (!(PLUGIN_HOOKS as readonly string[]).includes(name)) {
      refuse(
        id,
        `"${name}" is not a hook this version knows.`,
        `The hooks are: ${PLUGIN_HOOKS.join(', ')} (docs/PLUGIN_API.md §5).`,
      );
    }
    if (!manifest.hooks.includes(name as (typeof PLUGIN_HOOKS)[number])) {
      refuse(
        id,
        `it implements the hook "${name}", which its manifest does not declare.`,
        'The runtime calls only what the manifest lists, so this would never ' +
          `run. Add "${name}" to \`hooks\` in plugin.json.`,
      );
    }
  }

  // ---- routes: the same, keyed by path ------------------------------------
  const routeEntries = Object.entries(input.routes ?? {});
  for (const [path, handler] of routeEntries) {
    if (typeof handler !== 'function') {
      refuse(
        id,
        `the route handler "${path}" is not a function.`,
        'Every declared route needs a function that returns a Response.',
      );
    }
  }
  const handlers = routeEntries.map(([path]) => path);
  for (const route of manifest.routes) {
    if (!handlers.includes(route.path)) {
      refuse(
        id,
        `its manifest declares the route "${route.path}", but there is no handler for it.`,
        'A declared route with no handler answers 500. Add it to `routes`, ' +
          'or remove it from plugin.json.',
      );
    }
  }
  for (const path of handlers) {
    if (!manifest.routes.some((route) => route.path === path)) {
      refuse(
        id,
        `it has a handler for the route "${path}", which its manifest does not declare.`,
        'Only declared routes are mounted, so this one is unreachable. Add ' +
          'it to `routes` in plugin.json.',
      );
    }
  }

  const declaredActions = new Set(
    manifest.panels.flatMap((panel) =>
      panel.actions.map((action) => action.id),
    ),
  );
  validateFunctionMap(id, 'panel action', input.actions, declaredActions, true);
  validateFunctionMap(
    id,
    'secret check',
    input.checkSecrets,
    new Set(Object.keys(manifest.secrets)),
    false,
  );

  validateMigrations(id, input.migrations);

  if (
    input.exportFiles !== undefined &&
    typeof input.exportFiles !== 'function'
  ) {
    refuse(
      id,
      'exportFiles is not a function.',
      'Remove it or provide a function that returns the exported files.',
    );
  }

  const plugin: MallokPlugin = { ...input, manifest };
  definedPlugins.add(plugin);
  return plugin;
}

function validateMigrations(
  pluginId: string,
  value: readonly unknown[] | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    refuse(
      pluginId,
      'migrations is not an array.',
      'Provide an array of { id, sql } objects.',
    );
  }
  const ids = new Set<string>();
  for (const migration of value) {
    if (
      migration === null ||
      typeof migration !== 'object' ||
      typeof (migration as { id?: unknown }).id !== 'string' ||
      typeof (migration as { sql?: unknown }).sql !== 'string'
    ) {
      refuse(
        pluginId,
        'a migration is not a { id: string, sql: string } object.',
        'Every migration needs a stable id and its SQL text.',
      );
    }
    const migrationId = (migration as { id: string }).id;
    if (!migrationId.startsWith(`plugin:${pluginId}:`)) {
      refuse(
        pluginId,
        `migration "${migrationId}" does not use this plugin's prefix.`,
        `Migration ids must start with "plugin:${pluginId}:".`,
      );
    }
    if (ids.has(migrationId)) {
      refuse(
        pluginId,
        `migration "${migrationId}" is included more than once.`,
        'Every migration id must be unique inside the plugin.',
      );
    }
    ids.add(migrationId);
  }
}

/** Defines a plugin Mallok itself ships. Deliberately not re-exported publicly. */
export function defineOfficialPlugin(input: PluginInput): MallokPlugin {
  const plugin = definePlugin(input);
  officialPlugins.add(plugin);
  return plugin;
}

/** Origin is runtime provenance, never untrusted manifest data. */
export function isOfficialPlugin(plugin: MallokPlugin): boolean {
  return officialPlugins.has(plugin);
}

/** Validates a whole composition and refuses ambiguous registry ids. */
export function normalizePlugins(
  inputs: readonly PluginInput[],
): readonly MallokPlugin[] {
  const plugins = inputs.map((input) => definePlugin(input));
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.manifest.id)) {
      throw new PluginDefinitionError(
        `Plugin "${plugin.manifest.id}" is included more than once.`,
        'Every plugin id in createMallok({ plugins }) must be unique.',
      );
    }
    ids.add(plugin.manifest.id);
  }
  return plugins;
}

function validateFunctionMap(
  pluginId: string,
  label: string,
  values: Readonly<Record<string, unknown>> | undefined,
  declared: ReadonlySet<string>,
  requireEveryDeclaration: boolean,
): void {
  const implemented = new Set<string>();
  for (const [name, handler] of Object.entries(values ?? {})) {
    if (typeof handler !== 'function') {
      refuse(
        pluginId,
        `the ${label} "${name}" is not a function.`,
        `Every ${label} implementation must be a function.`,
      );
    }
    if (!declared.has(name)) {
      refuse(
        pluginId,
        `it implements the ${label} "${name}", which its manifest does not declare.`,
        `Declare "${name}" in plugin.json or remove the implementation.`,
      );
    }
    implemented.add(name);
  }
  if (!requireEveryDeclaration) {
    return;
  }
  for (const name of declared) {
    if (!implemented.has(name)) {
      refuse(
        pluginId,
        `its manifest declares the ${label} "${name}", but the plugin has no implementation for it.`,
        `Implement "${name}" or remove it from plugin.json.`,
      );
    }
  }
}
