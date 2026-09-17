/**
 * `mallok/worker` — the framework's public entry.
 *
 * A Mallok site's own Worker is four lines: import this, name a theme, list
 * the plugins, export the result. Everything else — routing, rendering, the
 * management API, the admin, media, SEO, migrations, the cache — lives in the
 * `mallok` package and is upgraded by changing one exact version in
 * `package.json` (`mallok upgrade`).
 *
 * ```ts
 * import { atelier, createMallok, inquiry } from 'mallok/worker';
 *
 * export default createMallok({ theme: atelier, plugins: [inquiry] });
 * ```
 */

import { parseThemeManifest, type ThemeFiles } from '../core/index.js';
import { normalizePlugins } from '../plugins/define.js';
import { inquiryPlugin } from '../plugins/inquiry/index.js';
import type { MallokPlugin, PluginInput } from '../plugins/types.js';
import type { BundledTheme } from '../themes/index.js';
import { THEMES } from '../themes/index.js';
import { configure } from './composition.js';
import type { Env } from './env.js';
import { mallokHandler } from './handler.js';

export type { PluginInput } from '../plugins/define.js';
export { definePlugin, PluginDefinitionError } from '../plugins/define.js';
/**
 * The plugin author's surface (docs/PLUGIN_API.md §5–§7).
 *
 * All of it, not just the marker type. `MallokPlugin` alone described what a
 * site *names*; writing one needs the context objects the hooks receive, the
 * draft `onContentSave` sees and the parsed body a route handler gets — and
 * without them a third-party author has to reach into the package's internals
 * or re-declare them by hand.
 */
export type {
  ContentDraft,
  EmailMessage,
  MallokPlugin,
  PluginContext,
  PluginExportFile,
  PluginHookName,
  PluginHooks,
  PluginImplementation,
  PluginManifest,
  PluginMarkdownRoot,
  PluginMigration,
  PluginPanelDeclaration,
  PluginRenderContext,
  PluginRequestContext,
  PluginRouteDeclaration,
  PluginRouteHandler,
  PluginSecretVerdict,
  PluginSettingDeclaration,
  PluginSiteSettings,
  RouteInput,
} from '../plugins/types.js';
export type { BundledTheme } from '../themes/index.js';
export type { Env } from './env.js';

/** The five official themes, ready to pass to {@link createMallok}. */
export const atelier: BundledTheme = THEMES.atelier as BundledTheme;
export const folio: BundledTheme = THEMES.folio as BundledTheme;
export const gazette: BundledTheme = THEMES.gazette as BundledTheme;
export const journal: BundledTheme = THEMES.journal as BundledTheme;
export const manual: BundledTheme = THEMES.manual as BundledTheme;

/** The official inquiry plugin (docs/PLUGIN_API.md §9). */
export const inquiry: MallokPlugin = inquiryPlugin;

/**
 * Builds a theme from a project's own files.
 *
 * The five official themes above are ready-made; this is for a theme that
 * lives in the site's repository. `files` is keyed by the theme's own paths
 * (`layouts/base.liquid`, `partials/header.liquid`, `locales/en.json`), with
 * the file's text as the value — `wrangler.jsonc` already declares the Text
 * rule that makes those imports strings.
 *
 * The manifest is validated here rather than at first render: a typo in
 * `theme.json` should fail the build, not the site.
 */
export function defineTheme(
  manifest: unknown,
  files: Readonly<Record<string, string>>,
): BundledTheme {
  return {
    manifest: parseThemeManifest(manifest),
    files: files as ThemeFiles,
  };
}

/** What a site declares about itself at build time. */
export interface MallokOptions {
  /** The theme this deployment renders with. */
  readonly theme: BundledTheme;
  /** Plugins compiled into this deployment. Defaults to none. */
  readonly plugins?: readonly PluginInput[];
}

/**
 * Declares a site's composition and returns its Worker handler.
 *
 * Call it once, at module scope, in the file `wrangler.jsonc` names as
 * `main`. Calling it inside a request would be too late: the theme is
 * compiled per isolate and plugin migrations run at boot.
 */
export function createMallok(options: MallokOptions): ExportedHandler<Env> {
  const plugins = normalizePlugins(options.plugins ?? []);
  configure({ theme: options.theme, plugins });
  return mallokHandler;
}
