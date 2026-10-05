import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Settings → Email (docs/ADMIN.md §4).
 *
 * The Resend key and the sender are entered once for the whole site. This
 * walks the real page against the real Worker; the "Test" button is left
 * alone because it would call Resend for real.
 */
// Not shaped like a real credential, so the secret scanner stays meaningful.
const KEY = 'fixture-not-a-credential-email-page';

test('the site sender and Resend key are saved once and the key is never shown', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/_mallok/app/settings');
  await page.getByRole('link', { name: 'Email' }).click();
  await expect(page.getByRole('heading', { name: 'Email' })).toBeVisible();

  // A sender that is not an address is refused before any request.
  await page.locator('#email-from').fill('not an address');
  await page.getByRole('button', { name: 'Save sender' }).click();
  await expect(page.getByRole('alert')).toContainText('hello@example.com');

  await page.locator('#email-from').fill('Acme <hello@example.com>');
  await page.getByRole('button', { name: 'Save sender' }).click();
  await expect(page.locator('form .pill.ok')).toHaveText('Saved');

  const key = page.getByLabel('Resend API key', { exact: true });
  await key.fill(KEY);
  const stored = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/settings/email') &&
      response.request().method() === 'PUT',
  );
  await page
    .locator('#email-resend-key')
    .getByRole('button', { name: 'Save' })
    .click();
  const response = await stored;
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain(KEY);
  await expect(page.locator('#email-resend-key .pill.ok')).toHaveText('Set');
  await expect(page.getByRole('button', { name: 'Test' })).toBeVisible();

  // After a reload everything on the page comes from the server.
  await page.reload();
  await expect(page.locator('#email-from')).toHaveValue(
    'Acme <hello@example.com>',
  );
  await expect(page.locator('#email-resend-key .pill.ok')).toHaveText('Set');
  expect(await page.content()).not.toContain(KEY);

  // Diagnostics reads the same setting.
  await page.getByRole('link', { name: 'Advanced' }).click();
  await expect(
    page.locator('.facts div', { hasText: 'Email (Resend)' }),
  ).toContainText('Configured');

  // Removing the key brings the empty field back and says what that means.
  await page.getByRole('link', { name: 'Email' }).click();
  await page
    .locator('#email-resend-key')
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(
    page.getByLabel('Resend API key', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.warning-line')).toContainText('no email is sent');
});
