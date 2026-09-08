/**
 * Everything resolved from data rather than from the file tree: a content
 * item at its own path, a kind's list page, a stored redirect, and the
 * themed 404 when none of those matched.
 *
 * This is a catch-all because Mallok's URLs are a catch-all: a kind's base
 * path comes from `site.json`, so `/products` and `/about` are the same
 * shape until the database says otherwise. Splitting them into `/[base]` and
 * `/[slug]` would be two routes the router could not tell apart — and it
 * would rightly refuse them.
 */

import { definePage } from '@fobstack/runtime';
import type { ContentRow } from '../../db/queries.js';
import { findRedirect, listPublished } from '../../db/queries.js';
import { tagsForContent } from '../cache.js';
import { runAfterRender } from '../plugin-runtime.js';
import {
  ensureFragment,
  loadRelations,
  renderContentPage,
  renderListPage,
  renderNotFoundPage,
  resolveCovers,
} from '../render.js';
import { LIST_PAGE_SIZE, type PublicLocals, publicHeaders } from './context.js';

/** What `load` resolved the path to. */
type Resolved =
  | {
      readonly kind: 'content';
      readonly html: string;
      readonly row: ContentRow;
      /** Whether stage one had to re-run, surfaced for operators and tests. */
      readonly fragmentStatus: 'REGENERATED' | 'CACHED';
    }
  | { readonly kind: 'list'; readonly html: string; readonly listKind: string }
  | { readonly kind: 'missing'; readonly html: string };

export default definePage<PublicLocals>()({
  load: async ({ locals, url }): Promise<Resolved | Response> => {
    const { data, settings } = locals;

    // 1. The speculative batch already looked this path up as content.
    if (data.content !== null) {
      if (
        !isVisible(data.content.status, data.content.published_at, locals.now)
      ) {
        return await notFound(locals);
      }
      const fragment = await ensureFragment(
        locals.env.DB,
        data.content,
        settings,
        data.plugins,
        data.fragment,
        locals.now,
      );
      const relations = await loadRelations(
        locals.env.DB,
        locals.render.theme.manifest,
        data.content,
        settings.mediaBaseUrl,
        locals.now,
      );
      const rendered = await renderContentPage(
        locals.render,
        data.content,
        fragment,
        data.translations,
        relations,
      );
      const html = await runAfterRender(data.plugins, rendered, {
        site: settings,
        locale: locals.locale,
        path: locals.pathname,
        content: { id: data.content.id, kind: data.content.kind },
      });
      return {
        kind: 'content',
        html,
        row: data.content,
        fragmentStatus: fragment.regenerated ? 'REGENERATED' : 'CACHED',
      };
    }

    // 2. A kind's list page, whose base path comes from the site settings.
    const list = matchList(locals.rest, settings.kinds);
    if (list !== null) {
      const rows = await listPublished(
        locals.env.DB,
        list.kind,
        locals.locale,
        LIST_PAGE_SIZE,
        (list.page - 1) * LIST_PAGE_SIZE,
        locals.now,
      );
      const covers = await resolveCovers(
        locals.env.DB,
        rows.items,
        settings.mediaBaseUrl,
      );
      const prefix =
        locals.locale === settings.defaultLocale ? '' : `/${locals.locale}`;
      const rendered = await renderListPage(
        locals.render,
        list.kind,
        rows,
        list.page,
        `${prefix}/${list.base}`,
        list.base,
        covers,
      );
      const html = await runAfterRender(data.plugins, rendered, {
        site: settings,
        locale: locals.locale,
        path: locals.pathname,
        content: null,
      });
      return { kind: 'list', html, listKind: list.kind };
    }

    // 3. A slug that moved. Returning a response stops the lifecycle.
    const redirect = await findRedirect(locals.env.DB, locals.pathname);
    if (redirect !== null) {
      return Response.redirect(
        new URL(redirect.to_path, url.origin).toString(),
        redirect.status,
      );
    }

    return await notFound(locals);
  },

  /**
   * The theme already produced a whole document; `render` hands it back with
   * the status the resolution implies. A missing page is a real page — the
   * theme's own — at a 404, not a bare JSON error.
   */
  render: (resolved, { locals }) => ({
    body: resolved.html,
    ...(resolved.kind === 'missing' ? { status: 404 } : {}),
    // `noindex` on a 404 is a header, not a `<meta>`: Mallok's themes own
    // `<head>`, so the runtime's head descriptor never reaches the document.
    headers: publicHeaders(locals, extraHeaders(resolved)),
  }),

  cache: (resolved, { locals }) => {
    // A 404 is rendered but never stored: the next request has to ask again,
    // because the page it wanted may exist by then.
    if (resolved.kind === 'missing') {
      return { mode: 'no-store' };
    }
    if (resolved.kind === 'content') {
      return {
        mode: 'public',
        edgeSeconds: locals.settings.cacheTtl,
        tags: tagsForContent(
          resolved.row.id,
          resolved.row.kind,
          resolved.row.locale,
        ),
      };
    }
    return {
      mode: 'public',
      edgeSeconds: locals.settings.cacheTtl,
      tags: ['site', `k:${resolved.listKind}:${locals.locale}`],
    };
  },
});

/** Headers only some resolutions carry. */
function extraHeaders(resolved: Resolved): Record<string, string> {
  if (resolved.kind === 'content') {
    return { 'x-mallok-fragment': resolved.fragmentStatus };
  }
  return resolved.kind === 'missing' ? { 'x-robots-tag': 'noindex' } : {};
}

async function notFound(locals: PublicLocals): Promise<Resolved> {
  const html = await renderNotFoundPage(locals.render);
  return { kind: 'missing', html };
}

/**
 * Only published items with a date that has passed are public: a draft and a
 * scheduled item both 404 until then (docs/DATA_MODEL.md §2).
 */
function isVisible(
  status: string,
  publishedAt: string | null,
  now: string,
): boolean {
  return status === 'published' && publishedAt !== null && publishedAt <= now;
}

/** `/products` and `/products/page/2`, where `products` is a kind's base. */
function matchList(
  rest: string,
  kinds: Readonly<Record<string, { readonly base: string }>>,
): { kind: string; base: string; page: number } | null {
  const matched = /^\/([a-z0-9-]+)(?:\/page\/(\d+))?$/.exec(rest);
  if (matched === null) {
    return null;
  }
  const base = matched[1] ?? '';
  const page = matched[2] === undefined ? 1 : Number(matched[2]);
  if (page < 1) {
    return null;
  }
  for (const [kind, config] of Object.entries(kinds)) {
    if (config.base === base && config.base !== '') {
      return { kind, base, page };
    }
  }
  return null;
}
