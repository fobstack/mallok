import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

interface Stored {
  readonly kind: string;
  readonly locale: string;
  readonly translationGroup: string;
}

/**
 * Reads an item through the page's own session: the request context does
 * not carry the browser's session cookie.
 */
async function read(page: Page, id: string): Promise<Stored> {
  return (await page.evaluate(
    `fetch('/_mallok/api/content/${id}').then((response) => response.json())`,
  )) as Stored;
}

/**
 * Creating a translation from the editor's language bar (docs/ADMIN.md §6).
 *
 * "Create Chinese (zh)" opens a new item in that language and the original's
 * translation group, carried in the address. The editor used to take the
 * query for part of the item id: it never opened a new item, and Publish
 * saved in the original's language, over the original.
 */
test('a translation made from the language bar joins the original', async ({
  page,
}) => {
  await signIn(page);
  // An English page of its own: the starter's pages already have their
  // Chinese versions.
  const stamp = Date.now();
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('combobox', { name: /^Type/ }).selectOption('page');
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Our mill');
  await page.getByLabel('URL slug', { exact: true }).fill(`our-mill-${stamp}`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page).toHaveURL(/\/content\/(?!new)[^/?]+$/);
  const original = page.url().split('/content/')[1] ?? '';
  const stored = await read(page, original);

  await page
    .getByRole('navigation', { name: 'Translations' })
    // Named, with the code, since U10.
    .getByRole('button', { name: 'Create Chinese (zh)' })
    .click();
  await expect(page).toHaveURL(/\/content\/new\?locale=zh&/);
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Type/ })).toHaveValue(
    stored.kind,
  );

  const slug = `our-mill-zh-${stamp}`;
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('关于工厂');
  await page.getByLabel('URL slug', { exact: true }).fill(slug);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/content') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Publish' }).click();
  const response = await saved;
  expect(response.status()).toBeLessThan(300);
  const created = (await response.json()) as { id: string };

  const translation = await read(page, created.id);
  expect(translation.locale).toBe('zh');
  expect(translation.translationGroup).toBe(stored.translationGroup);

  // The editor is now on the new item, and its bar leads back.
  await expect(page).toHaveURL(new RegExp(`/content/${created.id}$`));
  await expect(
    page
      .getByRole('navigation', { name: 'Translations' })
      .getByRole('button', { name: 'English (en)' }),
  ).toBeVisible();
});
