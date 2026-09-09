/**
 * A tag archive: `/tags/<tag>` and `/tags/<tag>/page/<n>`
 * (docs/CONTENT_FORMAT.md §3.1).
 *
 * This is the one list shape Mallok knows statically — a kind's own list
 * path comes from `site.json` and is resolved from data, so it lives in the
 * catch-all page instead.
 */

import { definePage } from '@fobstack/runtime';
import { listByTag } from '../../db/queries.js';
import { runAfterRender } from '../plugin-runtime.js';
import {
  renderListPage,
  renderNotFoundPage,
  resolveCovers,
} from '../render.js';
import { LIST_PAGE_SIZE, type PublicLocals, publicHeaders } from './context.js';

const PAGED = /^(.+?)(?:\/page\/(\d+))?$/;

type Archive =
  | {
      readonly found: true;
      readonly tag: string;
      readonly page: number;
      readonly rows: Awaited<ReturnType<typeof listByTag>>;
      readonly covers: Awaited<ReturnType<typeof resolveCovers>>;
    }
  | { readonly found: false };

export default definePage<PublicLocals>()({
  load: async ({ params, locals }): Promise<Archive> => {
    const raw = params.tag ?? '';
    const matched = PAGED.exec(raw);
    const tag = decodeURIComponent(matched?.[1] ?? '');
    const page = matched?.[2] === undefined ? 1 : Number(matched[2]);
    if (tag === '' || page < 1) {
      return { found: false };
    }
    const rows = await listByTag(
      locals.env.DB,
      locals.locale,
      tag,
      LIST_PAGE_SIZE,
      (page - 1) * LIST_PAGE_SIZE,
      locals.now,
    );
    if (rows.items.length === 0) {
      // An empty archive is a 404, not a blank page: otherwise every string
      // anyone types becomes a thin page at its own URL.
      return { found: false };
    }
    const covers = await resolveCovers(
      locals.env.DB,
      rows.items,
      locals.settings.mediaBaseUrl,
    );
    return { found: true, tag, page, rows, covers };
  },

  render: async (archive, { locals }) => {
    if (!archive.found) {
      // `noindex` is a header, not a `<meta>`: Mallok's themes own `<head>`,
      // so the runtime's head descriptor never reaches the document.
      return {
        body: await renderNotFoundPage(locals.render),
        status: 404,
        headers: publicHeaders(locals, { 'x-robots-tag': 'noindex' }),
      };
    }
    const { tag, page, rows, covers } = archive;
    const prefix =
      locals.locale === locals.settings.defaultLocale
        ? ''
        : `/${locals.locale}`;
    const rendered = await renderListPage(
      locals.render,
      'tag',
      rows,
      page,
      `${prefix}/tags/${encodeURIComponent(tag)}`,
      `tags/${encodeURIComponent(tag)}`,
      covers,
      tag,
    );
    const body = await runAfterRender(locals.data.plugins, rendered, {
      site: locals.settings,
      locale: locals.locale,
      path: locals.pathname,
      content: null,
    });
    return { body, headers: publicHeaders(locals) };
  },

  // A 404 is rendered but never stored: the tag it wanted may exist by the
  // time the next request asks.
  cache: (archive, { locals }) =>
    archive.found
      ? {
          mode: 'public',
          edgeSeconds: locals.settings.cacheTtl,
          tags: ['site', `tag:${locals.locale}`],
        }
      : { mode: 'no-store' },
});
