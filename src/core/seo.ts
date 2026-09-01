/**
 * Sitemap, RSS and robots.txt generation (docs/SEO_PERFORMANCE.md §2, §3).
 *
 * Pure builders over plain data, so the Worker, the CLI and tests produce
 * identical bytes. Nothing here reads a clock: the feed's build date is the
 * newest item's date, which keeps the output deterministic and cacheable.
 */

import { escapeHtml } from './liquid.js';

/** One sitemap entry with the translations it belongs to. */
export interface SitemapEntry {
  /** Absolute URL of this page. */
  readonly url: string;
  readonly lastModified: string;
  /** Every locale of this translation group, including this page itself. */
  readonly alternates: readonly { locale: string; url: string }[];
  /** The group's URL in the site's default locale, for `x-default`. */
  readonly defaultUrl: string;
}

/** Builds a `<urlset>` sitemap with hreflang alternates. */
export function buildSitemap(entries: readonly SitemapEntry[]): string {
  const body = entries
    .map((entry) => {
      const alternates =
        entry.alternates.length > 1
          ? [
              ...entry.alternates.map(
                (alt) =>
                  `    <xhtml:link rel="alternate" hreflang="${escapeHtml(alt.locale)}" href="${escapeHtml(alt.url)}"/>`,
              ),
              `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(entry.defaultUrl)}"/>`,
            ].join('\n')
          : '';
      return [
        '  <url>',
        `    <loc>${escapeHtml(entry.url)}</loc>`,
        `    <lastmod>${escapeHtml(entry.lastModified)}</lastmod>`,
        alternates,
        '  </url>',
      ]
        .filter((line) => line !== '')
        .join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    body,
    '</urlset>',
    '',
  ].join('\n');
}

/** Builds a sitemap index pointing at paginated sitemaps. */
export function buildSitemapIndex(urls: readonly string[]): string {
  const body = urls
    .map((url) => `  <sitemap><loc>${escapeHtml(url)}</loc></sitemap>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    '</sitemapindex>',
    '',
  ].join('\n');
}

/** One feed item. */
export interface FeedItem {
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly publishedAt: string;
}

/** Inputs of {@link buildFeed}. */
export interface FeedInput {
  readonly siteName: string;
  readonly siteUrl: string;
  readonly feedUrl: string;
  readonly description: string;
  readonly locale: string;
  readonly items: readonly FeedItem[];
}

/**
 * Builds an RSS 2.0 feed. `lastBuildDate` is the newest item's date rather
 * than "now", so identical inputs produce identical bytes.
 */
export function buildFeed(input: FeedInput): string {
  const newest = input.items[0]?.publishedAt;
  const items = input.items
    .map((item) =>
      [
        '    <item>',
        `      <title>${escapeHtml(item.title)}</title>`,
        `      <link>${escapeHtml(item.url)}</link>`,
        `      <guid isPermaLink="true">${escapeHtml(item.url)}</guid>`,
        item.description === ''
          ? ''
          : `      <description>${escapeHtml(item.description)}</description>`,
        `      <pubDate>${rfc822(item.publishedAt)}</pubDate>`,
        '    </item>',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeHtml(input.siteName)}</title>`,
    `    <link>${escapeHtml(input.siteUrl)}</link>`,
    `    <atom:link href="${escapeHtml(input.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <description>${escapeHtml(input.description)}</description>`,
    `    <language>${escapeHtml(input.locale)}</language>`,
    newest === undefined
      ? ''
      : `    <lastBuildDate>${rfc822(newest)}</lastBuildDate>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Inputs of {@link buildRobots}. */
export interface RobotsInput {
  /**
   * Whether this host should be indexed. False on `.workers.dev` and any
   * host other than the bound custom domain (docs/SEO_PERFORMANCE.md §10).
   */
  readonly indexable: boolean;
  /** Absolute sitemap URL on the canonical origin. */
  readonly sitemapUrl: string;
}

/** Builds robots.txt. */
export function buildRobots(input: RobotsInput): string {
  if (!input.indexable) {
    return ['User-agent: *', 'Disallow: /', ''].join('\n');
  }
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /_mallok/',
    `Sitemap: ${input.sitemapUrl}`,
    '',
  ].join('\n');
}

function rfc822(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toUTCString();
}
