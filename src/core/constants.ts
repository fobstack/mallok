/**
 * Shared constants with **no imports**.
 *
 * They live apart from the modules that use them so a consumer needing one
 * value does not drag in the rendering pipeline. The admin's appearance page
 * needs `LOCALE_OPTIONS_KEY` and nothing else; importing it from `view.ts`
 * pulled unified, remark, rehype and LiquidJS into the admin's first-load
 * bundle and took it from 17 KiB to 137 KiB.
 */

/**
 * Reserved key inside `site.theme_options` holding per-locale overrides
 * (docs/THEME_FORMAT.md §6.1).
 *
 * Option names are `[a-z][a-z0-9_]*`, so this cannot collide with one.
 */
export const LOCALE_OPTIONS_KEY = '$locales';
