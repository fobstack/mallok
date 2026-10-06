import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * A tagline per language, in Settings → Site (docs/ADMIN.md §10).
 *
 * The site the wizard made has English and Chinese. The default language's
 * tagline is the one field there always was; each further language gets a
 * field of its own under it.
 */
test('a further language gets its own tagline field, and it is kept', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/_mallok/app/settings');
  const main = page.getByLabel('Tagline', { exact: true });
  const chinese = page.getByLabel('Tagline (zh)', { exact: true });
  await expect(chinese).toBeVisible();
  await expect(chinese).toHaveValue('');
  const before = await main.inputValue();

  await chinese.fill('钛材，按图加工');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/settings') &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save' }).first().click();
  expect((await saved).status()).toBe(200);

  // After a reload both come from the server: the map, taken apart again.
  await page.reload();
  await expect(page.getByLabel('Tagline (zh)', { exact: true })).toHaveValue(
    '钛材，按图加工',
  );
  await expect(page.getByLabel('Tagline', { exact: true })).toHaveValue(before);

  // Emptying it goes back to one tagline for every language.
  await page.getByLabel('Tagline (zh)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save' }).first().click();
  // The note says when visitors will see it, not that it is live.
  await expect(page.getByText(/^Saved — /)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Tagline (zh)', { exact: true })).toHaveValue(
    '',
  );
  await expect(page.getByLabel('Tagline', { exact: true })).toHaveValue(before);
});
