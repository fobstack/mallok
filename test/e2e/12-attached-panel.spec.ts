import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * A plugin panel attached to the content editor (docs/PLUGIN_API.md §7.5).
 *
 * The test plugin attaches "Product notes" to products. Opened in a
 * product's editor, the panel lists that product's notes and no other's;
 * what is added there belongs to it.
 */
test("a product's editor shows the plugin's records for that product only", async ({
  page,
}) => {
  await signIn(page);

  // The catalog plugin has to be on; an earlier spec may have left it so.
  await page.goto('/_mallok/app/plugins');
  const card = page.locator('.plugin', { hasText: 'Catalog' });
  const power = card.locator('.switch');
  if ((await power.textContent())?.trim() !== 'On') {
    await power.getByRole('checkbox').click();
  }
  await expect(power).toHaveText('On');
  // On the plugins page an attached panel is pointed to, not listed.
  await expect(card).toContainText('Product notes is edited where it belongs');
  await expect(
    card.locator('.panel', { hasText: 'Product notes' }),
  ).toHaveCount(0);

  // Two different products of the starter, by id.
  const products = await page.evaluate(async () => {
    // One language only: two languages of one product share its records,
    // which is the point of keying them by translation group.
    const response = await fetch(
      '/_mallok/api/content?kind=product&locale=en&limit=5',
    );
    const body = (await response.json()) as {
      items: { id: string; title: string }[];
    };
    return body.items;
  });
  expect(products.length).toBeGreaterThan(1);
  const [first, second] = products as [
    { id: string; title: string },
    { id: string; title: string },
  ];

  await page.goto(`/_mallok/app/content/${first.id}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  const panel = page.locator('.attached-panel', { hasText: 'Product notes' });
  // Whether the item itself counts as edited must not change by adding a
  // record: the panel saves on its own.
  const unsavedBefore = await page
    .getByText('Unsaved', { exact: true })
    .count();
  await expect(panel).toContainText('From the Catalog plugin');
  await expect(panel.getByText('Nothing here yet.')).toBeVisible();

  await panel.getByRole('button', { name: 'New' }).click();
  const form = page.getByRole('dialog', { name: 'New: Product notes' });
  await form.getByLabel('Note').fill('Ships in 15 business days.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(panel.locator('tbody tr')).toHaveCount(1);
  await expect(panel.locator('tbody tr')).toContainText(
    'Ships in 15 business days.',
  );
  // The editor above still fills the window; the bar links down here.
  expect(await page.getByText('Unsaved', { exact: true }).count()).toBe(
    unsavedBefore,
  );
  await expect(
    page.locator('.editor-bar').getByRole('link', { name: /Product notes/ }),
  ).toHaveAttribute('href', '#attached-panels');
  const panes = await page.locator('.editor-panes').boundingBox();
  expect(panes?.height ?? 0).toBeGreaterThan(300);

  // Another product has none of it.
  await page.goto(`/_mallok/app/content/${second.id}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  const other = page.locator('.attached-panel', { hasText: 'Product notes' });
  await expect(other.getByText('Nothing here yet.')).toBeVisible();

  // And the first one still has it after a reload.
  await page.goto(`/_mallok/app/content/${first.id}`);
  await expect(
    page.locator('.attached-panel tbody tr', {
      hasText: 'Ships in 15 business days.',
    }),
  ).toBeVisible();

  // Content of a kind the panel is not for shows nothing.
  const pages = await page.evaluate(async () => {
    const response = await fetch('/_mallok/api/content?kind=page&limit=1');
    return ((await response.json()) as { items: { id: string }[] }).items;
  });
  await page.goto(`/_mallok/app/content/${pages[0]?.id}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.attached-panel')).toHaveCount(0);
});
