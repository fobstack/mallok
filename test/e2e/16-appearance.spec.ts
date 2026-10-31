import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Light, dark or the system's, chosen in the account menu
 * (docs/ADMIN_MIGRATION.md §8). shadcn/ui's styles switch on a `.dark` class
 * on `<html>`; what is checked here is that the class follows the choice,
 * that the choice survives a reload, and that "system" really follows the
 * system.
 */

/** Opens the account menu and picks a colour scheme. */
async function choose(page: Page, scheme: string): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitemradio', { name: scheme }).click();
  // Wait for the menu to finish closing: a click on the trigger while it is
  // still fading out counts as a click outside it.
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Opens the account menu and reads which scheme is checked. */
async function chosen(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Account menu' }).click();
  const name =
    (await page.getByRole('menuitemradio', { checked: true }).textContent()) ??
    '';
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  return name.trim();
}

test('the admin follows the system until told otherwise, and remembers it', async ({
  page,
}) => {
  const isDark = () =>
    page.evaluate("document.documentElement.classList.contains('dark')");

  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page);
  expect(await chosen(page)).toBe('Same as the system');
  expect(await isDark()).toBe(true);
  // A change of the system's scheme is followed while the choice is "system".
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(isDark).toBe(false);

  await choose(page, 'Dark');
  expect(await isDark()).toBe(true);
  await page.reload();
  expect(await chosen(page)).toBe('Dark');
  expect(await isDark()).toBe(true);
  // Now chosen, it no longer follows the system.
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await isDark()).toBe(true);

  await choose(page, 'Light');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await isDark()).toBe(false);

  // Back to the system, which leaves nothing stored.
  await choose(page, 'Same as the system');
  expect(await isDark()).toBe(true);
  expect(
    await page.evaluate("window.localStorage.getItem('mallok-admin-theme')"),
  ).toBeNull();
});
