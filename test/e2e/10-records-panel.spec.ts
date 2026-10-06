import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * A plugin's editable records panel (docs/PLUGIN_API.md §7.5), in a browser.
 *
 * The plugin under test (`test/fixtures/catalog-plugin.ts`) ships no
 * interface: everything clicked here was built by the admin from the fields
 * the plugin declares, and every write went through the plugin's handlers.
 */
/** The required price field; its label carries the `*` marker. */
const PRICE = '#record-catalog-items-price';

test('records are created, edited, sorted, searched and deleted from the declared form', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/_mallok/app/plugins');

  const card = page.locator('.plugin', { hasText: 'Catalog' });
  // The switch shows the server's state, which arrives after the request:
  // click it and wait, rather than asking Playwright to "check" it.
  const power = card.locator('.switch');
  if ((await power.textContent())?.trim() !== 'On') {
    await power.getByRole('checkbox').click();
  }
  await expect(power).toHaveText('On');
  const panel = card.locator('.panel', { hasText: 'Catalog items' });
  await expect(panel.getByText('Nothing here yet.')).toBeVisible();

  // --- create, with a validation error first ------------------------------
  await panel.getByRole('button', { name: 'New' }).click();
  const form = page.getByRole('dialog', { name: 'New: Catalog items' });
  await form.getByLabel('Name').fill('Grade 5 bar');
  await form.getByLabel('Status').selectOption('active');
  await form.locator(PRICE).fill('99.5');
  await form.getByRole('button', { name: 'Save' }).click();
  // `Code` is required: the message sits on that field, and nothing closed.
  await expect(
    form.locator('.field', { hasText: 'Code' }).getByRole('alert'),
  ).toHaveText('This field is required.');

  await form.getByLabel('Code').fill('TI-BAR');
  // A repeatable group: add two rows, fill them, remove the first.
  await form.getByRole('button', { name: 'Add a row' }).click();
  await form.getByRole('button', { name: 'Add a row' }).click();
  const first = form.getByRole('group', { name: 'Variants 1' });
  const second = form.getByRole('group', { name: 'Variants 2' });
  await first.getByLabel('SKU').fill('WRONG');
  await second.getByLabel('SKU').fill('TI-BAR-20');
  await second.getByLabel('Stock').fill('4');
  await second.getByLabel('Variant price', { exact: true }).fill('120');
  await second.getByLabel('Variant price: currency').selectOption('EUR');
  await form.getByRole('button', { name: 'Remove variants 1' }).click();
  await expect(form.getByRole('group', { name: 'Variants 2' })).toHaveCount(0);
  // What was typed in the row that stayed is still in it.
  await expect(
    form.getByRole('group', { name: 'Variants 1' }).getByLabel('SKU'),
  ).toHaveValue('TI-BAR-20');

  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  const row = panel.locator('tbody tr', { hasText: 'Grade 5 bar' });
  // 99.5 was entered; the plugin stored 9950 minor units and printed them.
  await expect(row).toContainText('USD 99.50');

  // --- edit: the form comes back as it was saved ---------------------------
  await row.getByRole('button', { name: 'Edit Grade 5 bar' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit: Catalog items' });
  await expect(edit.locator(PRICE)).toHaveValue('99.50');
  const variant = edit.getByRole('group', { name: 'Variants 1' });
  await expect(variant.getByLabel('SKU')).toHaveValue('TI-BAR-20');
  await expect(variant.getByLabel('Stock')).toHaveValue('4');
  await expect(
    variant.getByLabel('Variant price', { exact: true }),
  ).toHaveValue('120.00');
  await expect(variant.getByLabel('Variant price: currency')).toHaveValue(
    'EUR',
  );
  await edit.getByLabel('Name').fill('Alpha bar');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toHaveCount(0);
  await expect(panel.locator('tbody tr')).toHaveCount(1);
  await expect(panel.locator('tbody tr')).toContainText('Alpha bar');

  // --- the plugin's own refusal lands on the field it names ---------------
  await panel.getByRole('button', { name: 'New' }).click();
  const second2 = page.getByRole('dialog', { name: 'New: Catalog items' });
  await second2.getByLabel('Name').fill('Zulu plate');
  await second2.getByLabel('Code').fill('TI-BAR');
  await second2.getByLabel('Status').selectOption('archived');
  await second2.locator(PRICE).fill('10');
  await second2.getByRole('button', { name: 'Save' }).click();
  await expect(
    second2.locator('.field', { hasText: 'Code' }).getByRole('alert'),
  ).toHaveText('Another item already uses this code.');
  await second2.getByLabel('Code').fill('ZU-PLATE');
  await second2.getByRole('button', { name: 'Save' }).click();
  await expect(second2).toHaveCount(0);
  await expect(panel.locator('tbody tr')).toHaveCount(2);

  // --- sorting and search --------------------------------------------------
  const names = () =>
    panel.locator('tbody tr td:nth-child(2)').allTextContents();
  await panel.getByRole('button', { name: /^Name/ }).click();
  await expect.poll(names).toEqual(['Alpha bar', 'Zulu plate']);
  await expect(
    panel.getByRole('columnheader', { name: /^Name/ }),
  ).toHaveAttribute('aria-sort', 'ascending');
  await panel.getByRole('button', { name: /^Name/ }).click();
  await expect.poll(names).toEqual(['Zulu plate', 'Alpha bar']);

  await panel.getByLabel('Search').fill('zu-');
  await expect.poll(names).toEqual(['Zulu plate']);
  await panel.getByLabel('Search').fill('');
  await expect.poll(names).toEqual(['Zulu plate', 'Alpha bar']);

  // --- an action that asks for something first ----------------------------
  const alpha = panel.locator('tbody tr', { hasText: 'Alpha bar' });
  await alpha.getByRole('checkbox').check();
  await panel.getByRole('button', { name: 'Set status' }).click();
  const ask = page.getByRole('dialog', { name: 'Set status' });
  await expect(ask).toContainText('Applies to 1 selected row.');
  // Nothing chosen yet: the server checks the declaration and the message
  // lands on the field.
  await ask.getByLabel('Reason').fill('discontinued');
  await ask.getByRole('button', { name: 'Set status' }).click();
  await expect(
    ask.locator('.field', { hasText: 'New status' }).getByRole('alert'),
  ).toHaveText('This field is required.');
  await ask.getByLabel('New status').selectOption('archived');
  await ask.getByRole('button', { name: 'Set status' }).click();
  await expect(ask).toHaveCount(0);
  await expect(alpha.locator('.pill')).toHaveText('archived');

  // --- related rows: the variants of the record that is open --------------
  await alpha.getByRole('button', { name: 'Edit Alpha bar' }).click();
  const related = page
    .getByRole('dialog', { name: 'Edit: Catalog items' })
    .getByRole('region', { name: 'Variants' });
  await expect(related.locator('tbody tr')).toHaveCount(1);
  await expect(related.locator('tbody tr')).toContainText('TI-BAR-20');
  await page
    .getByRole('dialog', { name: 'Edit: Catalog items' })
    .getByRole('button', { name: 'Close' })
    .click();

  // --- delete, which asks first -------------------------------------------
  await panel.getByRole('button', { name: 'Edit Zulu plate' }).click();
  const doomed = page.getByRole('dialog', { name: 'Edit: Catalog items' });
  await doomed.getByRole('button', { name: 'Delete…' }).click();
  await doomed.getByRole('button', { name: 'Delete it' }).click();
  await expect(doomed).toHaveCount(0);
  await expect.poll(names).toEqual(['Alpha bar']);

  // A panel whose plugin gave no `remove` offers no delete at all.
  const log = card.locator('.panel', { hasText: 'Catalog log' });
  await log.getByRole('button', { name: 'New' }).click();
  const note = page.getByRole('dialog', { name: 'New: Catalog log' });
  await note.getByLabel('Note').fill('first entry');
  await note.getByRole('button', { name: 'Save' }).click();
  // The action above left a line of its own in this log; open ours.
  await log.getByRole('button', { name: 'Edit first entry' }).click();
  const opened = page.getByRole('dialog', { name: 'Edit: Catalog log' });
  await expect(opened.getByLabel('Note')).toHaveValue('first entry');
  await expect(opened.getByRole('button', { name: 'Delete…' })).toHaveCount(0);
});
