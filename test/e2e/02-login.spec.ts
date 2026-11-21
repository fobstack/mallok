import { expect, test } from '@playwright/test';
import { ADMIN, signIn } from './credentials.js';

/**
 * Signing in (docs/ADMIN.md §4, docs/SECURITY.md §3).
 *
 * The account here is the one the wizard created in `01-wizard.spec.ts`.
 */

test('refuses the wrong password without saying which half was wrong', async ({
  page,
}) => {
  await page.goto('/_mallok/app/');
  await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  // Telling an attacker that the address exists is a free account enumeration.
  await expect(error).not.toContainText(ADMIN.email);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

test('signs in and reaches the overview', async ({ page }) => {
  await signIn(page);

  // Overview, the first screen (docs/ADMIN_SIMPLE.md, D1).
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  // The starter's pages are there, so this is the real list of recent work
  // and not an empty shell that happens to render.
  await expect(
    page
      .getByRole('region', { name: 'Recently edited' })
      .getByRole('listitem')
      .first(),
  ).toBeVisible();
});

test('keeps the admin behind the session, not behind the interface', async ({
  request,
}) => {
  // A fresh context with no cookie. The SPA shell may be public — it is a
  // static asset — but nothing it reads may be.
  const listing = await request.get('/_mallok/api/content', {
    failOnStatusCode: false,
  });
  expect(listing.status()).toBe(401);
});

test('signs out and stops accepting the old session', async ({ page }) => {
  await signIn(page);
  // Signing out is in the account menu at the foot of the sidebar, on every
  // admin page (it was a button in the old top bar).
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  const listing = await page.request.get('/_mallok/api/content', {
    failOnStatusCode: false,
  });
  expect(listing.status()).toBe(401);
});
