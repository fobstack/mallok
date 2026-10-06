import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * A job that ran out of attempts is something the operator can see
 * (docs/PLUGIN_API.md §7.4, docs/ADMIN.md §10).
 *
 * The plugin under test (`test/fixtures/catalog-plugin.ts`) queues a job
 * through `ctx.enqueue` and then marks it as having failed five times, which
 * in real time takes half an hour.
 */
test('a job that gave up is listed in diagnostics with its last error', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/_mallok/app/plugins');

  const card = page.locator('.plugin', { hasText: 'Catalog' });
  const power = card.locator('.switch');
  if ((await power.textContent())?.trim() !== 'On') {
    await power.getByRole('checkbox').click();
  }
  await expect(power).toHaveText('On');
  const panel = card.locator('.panel', { hasText: 'Catalog items' });

  await panel.getByRole('button', { name: 'New' }).click();
  const form = page.getByRole('dialog', { name: 'New: Catalog items' });
  await form.getByLabel('Name').fill('Parcel');
  await form.getByLabel('Code').fill('PARCEL');
  await form.getByLabel('Status').selectOption('active');
  await form.locator('#record-catalog-items-price').fill('1');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  const row = panel.locator('tbody tr', { hasText: 'Parcel' });
  await row.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Ship' }).click();
  // The action ran: the selection is cleared when it returns.
  await expect(row.getByRole('checkbox')).not.toBeChecked();

  await page.goto('/_mallok/app/settings/advanced');
  const failed = page.locator('section.card', {
    hasText: 'Failed background jobs',
  });
  const entry = failed.locator('li', { hasText: 'plugin:catalog:ship' });
  await expect(entry).toContainText('The carrier refused the parcel.');
});
