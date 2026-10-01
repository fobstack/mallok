import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Reloading an admin route.
 *
 * A reload sends the validators of the cached response, and `wrangler dev`
 * gives the shell an ETag. The shell used to forward them to Static Assets,
 * got a 304 back, and answered "The admin app is not part of this build"
 * (src/worker/admin-app.ts). This reloads a deep route in a real browser
 * against the real Worker.
 */
test('a reload of an admin route shows the page again', async ({ page }) => {
  await signIn(page);
  await page.goto('/_mallok/app/account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();

  const reloaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/_mallok/app/account' &&
      response.request().method() === 'GET',
  );
  await page.reload();
  expect((await reloaded).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByText('not part of this build')).toHaveCount(0);
});
