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

test('homepage carousel supports selectors, wraparound and keyboard navigation', async ({
  page,
}) => {
  await page.goto('/');
  const slides = page.locator('[data-slide]');
  await expect(slides).toHaveCount(3);
  await expect(slides.nth(0)).toBeVisible();
  await page
    .getByRole('button', { name: 'Previous slide', exact: true })
    .click();
  await expect(slides.nth(2)).toBeVisible();
  await expect(slides.nth(0)).toBeHidden();
  await page.getByRole('button', { name: 'Next slide', exact: true }).click();
  await expect(slides.nth(0)).toBeVisible();
  const selectors = page.locator('[data-slide-link]');
  await selectors.nth(1).click();
  await expect(slides.nth(1)).toBeVisible();
  await selectors.nth(1).press('End');
  await expect(slides.nth(2)).toBeVisible();
  await expect(selectors.nth(2)).toBeFocused();
  await selectors.nth(2).press('Home');
  await expect(slides.nth(0)).toBeVisible();
  await expect(selectors.nth(0)).toHaveAttribute('aria-current', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 300, y: 200 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 80, y: 205 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await touch.detach();
  await expect(slides.nth(1)).toBeVisible();
});

test('homepage remains navigable with JavaScript disabled', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:8788/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('[data-carousel-arrows]')).toBeHidden();
    await page.locator('[data-slide-link="2"]').click();
    await expect(page).toHaveURL(/#hero-slide-3$/);
    await expect(page.locator('#hero-slide-3')).toBeInViewport();
  } finally {
    await context.close();
  }
});
