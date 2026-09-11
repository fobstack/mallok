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

import { inquiryPlugin } from '../plugins/inquiry/index.js';
import type { MallokPlugin } from '../plugins/types.js';
import type { BundledTheme } from '../themes/index.js';
import { THEMES } from '../themes/index.js';
import { configure } from './composition.js';
import type { Env } from './env.js';
import { mallokHandler } from './handler.js';

export type { MallokPlugin } from '../plugins/types.js';
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

/** What a site declares about itself at build time. */
export interface MallokOptions {
  /** The theme this deployment renders with. */
  readonly theme: BundledTheme;
  /** Plugins compiled into this deployment. Defaults to none. */
  readonly plugins?: readonly MallokPlugin[];
}

/**
 * Declares a site's composition and returns its Worker handler.
 *
 * Call it once, at module scope, in the file `wrangler.jsonc` names as
 * `main`. Calling it inside a request would be too late: the theme is
 * compiled per isolate and plugin migrations run at boot.
 */
export function createMallok(options: MallokOptions): ExportedHandler<Env> {
  configure({ theme: options.theme, plugins: options.plugins ?? [] });
  return mallokHandler;
}
