import { expect, test } from '@playwright/test';

/**
 * The public site as a visitor meets it (docs/SEO_PERFORMANCE.md, §4–§6).
 *
 * The starter installed in `01-wizard.spec.ts` is a real bilingual trade
 * site, so these are its own pages rather than fixtures written to pass.
 */

test('renders a list page and a detail page from the starter', async ({
  page,
}) => {
  const list = await page.goto('/products');
  expect(list?.status()).toBe(200);

  const first = page.locator('a[href^="/products/"]').first();
  const href = await first.getAttribute('href');
  expect(href).not.toBeNull();

  const detail = await page.goto(href ?? '/');
  expect(detail?.status()).toBe(200);
  await expect(page).not.toHaveTitle('');
});

test('sends visitors no JavaScript on a public page', async ({ page }) => {
  // Zero client-side JavaScript is a product promise, not an optimisation
  // (docs/PRODUCT_VISION.md §4). The inquiry plugin's Turnstile is the one
  // documented exception, and the contact page is not this one.
  await page.goto('/about');

  const scripts = await page
    .locator('script')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('src') ?? 'inline'),
    );
  expect(scripts).toEqual([]);
});

test('serves the second language under its own prefix, with hreflang', async ({
  page,
}) => {
  const response = await page.goto('/zh/');
  expect(response?.status()).toBe(200);

  const alternates = await page
    .locator('link[rel="alternate"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('hreflang')));
  expect(alternates).toContain('en');
  expect(alternates).toContain('zh');
  expect(alternates).toContain('x-default');
});

test('answers the SEO endpoints', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('xml');
  expect(await sitemap.text()).toContain('<urlset');

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  // This host is not the site's custom domain, so it must not be indexed —
  // a preview address in Google is a duplicate of the real site
  // (docs/SEO_PERFORMANCE.md §10). The `Sitemap:` line appears on the
  // canonical host only.
  expect(await robots.text()).toContain('Disallow: /');
  expect(await robots.text()).not.toContain('Sitemap:');

  const feed = await request.get('/feed.xml');
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain('<rss');
});

test('renders a themed 404 rather than a blank one', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist');

  expect(response?.status()).toBe(404);
  // A 404 that still carries the site's own navigation is a page a visitor
  // can recover from.
  await expect(page.getByRole('navigation').first()).toBeVisible();
});

test('does not let a public page reach the admin API', async ({ request }) => {
  for (const path of [
    '/_mallok/api/content',
    '/_mallok/api/settings',
    '/_mallok/api/media',
  ]) {
    const response = await request.get(path, { failOnStatusCode: false });
    expect(response.status(), path).toBe(401);
  }
});
