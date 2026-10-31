import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Light, dark or the system's, chosen in Account (docs/ADMIN_MIGRATION.md
 * §8). shadcn/ui's styles switch on a `.dark` class on `<html>`; what is
 * checked here is that the class follows the choice, that the choice
 * survives a reload, and that "system" really follows the system.
 */
test('the admin follows the system until told otherwise, and remembers it', async ({
  page,
}) => {
  const isDark = () =>
    page.evaluate("document.documentElement.classList.contains('dark')");

  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page);
  await page.goto('/_mallok/app/account');
  const appearance = page.getByRole('region', { name: 'Appearance' });
  await expect(
    appearance.getByRole('radio', { name: 'Same as the system' }),
  ).toBeChecked();
  expect(await isDark()).toBe(true);
  // A change of the system's scheme is followed while the choice is "system".
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(isDark).toBe(false);

  await appearance.getByRole('radio', { name: 'Dark' }).check();
  expect(await isDark()).toBe(true);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Appearance' }).getByRole('radio', {
      name: 'Dark',
    }),
  ).toBeChecked();
  expect(await isDark()).toBe(true);
  // Now chosen, it no longer follows the system.
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await isDark()).toBe(true);

  await page
    .getByRole('region', { name: 'Appearance' })
    .getByRole('radio', { name: 'Light' })
    .check();
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await isDark()).toBe(false);

  // Back to the system, which leaves nothing stored.
  await page
    .getByRole('region', { name: 'Appearance' })
    .getByRole('radio', { name: 'Same as the system' })
    .check();
  expect(await isDark()).toBe(true);
  expect(
    await page.evaluate("window.localStorage.getItem('mallok-admin-theme')"),
  ).toBeNull();
});
