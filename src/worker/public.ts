/**
 * The public request path: edge cache first, then a bounded D1 batch and a
 * stage-two render. See docs/ARCHITECTURE.md §4.
 */

import { parsePublicPath } from '../core/index.js';
import {
  findRedirect,
  listByTag,
  listPublished,
  loadContentRenderData,
  loadSiteRenderData,
} from '../db/queries.js';
import { matchCached, storeCached, tagsForContent } from './cache.js';
import type { Env } from './env.js';
import { html, problem } from './http.js';
import { runAfterRender } from './plugin-runtime.js';
import {
  ensureFragment,
  loadRelations,
  type RenderContext,
  renderContentPage,
  renderHomePage,
  renderListPage,
  resolveCovers,
} from './render.js';
import { parseSiteSettings, siteOrigin } from './site.js';
import { getCompiledTheme } from './theme-cache.js';

const LIST_PAGE_SIZE = 20;
const HOME_RECENT = 10;

/** Options that the spike uses to bypass the cache. */
export interface PublicOptions {
  /** Skip cache lookup and storage; render every time. */
  readonly bypassCache?: boolean;
}

/** Handles a GET request for a public page. */
export async function handlePublic(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  options: PublicOptions = {},
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return problem(405, 'Method not allowed.');
  }
  if (options.bypassCache !== true) {
    const cached = await matchCached(request);
    if (cached !== undefined) {
      return cached;
    }
  }

  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const now = new Date().toISOString();

  // The site row is needed to interpret the path, but it is part of the same
  // batch that fetches the content, so we speculatively look up the content
  // by the raw pathname and only fall back to the home/list branches when
  // nothing matches.
  const data = await loadContentRenderData(env.DB, pathname);
  if (data.site === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(data.site);
  const parsed = parsePublicPath(
    pathname,
    settings.locales,
    settings.defaultLocale,
  );
  const theme = getCompiledTheme();
  const renderCtx: RenderContext = {
    settings,
    theme,
    origin: siteOrigin(settings, request),
    locale: parsed.locale,
    path: pathname,
  };

  if (data.content !== null) {
    if (!isVisible(data.content.status, data.content.published_at, now)) {
      return problem(404, 'Not found.');
    }
    const fragment = await ensureFragment(
      env.DB,
      data.content,
      settings,
      data.plugins,
      data.fragment,
      now,
    );
    // Related content the theme asked for by declaring `reference` fields
    // (docs/THEME_FORMAT.md §7.5); one extra batch, bounded rows.
    const relations = await loadRelations(
      env.DB,
      theme.manifest,
      data.content,
      settings.mediaBaseUrl,
      now,
    );
    const rendered = await renderContentPage(
      renderCtx,
      data.content,
      fragment,
      data.translations,
      relations,
    );
    const body = await runAfterRender(data.plugins, rendered, {
      site: settings,
      locale: parsed.locale,
      path: pathname,
      content: { id: data.content.id, kind: data.content.kind },
    });
    const response = html(body);
    response.headers.set(
      'x-mallok-fragment',
      fragment.regenerated ? 'REGENERATED' : 'CACHED',
    );
    return finish(
      request,
      ctx,
      response,
      settings.cacheTtl,
      options,
      {
        tags: tagsForContent(
          data.content.id,
          data.content.kind,
          data.content.locale,
        ),
      },
      settings,
    );
  }

  if (parsed.rest === '/') {
    const recent = await listPublished(
      env.DB,
      'article',
      parsed.locale,
      HOME_RECENT,
      0,
      now,
    );
    const covers = await resolveCovers(
      env.DB,
      recent.items,
      settings.mediaBaseUrl,
    );
    const rendered = await renderHomePage(
      renderCtx,
      { article: recent.items },
      covers,
    );
    const body = await runAfterRender(data.plugins, rendered, {
      site: settings,
      locale: parsed.locale,
      path: pathname,
      content: null,
    });
    return finish(
      request,
      ctx,
      html(body),
      settings.cacheTtl,
      options,
      { tags: ['site', `home:${parsed.locale}`] },
      settings,
    );
  }

  // `/tags/<tag>` and `/<locale>/tags/<tag>` (docs/CONTENT_FORMAT.md §3.1).
  const tagMatch = /^\/tags\/([^/]+)(?:\/page\/(\d+))?$/.exec(parsed.rest);
  if (tagMatch !== null) {
    const tag = decodeURIComponent(tagMatch[1] ?? '');
    const page = tagMatch[2] === undefined ? 1 : Number(tagMatch[2]);
    if (tag === '' || page < 1) {
      return problem(404, 'Not found.');
    }
    const rows = await listByTag(
      env.DB,
      parsed.locale,
      tag,
      LIST_PAGE_SIZE,
      (page - 1) * LIST_PAGE_SIZE,
      now,
    );
    if (rows.items.length === 0) {
      // An empty archive is a 404, not a blank page: it would otherwise be a
      // thin page at an arbitrary URL for every string anyone types.
      return problem(404, 'Not found.');
    }
    const prefix =
      parsed.locale === settings.defaultLocale ? '' : `/${parsed.locale}`;
    const covers = await resolveCovers(
      env.DB,
      rows.items,
      settings.mediaBaseUrl,
    );
    const rendered = await renderListPage(
      renderCtx,
      'tag',
      rows,
      page,
      `${prefix}/tags/${encodeURIComponent(tag)}`,
      `tags/${encodeURIComponent(tag)}`,
      covers,
      tag,
    );
    const body = await runAfterRender(data.plugins, rendered, {
      site: settings,
      locale: parsed.locale,
      path: pathname,
      content: null,
    });
    return finish(
      request,
      ctx,
      html(body),
      settings.cacheTtl,
      options,
      { tags: ['site', `tag:${parsed.locale}`] },
      settings,
    );
  }

  const list = matchList(parsed.rest, settings.kinds);
  if (list !== null) {
    const offset = (list.page - 1) * LIST_PAGE_SIZE;
    const rows = await listPublished(
      env.DB,
      list.kind,
      parsed.locale,
      LIST_PAGE_SIZE,
      offset,
      now,
    );
    const prefix =
      parsed.locale === settings.defaultLocale ? '' : `/${parsed.locale}`;
    const covers = await resolveCovers(
      env.DB,
      rows.items,
      settings.mediaBaseUrl,
    );
    const rendered = await renderListPage(
      renderCtx,
      list.kind,
      rows,
      list.page,
      `${prefix}/${list.base}`,
      list.base,
      covers,
    );
    const body = await runAfterRender(data.plugins, rendered, {
      site: settings,
      locale: parsed.locale,
      path: pathname,
      content: null,
    });
    return finish(
      request,
      ctx,
      html(body),
      settings.cacheTtl,
      options,
      { tags: ['site', `k:${list.kind}:${parsed.locale}`] },
      settings,
    );
  }

  const redirect = await findRedirect(env.DB, pathname);
  if (redirect !== null) {
    return Response.redirect(
      new URL(redirect.to_path, url.origin).toString(),
      redirect.status,
    );
  }
  return problem(404, 'Not found.');
}

