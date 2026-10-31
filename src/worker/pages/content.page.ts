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

import { localePrefix } from '../../core/index.js';
import type { ContentRow } from '../../db/queries.js';
import { findRedirect, listPublished } from '../../db/queries.js';
import { definePage } from '../../runtime/core/index.js';
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
import { runRenderData } from '../render-data.js';
import {
  LIST_PAGE_SIZE,
  type PublicLocals,
  publicHeaders,
  renderDataItem,
} from './context.js';

/** What `load` resolved the path to. */
type Resolved =
  | {
      readonly kind: 'content';
      readonly html: string;
      readonly row: ContentRow;
      /** Whether stage one had to re-run, surfaced for operators and tests. */
      readonly fragmentStatus: 'REGENERATED' | 'CACHED';
      /** A `renderData` hook failed; the page lacks that plugin's data. */
      readonly degraded: boolean;
      /** Tags the plugins declared for this page, already namespaced. */
      readonly pluginTags: readonly string[];
    }
  | {
      readonly kind: 'list';
      readonly html: string;
      readonly listKind: string;
      readonly degraded: boolean;
      readonly pluginTags: readonly string[];
    }
  | { readonly kind: 'missing'; readonly html: string };

/**
 * Where an address written for the other setting of the default locale's
 * prefix now lives, or null.
 *
 * - Prefix on: an unprefixed list address, `/products`, is
 *   `/<default>/products`. Only an address that is a list is redirected; any
 *   other unprefixed one is content, redirected by its own row, or nothing,
 *   and stays a 404.
 *
 * With the prefix off nothing is worked out here: a site that never turned
 * it on must answer exactly as before. A site that turns it off records the
 * redirects its old prefixed addresses need when it does
 * (`changeLocalePrefix`), and step 3 serves them.
 */
function prefixElsewhere(locals: PublicLocals): string | null {
  const { settings } = locals;
  if (!settings.prefixDefaultLocale || locals.prefixed) {
    return null;
  }
  const list = matchList(locals.rest, settings.kinds);
  return list !== null &&
    locals.render.theme.manifest.kinds[list.kind]?.listLayout !== undefined
    ? `/${settings.defaultLocale}${locals.rest}`
    : null;
}

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
      // Started now and awaited below, so the plugins' reads overlap the
      // core's own second round trip instead of following it.
      const pluginData = runRenderData(locals.env.DB, data.plugins, {
        site: settings,
        locale: locals.locale,
        path: locals.pathname,
        content: {
          id: data.content.id,
          kind: data.content.kind,
          translationGroup: data.content.translation_group,
          frontmatter: parseFrontmatter(data.content.frontmatter),
        },
        items: [],
      });
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
      const { plugins, structuredData, cacheTags, degraded } = await pluginData;
      const rendered = await renderContentPage(
        { ...locals.render, plugins, structuredData },
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
        degraded,
        pluginTags: cacheTags,
      };
    }

    // 2. A kind's list page, whose base path comes from the site settings.
    //    A kind the theme gives no list layout has no list page: its items
    //    are served under the base, and the base itself names nothing
    //    (docs/THEME_FORMAT.md §7.4).
    // An unprefixed path on a site that prefixes its default locale names
    // no list: only a stored redirect can answer it.
    const list = locals.prefixed
      ? matchList(locals.rest, settings.kinds)
      : null;
    if (
      list !== null &&
      locals.render.theme.manifest.kinds[list.kind]?.listLayout !== undefined
    ) {
      const rows = await listPublished(
        locals.env.DB,
        list.kind,
        locals.locale,
        LIST_PAGE_SIZE,
        (list.page - 1) * LIST_PAGE_SIZE,
        locals.now,
      );
      const [covers, { plugins, structuredData, cacheTags, degraded }] =
        await Promise.all([
          resolveCovers(locals.env.DB, rows.items, settings.mediaBaseUrl),
          runRenderData(locals.env.DB, data.plugins, {
            site: settings,
            locale: locals.locale,
            path: locals.pathname,
            content: null,
            items: rows.items.map(renderDataItem),
          }),
        ]);
      const prefix = localePrefix(locals.locale, settings);
      const rendered = await renderListPage(
        { ...locals.render, plugins, structuredData },
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
      return {
        kind: 'list',
        html,
        listKind: list.kind,
        degraded,
        pluginTags: cacheTags,
      };
    }

    // 3. A slug that moved. Returning a response stops the lifecycle.
    const redirect = await findRedirect(locals.env.DB, locals.pathname);
    if (redirect !== null) {
      return Response.redirect(
        new URL(`${redirect.to_path}${url.search}`, url.origin).toString(),
        redirect.status,
      );
    }

    // 4. An address written for the other setting of the default locale's
    //    prefix. Content records its own redirects when the setting changes
    //    (step 3); a list page has no row to record one for, so the address
    //    is worked out here instead. The home page and tag archives do the
    //    same in their own routes.
    const elsewhere = prefixElsewhere(locals);
    if (elsewhere !== null) {
      return Response.redirect(
        new URL(`${elsewhere}${url.search}`, url.origin).toString(),
        301,
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
    // Nor is anything an unclaimed site serves (`PublicLocals.unclaimed`).
    if (locals.unclaimed) {
      return { mode: 'no-store' };
    }
    // Rendered without a plugin's data because its hook failed. Storing that
    // would serve the lesser page for a whole TTL; the next request retries.
    if (resolved.degraded) {
      return { mode: 'no-store' };
    }
    if (resolved.kind === 'content') {
      return {
        mode: 'public',
        edgeSeconds: locals.settings.cacheTtl,
        tags: [
          ...tagsForContent(
            resolved.row.id,
            resolved.row.kind,
            resolved.row.locale,
          ),
          ...resolved.pluginTags,
        ],
      };
    }
    return {
      mode: 'public',
      edgeSeconds: locals.settings.cacheTtl,
      tags: [
        'site',
        `k:${resolved.listKind}:${locals.locale}`,
        ...resolved.pluginTags,
      ],
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

function parseFrontmatter(json: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
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
