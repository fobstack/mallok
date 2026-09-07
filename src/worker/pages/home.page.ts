/**
 * The home page of a locale.
 *
 * `render` returns the theme's complete document, because Mallok's themes
 * own `<html>` (`layouts/base.liquid`). The runtime's document renderer for
 * Mallok passes that through untouched, so exactly one component writes the
 * document.
 */

import { definePage } from '@fobstack/runtime';
import { listPublished } from '../../db/queries.js';
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

  cache: (_data, { locals }) => ({
    mode: 'public',
    edgeSeconds: locals.settings.cacheTtl,
    browserSeconds: locals.settings.cacheTtl,
    tags: ['site', `home:${locals.locale}`],
  }),
});
