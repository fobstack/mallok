/**
 * The core SEO endpoints: `/sitemap.xml` (paginated, with hreflang),
 * `/feed.xml` per locale, and `/robots.txt` (docs/SEO_PERFORMANCE.md).
 *
 * All three are served from the edge cache like any public page. Only the
 * canonical host is indexable: `.workers.dev` and any other host get a
 * disallow-all robots file, so a preview URL can never compete with the real
 * domain in search results.
 */

import {
  buildFeed,
  buildHomePath,
  buildRobots,
  buildSitemap,
  buildSitemapIndex,
  type SitemapEntry,
} from '../core/index.js';
import { listForSitemap, listPublished, loadSite } from '../db/queries.js';
import { matchCached, storeCached } from './cache.js';
import type { Env } from './env.js';
import { problem } from './http.js';
import { parseSiteSettings, type SiteSettings, siteOrigin } from './site.js';

/** Pages per sitemap file (docs/SEO_PERFORMANCE.md §3). */
const SITEMAP_PAGE = 5000;
const FEED_ITEMS = 20;

const SITEMAP_PATTERN = /^\/sitemap(?:-(\d+))?\.xml$/;
const FEED_PATTERN = /^(?:\/([a-z]{2}(?:-[A-Za-z]{2,4})?))?\/feed\.xml$/;

/** Reports whether `pathname` belongs to this module. */
export function isSeoPath(pathname: string): boolean {
  return (
    pathname === '/robots.txt' ||
    SITEMAP_PATTERN.test(pathname) ||
    FEED_PATTERN.test(pathname)
  );
}

/** Serves one SEO endpoint. Call only when {@link isSeoPath} is true. */
export async function handleSeo(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return problem(405, 'Method not allowed.');
  }
  const cached = await matchCached(request);
  if (cached !== undefined) {
    return cached;
  }

  const row = await loadSite(env.DB);
  if (row === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(row);
  const origin = siteOrigin(settings, request);

  if (pathname === '/robots.txt') {
    // Only the bound custom domain is indexable; without one, nothing is.
    const host = new URL(request.url).host;
    const indexable = settings.domain !== null && host === settings.domain;
    const body = buildRobots({
      indexable,
      sitemapUrl: `${origin}/sitemap.xml`,
    });
    return finish(request, ctx, text(body), settings, ['site']);
  }

  const sitemapMatch = SITEMAP_PATTERN.exec(pathname);
  if (sitemapMatch !== null) {
    const page = sitemapMatch[1] === undefined ? null : Number(sitemapMatch[1]);
    const response = await sitemap(env, settings, origin, page);
    return finish(request, ctx, response, settings, ['sitemap']);
  }

  const feedMatch = FEED_PATTERN.exec(pathname);
  if (feedMatch !== null) {
    const locale = feedMatch[1] ?? settings.defaultLocale;
    if (!settings.locales.includes(locale)) {
      return problem(404, 'Not found.');
    }
    const response = await feed(env, settings, origin, locale);
    return finish(request, ctx, response, settings, [`feed:${locale}`]);
  }

  return problem(404, 'Not found.');
}

async function sitemap(
  env: Env,
  settings: SiteSettings,
  origin: string,
  page: number | null,
): Promise<Response> {
  const now = new Date().toISOString();

  if (page === null) {
    const first = await listForSitemap(env.DB, now, SITEMAP_PAGE, 0);
    if (!first.hasNext) {
      return xml(buildSitemap(toEntries(first.rows, settings, origin)));
    }
    // More than one page: emit an index. Walking the pages to count them is
    // bounded by content volume / 5000, which is small for any real site.
    const urls = [`${origin}/sitemap-1.xml`];
    let offset = SITEMAP_PAGE;
    for (let index = 2; index <= 50; index++) {
      const next = await listForSitemap(env.DB, now, SITEMAP_PAGE, offset);
      if (next.rows.length === 0) {
        break;
      }
      urls.push(`${origin}/sitemap-${index}.xml`);
      if (!next.hasNext) {
        break;
      }
      offset += SITEMAP_PAGE;
    }
    return xml(buildSitemapIndex(urls));
  }

  if (page < 1) {
    return problem(404, 'Not found.');
  }
  const slice = await listForSitemap(
    env.DB,
    now,
    SITEMAP_PAGE,
    (page - 1) * SITEMAP_PAGE,
  );
  if (slice.rows.length === 0) {
    return problem(404, 'Not found.');
  }
  return xml(buildSitemap(toEntries(slice.rows, settings, origin)));
}

function toEntries(
  rows: readonly {
    path: string;
    locale: string;
    translation_group: string;
    updated_at: string;
  }[],
  settings: SiteSettings,
  origin: string,
): SitemapEntry[] {
  // Rows arrive ordered by translation group, so siblings are adjacent and
  // grouping needs no second query.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = groups.get(row.translation_group) ?? [];
    (list as (typeof rows)[number][]).push(row);
    groups.set(row.translation_group, list);
  }
  const entries: SitemapEntry[] = [];
  for (const row of rows) {
    const siblings = groups.get(row.translation_group) ?? [row];
    const fallback =
      siblings.find((item) => item.locale === settings.defaultLocale) ?? row;
    entries.push({
      url: `${origin}${row.path}`,
      lastModified: row.updated_at,
      alternates: siblings.map((item) => ({
        locale: item.locale,
        url: `${origin}${item.path}`,
      })),
      defaultUrl: `${origin}${fallback.path}`,
    });
  }
  return entries;
}

async function feed(
  env: Env,
  settings: SiteSettings,
  origin: string,
  locale: string,
): Promise<Response> {
  const now = new Date().toISOString();
  const recent = await listPublished(
    env.DB,
    'article',
    locale,
    FEED_ITEMS,
    0,
    now,
  );
  const prefix = buildHomePath(locale, settings.defaultLocale);
  const feedPath =
    locale === settings.defaultLocale ? '/feed.xml' : `${prefix}feed.xml`;
  return xml(
    buildFeed({
      siteName: settings.name,
      siteUrl: `${origin}${prefix}`,
      feedUrl: `${origin}${feedPath}`,
      description: settings.tagline,
      locale,
      items: recent.items.map((item) => ({
        title: item.title,
        url: `${origin}${item.path}`,
        description: item.description ?? '',
        publishedAt: item.published_at ?? item.updated_at,
      })),
    }),
    'application/rss+xml; charset=utf-8',
  );
}

function xml(body: string, type = 'application/xml; charset=utf-8'): Response {
  return new Response(body, { headers: { 'content-type': type } });
}

function text(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function finish(
  request: Request,
  ctx: ExecutionContext,
  response: Response,
  settings: SiteSettings,
  tags: string[],
): Response {
  return storeCached(ctx, request, response, settings.cacheTtl, { tags });
}
