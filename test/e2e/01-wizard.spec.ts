import { expect, test } from '@playwright/test';
import { E2E_ENV } from '../../scripts/e2e-config.mjs';
import { ADMIN } from './credentials.js';

/** The key this run's Worker was given (`scripts/e2e-config.mjs`). */
const SETUP_KEY = E2E_ENV.MALLOK_SETUP_KEY;

/**
 * The first-run wizard (`AC-DEPLOY-03`, docs/ADMIN.md §5).
 *
 * This is the first thing every deployment does and the one flow that cannot
 * be repeated: as soon as `site.setup_completed_at` is set, every setup route
 * answers 404. It runs first in this suite because the administrator it
 * creates is the account every later test signs in as.
 */
test.describe.configure({ mode: 'serial' });

test('creates the administrator, the site and the starter content', async ({
  page,
}) => {
  await page.goto('/_mallok/setup');

  // ---- Step 1: the administrator ----------------------------------------
  await expect(
    page.getByRole('heading', { name: 'Create the administrator' }),
  ).toBeVisible();
  await page.locator('#setup-email').fill(ADMIN.email);
  await page.locator('#setup-password').fill(ADMIN.password);

  // The key is typed in, exactly as a site owner types the one `mallok
  // create` printed. A site with no setup key refuses to create an
  // administrator at all — that is the production default
  // (`docs/SECURITY.md §3.7`), and a suite that turned it off with
  // `MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY` would be exercising a configuration
  // nobody ships. The field is only rendered when the site asks for one, so
  // its presence is itself part of the assertion.
  await expect(page.locator('#setup-key')).toBeVisible();
  await page.locator('#setup-key').fill(SETUP_KEY);
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Step 2: the site --------------------------------------------------
  await expect(page.locator('#setup-name')).toBeVisible();
  await page.locator('#setup-name').fill('Titanium E2E');
  await page.locator('#setup-extra').fill('zh');
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Step 3: the starter ----------------------------------------------
  await expect(
    page.getByRole('heading', { name: 'Start with example content?' }),
  ).toBeVisible();
  await page.locator('input[name="starter"]').first().check();
  await page.getByRole('button', { name: 'Install' }).click();

  // ---- Step 4: the domain, and what it honestly cannot do ----------------
  await expect(
    page.getByRole('heading', { name: 'Your domain' }),
  ).toBeVisible();
  // The wizard must say that a .workers.dev address is a preview with no edge
  // cache, rather than let the user believe they have a live site
  // (docs/ARCHITECTURE.md §2).
  await expect(page.getByText('workers.dev').first()).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(
    page.getByRole('heading', { name: 'Your site is ready' }),
  ).toBeVisible();
});

test('serves the public site the starter filled in', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  // The theme owns the whole document, so the assertion is that a real page
  // came back — a title, a nav and body content — not a specific markup shape.
  await expect(page).not.toHaveTitle('');
  await expect(page.locator('body')).not.toBeEmpty();
  expect(
    await page.locator('main, article, .content, body > *').count(),
  ).toBeGreaterThan(0);
});

test('will not run the wizard a second time', async ({ page, request }) => {
  // Anyone who finds the URL after setup must not be able to re-seed the site.
  const status = await request.post('/_mallok/api/setup/admin', {
    data: { email: 'intruder@example.com', password: 'a-very-long-password' },
    failOnStatusCode: false,
  });
  expect(status.status()).toBe(404);

  await page.goto('/_mallok/setup');
  await expect(
    page.getByRole('heading', { name: 'Create the administrator' }),
  ).toHaveCount(0);
});
