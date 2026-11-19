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
  await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  // Typed once, so it can be read back (docs/ADMIN_I18N_AND_UI.md, U17).
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );

  // The key is typed in, exactly as a site owner types the one `mallok
  // create` printed. A site with no setup key refuses to create an
  // administrator at all — that is the production default
  // (`docs/SECURITY.md §3.7`), and a suite that turned it off with
  // `MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY` would be exercising a configuration
  // nobody ships. The field is only rendered when the site asks for one, so
  // its presence is itself part of the assertion.
  await expect(page.getByLabel('Setup key')).toBeVisible();
  await page.getByLabel('Setup key').fill(SETUP_KEY);
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Step 2: the site --------------------------------------------------
  await expect(page.getByLabel('Site name')).toBeVisible();
  await page.getByLabel('Site name').fill('Titanium E2E');
  // Languages are chosen by name, the theme's own first (U16).
  await expect(page.getByLabel('Main language')).toHaveValue('en');
  await page.getByRole('checkbox', { name: 'Chinese (zh)' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Back from step 3 keeps what step 2 was given; back to step 1 says the
  // account exists rather than offering to make it again (U17).
  await expect(
    page.getByRole('heading', { name: 'Start with example content?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Site name')).toHaveValue('Titanium E2E');
  await expect(
    page.getByRole('checkbox', { name: 'Chinese (zh)' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('The administrator account,')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Step 3: the starter ----------------------------------------------
  await expect(
    page.getByRole('heading', { name: 'Start with example content?' }),
  ).toBeVisible();
  // The site's own starter is offered first and is the one preselected,
  // with what it brings said next to it.
  // Each option is a radio whose name carries everything said about it.
  const options = page.getByRole('radio');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveAccessibleName(
    /A shop this site brought/,
  );
  await expect(options.first()).toHaveAccessibleName(
    /1 page · 1 sample record/,
  );
  await expect(options.first()).toBeChecked();
  // The official one is what the rest of the suite expects to find.
  const official = page.getByRole('radio', {
    name: /Foreign-trade company site/,
  });
  await expect(official).not.toHaveAccessibleName(/sample records/);
  await official.check();
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
