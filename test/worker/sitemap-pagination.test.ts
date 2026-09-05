import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `AC-SEO-01b` (docs/ACCEPTANCE.md §8): past `SITEMAP_PAGE` entries,
 * `/sitemap.xml` becomes an index pointing at `/sitemap-<n>.xml`
 * (src/worker/seo-routes.ts). Implemented but previously untested.
 *
 * Rows are written straight into D1 rather than through
 * `POST /_mallok/api/content`: the sitemap reads only `content`'s scalar
 * columns (src/db/queries.ts, `listForSitemap`), so routing 5,001 items
 * through the full save pipeline would only slow this test down, not
 * exercise anything it cares about.
 */

const ORIGIN = 'https://sitemap-pagination.example';
const SITEMAP_PAGE = 5000;
const TOTAL = SITEMAP_PAGE + 1;
const PUBLISHED_AT = '2026-01-01T00:00:00.000Z';

async function seedPublishedArticles(count: number): Promise<void> {
  const chunk = 500;
  for (let start = 0; start < count; start += chunk) {
    const size = Math.min(chunk, count - start);
    const statements = [];
    for (let offset = 0; offset < size; offset++) {
      const n = start + offset;
      const id = `seed-${n}`;
      const slug = `sitemap-page-${n}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO content (
             id, kind, locale, translation_group, slug, path, title,
             frontmatter, markdown, markdown_sha256, status, published_at,
             created_at, updated_at
           ) VALUES (?, 'article', 'en', ?, ?, ?, ?, '{}', 'Body.', 'seed', 'published', ?, ?, ?)`,
        ).bind(
          id,
          id,
          slug,
          `/news/${slug}`,
          `Seed ${n}`,
          PUBLISHED_AT,
          PUBLISHED_AT,
          PUBLISHED_AT,
        ),
      );
    }
    await env.DB.batch(statements);
  }
}

describe('sitemap pagination past 5,000 entries', () => {
  beforeAll(async () => {
    await SELF.fetch(`${ORIGIN}/`);
    await seedPublishedArticles(TOTAL);
  }, 30000);

  it('emits a sitemap index once published content exceeds one page', async () => {
    const index = await SELF.fetch(`${ORIGIN}/sitemap.xml`);
    expect(index.status).toBe(200);
    const indexBody = await index.text();
    expect(indexBody).toContain('<sitemapindex');
    expect(indexBody).not.toContain('<urlset');
    expect(indexBody).toContain(`<loc>${ORIGIN}/sitemap-1.xml</loc>`);
    expect(indexBody).toContain(`<loc>${ORIGIN}/sitemap-2.xml</loc>`);
    expect(indexBody).not.toContain(`${ORIGIN}/sitemap-3.xml`);
  });

  it('fills each page to SITEMAP_PAGE entries and spills the remainder', async () => {
    const first = await (await SELF.fetch(`${ORIGIN}/sitemap-1.xml`)).text();
    expect(first).toContain('<urlset');
    expect(first.match(/<url>/g)?.length).toBe(SITEMAP_PAGE);

    const second = await (await SELF.fetch(`${ORIGIN}/sitemap-2.xml`)).text();
    expect(second).toContain('<urlset');
    expect(second.match(/<url>/g)?.length).toBe(TOTAL - SITEMAP_PAGE);
  });

  it('404s past the last page', async () => {
    const response = await SELF.fetch(`${ORIGIN}/sitemap-3.xml`);
    expect(response.status).toBe(404);
  });
});
