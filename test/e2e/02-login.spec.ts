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
  await page.locator('#login-email').fill(ADMIN.email);
  await page.locator('#login-password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  // Telling an attacker that the address exists is a free account enumeration.
  await expect(error).not.toContainText(ADMIN.email);
  await expect(page.locator('#login-password')).toBeVisible();
});

test('signs in and reaches the content list', async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible();
  // The starter's pages are there, so this is the real list and not an empty
  // shell that happens to render.
  await expect(page.getByRole('row').first()).toBeVisible();
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
  // The button lives in the shell header, on every admin page.
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.locator('#login-password')).toBeVisible();
  const listing = await page.request.get('/_mallok/api/content', {
    failOnStatusCode: false,
  });
  expect(listing.status()).toBe(401);
});
