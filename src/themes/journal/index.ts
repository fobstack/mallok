/**
 * The bundled `journal` theme. Templates and locale bundles are imported as
 * text so they travel with the Worker; `assets/` is copied to Static Assets by
 * `scripts/build-themes.mjs` and never reaches this file.
 */

import { parseThemeManifest, type ThemeFiles } from '../../core/index.js';
import articleLiquid from './layouts/article.liquid';
import baseLiquid from './layouts/base.liquid';
import homeLiquid from './layouts/home.liquid';
import listLiquid from './layouts/list.liquid';
import pageLiquid from './layouts/page.liquid';
import enJson from './locales/en.json';
import zhJson from './locales/zh.json';
import footerLiquid from './partials/footer.liquid';
import headerLiquid from './partials/header.liquid';
import manifestJson from './theme.json';

/** Parsed and validated manifest of the bundled theme. */
export const journalManifest = parseThemeManifest(manifestJson);

/** Text files of the bundled theme, keyed by path inside the theme. */
export const journalFiles: ThemeFiles = {
  'layouts/base.liquid': baseLiquid,
  'layouts/home.liquid': homeLiquid,
  'layouts/article.liquid': articleLiquid,
  'layouts/page.liquid': pageLiquid,
  'layouts/list.liquid': listLiquid,
  'partials/header.liquid': headerLiquid,
  'partials/footer.liquid': footerLiquid,
  'locales/en.json': JSON.stringify(enJson),
  'locales/zh.json': JSON.stringify(zhJson),
};
