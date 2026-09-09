/**
 * The home page of a locale.
 *
 * `render` returns the theme's complete document, because Mallok's themes
 * own `<html>` (`layouts/base.liquid`). The runtime's document renderer for
 * Mallok passes that through untouched, so exactly one component writes the
 * document.
 */

import { listPublished } from '../../db/queries.js';
import { definePage } from '../../runtime/core/index.js';
import { runAfterRender } from '../plugin-runtime.js';
import { renderHomePage, resolveCovers } from '../render.js';
import { HOME_RECENT, type PublicLocals, publicHeaders } from './context.js';

export default definePage<PublicLocals>()({
  load: async ({ locals }) => {
    const recent = await listPublished(
      locals.env.DB,
      'article',
      locals.locale,
      HOME_RECENT,
      0,
      locals.now,
    );
    const covers = await resolveCovers(
      locals.env.DB,
      recent.items,
      locals.settings.mediaBaseUrl,
    );
    return { recent, covers };
  },

  render: async ({ recent, covers }, { locals }) => {
    const rendered = await renderHomePage(
      locals.render,
      { article: recent.items },
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
  cache: (_data, { locals }) => ({
    mode: 'public',
    edgeSeconds: locals.settings.cacheTtl,
    tags: ['site', `home:${locals.locale}`],
  }),
});
