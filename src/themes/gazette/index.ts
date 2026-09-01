/** The `gazette` theme: trade news, sorted by section colour. */

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

/** Parsed and validated manifest. */
export const gazetteManifest = parseThemeManifest(manifestJson);

/** Text files of the theme, keyed by path inside it. */
export const gazetteFiles: ThemeFiles = {
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
