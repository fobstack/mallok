import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Revoking an API token (docs/ADMIN.md §12).
 *
 * The list keeps revoked tokens as history, and used to show them exactly
 * like live ones: the Revoke button stayed, a second click got a 404 nobody
 * reported, and revoking looked like a button that did nothing. This walks
 * the real page against the real Worker.
 */
test('a revoked token is shown as revoked and offers no Revoke', async ({
  page,
}) => {
  const name = `e2e-revoke-${Date.now()}`;
  await signIn(page);
  await page.goto('/_mallok/app/account');

  await page.locator('#token-name').fill(name);
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.locator('.token-reveal code')).toContainText('mlk_live_');
  await page.getByRole('button', { name: 'Done' }).click();

  const row = page.locator('.rows li', { hasText: name });
  await expect(row).toContainText('Never used');
  const revoked = page.waitForResponse(
    (response) =>
      response.url().includes('/_mallok/api/tokens/') &&
      response.request().method() === 'DELETE',
  );
  await row.getByRole('button', { name: 'Revoke' }).click();
  expect((await revoked).status()).toBe(200);

  // The list is fetched again after the DELETE, so this state is the
  // server's `revokedAt`, not a local flag.
  await expect(row).toContainText(/Revoked \d{4}-\d{2}-\d{2}/);
  await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
  await expect(row).toHaveClass(/revoked/);
});