/** Reports whether the site row exists (used by health). */
export async function siteIsReady(env: Env): Promise<boolean> {
  const data = await loadSiteRenderData(env.DB);
  return data.site !== null;
}

function finish(
  request: Request,
  ctx: ExecutionContext,
  response: Response,
  ttl: number,
  options: PublicOptions,
  tags: { tags: string[] },
  settings?: { readonly domain: string | null },
): Response {
  // A page served from any host but the bound domain must not be indexed:
  // a `.workers.dev` copy in search results competes with the real site
  // (docs/SEO_PERFORMANCE.md §10). The header varies with the host, which is
  // safe because the cache key includes the origin.
  if (settings !== undefined && settings.domain !== null) {
    const host = new URL(request.url).host;
    if (host !== settings.domain) {
      response.headers.set('x-robots-tag', 'noindex');
    }
  } else if (settings !== undefined) {
    response.headers.set('x-robots-tag', 'noindex');
  }
  if (options.bypassCache === true) {
    response.headers.set('cache-control', 'private, no-store');
    return response;
  }
  return storeCached(ctx, request, response, ttl, tags);
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isVisible(
  status: string,
  publishedAt: string | null,
  now: string,
): boolean {
  return status === 'published' && publishedAt !== null && publishedAt <= now;
}

interface ListMatch {
  readonly kind: string;
  readonly base: string;
  readonly page: number;
}

function matchList(
  rest: string,
  kinds: Readonly<Record<string, { readonly base: string }>>,
): ListMatch | null {
  const match = /^\/([a-z0-9-]+)(?:\/page\/(\d+))?$/.exec(rest);
  if (match === null) {
    return null;
  }
  const base = match[1] ?? '';
  const page = match[2] === undefined ? 1 : Number(match[2]);
  if (page < 1) {
    return null;
  }
  for (const [kind, config] of Object.entries(kinds)) {
    if (config.base !== '' && config.base === base) {
      return { kind, base, page };
    }
  }
  return null;
}
