import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Removing a plugin secret (docs/ADMIN.md §10).
 *
 * The field mirrored "is one stored" in its own state and never looked again,
 * so after Remove it went on showing "Set" with Replace and Remove until the
 * page was reloaded — the secret was gone and the page said it was not.
 */
// Not shaped like a real credential, so the secret scanner stays meaningful.
const VALUE = 'fixture-not-a-credential-plugin-secret';

test('a removed plugin secret is shown as not set without a reload', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/_mallok/app/plugins');

  const control = page.getByRole('group', { name: 'Turnstile secret key' });
  await control.getByLabel('Turnstile secret key').fill(VALUE);
  await control.getByRole('button', { name: 'Save' }).click();
  await expect(control.getByText('Set', { exact: true })).toHaveText('Set');

  const removed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/plugins/inquiry/secrets') &&
      response.request().method() === 'PUT',
  );
  await control.getByRole('button', { name: 'Remove' }).click();
  expect((await removed).status()).toBe(200);

  await expect(control.getByLabel('Turnstile secret key')).toBeVisible();
  await expect(control.getByText('Set', { exact: true })).toHaveCount(0);
  await expect(control.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});
