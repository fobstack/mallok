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
import type { MallokPlugin } from './types.js';

/** What `definePlugin` accepts: a plugin whose manifest may be unparsed. */
export interface PluginInput extends Omit<MallokPlugin, 'manifest'> {
  readonly manifest: unknown;
}

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
  const implemented = Object.entries(input.hooks ?? {})
    .filter(([, handler]) => typeof handler === 'function')
    .map(([name]) => name);

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
  const handlers = Object.keys(input.routes ?? {});
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

  return { ...input, manifest };
}
