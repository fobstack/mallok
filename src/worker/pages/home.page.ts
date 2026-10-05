/**
 * The home page of a locale.
 *
 * `render` returns the theme's complete document, because Mallok's themes
 * own `<html>` (`layouts/base.liquid`). The runtime's document renderer for
 * Mallok passes that through untouched, so exactly one component writes the
 * document.
 */

import { HOME_RECENT, homeKinds } from '../../core/index.js';
import { listRecentByKind } from '../../db/queries.js';
import { definePage } from '../../runtime/core/index.js';
import { runAfterRender } from '../plugin-runtime.js';
import { renderHomePage, resolveCovers } from '../render.js';
import { runRenderData } from '../render-data.js';
import { type PublicLocals, publicHeaders, renderDataItem } from './context.js';

export default definePage<PublicLocals>()({
  load: async ({ locals }) => {
    // Every kind the theme lists, not `article` alone: a theme's
    // `recent.product` used to be empty on a served site
    // (docs/THEME_FORMAT.md §7.4).
    const recent = await listRecentByKind(
      locals.env.DB,
      homeKinds(locals.settings.kinds, locals.render.theme.manifest.kinds),
      locals.locale,
      HOME_RECENT,
      locals.now,
    );
    const items = Object.values(recent).flat();
    const [covers, pluginData] = await Promise.all([
      resolveCovers(locals.env.DB, items, locals.settings.mediaBaseUrl),
      runRenderData(locals.env.DB, locals.data.plugins, {
        site: locals.settings,
        locale: locals.locale,
        path: locals.pathname,
        content: null,
        items: items.map(renderDataItem),
      }),
    ]);
    return { recent, covers, pluginData };
  },

  render: async ({ recent, covers, pluginData }, { locals }) => {
    const rendered = await renderHomePage(
      {
        ...locals.render,
        plugins: pluginData.plugins,
        structuredData: pluginData.structuredData,
      },
      recent,
      covers,
    );
    const body = await runAfterRender(locals.data.plugins, rendered, {
      site: locals.settings,
      locale: locals.locale,
      path: locals.pathname,
      content: null,
    });
    return { body, headers: publicHeaders(locals) };
  },

  // `browserSeconds` is left at 0 on purpose: purging the edge does not reach
  // a visitor's browser, so a long browser lifetime would serve stale pages
  // long after an edit went live (docs/ARCHITECTURE.md §6).
  // A page rendered without a plugin's data because its hook failed is not
  // stored: the next request retries instead of serving it for a whole TTL.
  cache: ({ pluginData }, { locals }) =>
    pluginData.degraded
      ? { mode: 'no-store' }
      : {
          mode: 'public',
          edgeSeconds: locals.settings.cacheTtl,
          tags: ['site', `home:${locals.locale}`, ...pluginData.cacheTags],
        },
});
