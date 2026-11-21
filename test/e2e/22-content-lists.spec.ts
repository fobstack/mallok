import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * A content type's list, as mainstream admins have it
 * (docs/ADMIN_SIMPLE.md, D2, D3 and D8): one sidebar entry per type, status
 * and language as tabs, a search by title, and a row's address in its menu
 * rather than in a column.
 */

test('a type has its own list, with tabs, search and a row menu', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  const sidebar = page.locator('[data-sidebar="sidebar"]');
  await sidebar.getByRole('link', { name: 'Product', exact: true }).click();

  await expect(page).toHaveURL(/\/_mallok\/app\/content\?kind=product$/);
  await expect(
    sidebar.getByRole('link', { name: 'Product', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Product' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Product' })).toBeVisible();
  // Inside one type's list neither the type nor the address is a column.
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: 'Type' })).toHaveCount(
    0,
  );
  await expect(table.getByRole('columnheader', { name: 'Path' })).toHaveCount(
    0,
  );
  await expect(
    table.getByRole('columnheader', { name: 'Last edited' }),
  ).toBeVisible();
  await expect(
    table.getByRole('link', { name: 'Grade 5 titanium bar' }),
  ).toBeVisible();

  // Search narrows by title, and the address keeps it.
  await page
    .getByRole('searchbox', { name: 'Search by title' })
    .fill('grade 5');
  await expect(page).toHaveURL(/q=grade\+5/);
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(
    table.getByRole('link', { name: 'Grade 5 titanium bar' }),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search by title' }).fill('');
  await expect(page).not.toHaveURL(/q=/);

  // Status is a row of tabs; the starter has no drafts.
  const status = page.getByRole('group', { name: 'Status' });
  await status.getByRole('button', { name: 'Draft' }).click();
  await expect(status.getByRole('button', { name: 'Draft' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(/matches these filters/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\?kind=product$/);

  // The language by its name, without its code (D8).
  const languages = page.getByRole('group', { name: 'Language' });
  await expect(
    languages.getByRole('button', { name: 'English' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await languages.getByRole('button', { name: 'Chinese' }).click();
  await expect(page).toHaveURL(/locale=zh/);
  await languages.getByRole('button', { name: 'English' }).click();

  // A row's menu: edit, view, and the address to paste somewhere.
  await page
    .getByRole('button', { name: 'Actions for Grade 5 titanium bar' })
    .click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'View on site' }),
  ).toHaveAttribute('href', '/products/grade-5-titanium-bar');
  await menu.getByRole('menuitem', { name: 'Copy address' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Copied' }),
  ).toContainText('/products/grade-5-titanium-bar');

  // The editor knows the list it came from.
  await table.getByRole('link', { name: 'Grade 5 titanium bar' }).click();
  await expect(page).toHaveURL(/\/content\/[^/?]+\?kind=product$/);
  await expect(
    sidebar.getByRole('link', { name: 'Product', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '← Product' }).click();
  await expect(page).toHaveURL(/\/content\?kind=product$/);
});

test('a row is unpublished or deleted from its menu, after a question', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/_mallok/app/content?kind=page');
  await page.getByRole('button', { name: 'Add Page' }).click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Short-lived page');
  await page.getByLabel('URL slug', { exact: true }).fill('short-lived');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/content') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Publish' }).click();
  expect((await saved).status()).toBeLessThan(300);
  await page.getByRole('button', { name: '← Page' }).click();

  const row = page.getByRole('row').filter({ hasText: 'Short-lived page' });
  // The status column; the phone layout repeats it under the title.
  await expect(row.getByText('Published').last()).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('button', { name: 'Actions for Short-lived page' })
    .click();
  await page.getByRole('menuitem', { name: 'Unpublish' }).click();
  await expect(row.getByText('Draft').last()).toBeVisible();

  // Declining the delete keeps the row.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page
    .getByRole('button', { name: 'Actions for Short-lived page' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(row).toHaveCount(1);

  page.once('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('button', { name: 'Actions for Short-lived page' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
});
