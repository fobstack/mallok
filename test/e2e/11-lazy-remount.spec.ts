import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * A part of the admin that loads on demand, opened a second time.
 *
 * `lazyRoute` kept the loaded component in `useState(cached)`. React treats
 * a function given to `useState` as an initialiser and **calls it** — so the
 * second time a lazy route mounted, its component was invoked with no props
 * from inside `useState`, threw, and took the whole admin with it: a blank
 * page. The first mount was fine, because nothing was cached yet, which is
 * why opening one item never showed it.
 */
test('the editor opens for a second item in the same session', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await signIn(page);
  await page.goto('/_mallok/app/');
  const links = page.locator('a[href^="/_mallok/app/content/"]');
  // The list arrives after the page does.
  await expect(links.nth(1)).toBeVisible();

  await links.nth(0).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  const first = page.url();

  // Back to the list without a reload, then a different item: the editor
  // route mounts again with its code already loaded.
  await page.getByRole('link', { name: 'Content' }).first().click();
  await expect(links.nth(1)).toBeVisible();
  await links.nth(1).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(page.url()).not.toBe(first);
  expect(errors).toEqual([]);
});
