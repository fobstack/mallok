import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * The shell (docs/ADMIN_MIGRATION.md, phase 2): every section is reachable
 * from the sidebar by keyboard, and the sidebar passes the accessibility
 * gate open, collapsed to icons, and as a sheet on a phone.
 */

/** Fails on any serious or critical WCAG 2.1 AA violation. */
async function clean(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations
    .filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    )
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
  expect(blocking, label).toEqual([]);
}

const SECTIONS = [
  ['Content', '/_mallok/app/'],
  ['Media', '/_mallok/app/media'],
  ['Plugins', '/_mallok/app/plugins'],
  ['Site', '/_mallok/app/settings'],
  ['Appearance', '/_mallok/app/settings/appearance'],
  ['Email', '/_mallok/app/settings/email'],
  ['Advanced', '/_mallok/app/settings/advanced'],
] as const;

test('every section is reachable from the sidebar with the keyboard', async ({
  page,
}) => {
  await signIn(page);
  for (const [name, path] of SECTIONS) {
    const link = page
      .getByRole('navigation')
      .or(page.locator('[data-sidebar="sidebar"]'))
      .first()
      .getByRole('link', { name, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(path);
    await expect(link).toHaveAttribute('aria-current', 'page');
  }
});

test('the sidebar passes the accessibility gate open, collapsed and on a phone', async ({
  page,
}) => {
  await signIn(page);
  await clean(page, 'sidebar open');

  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await expect(page.locator('[data-state="collapsed"]').first()).toBeVisible();
  await clean(page, 'sidebar collapsed');
  // Collapsed to icons, the links keep their names.
  await expect(
    page.getByRole('link', { name: 'Plugins', exact: true }),
  ).toHaveCount(1);
  // And it stays collapsed after a reload, kept in this browser only: no
  // cookie, which would make the operator's own visits to the site skip the
  // shared cache.
  await page.reload();
  await expect(page.locator('[data-state="collapsed"]').first()).toBeVisible();
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.includes('sidebar'),
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();

  await page.setViewportSize({ width: 375, height: 760 });
  await page.reload();
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  const sheet = page.getByRole('dialog');
  await expect(
    sheet.getByRole('link', { name: 'Plugins', exact: true }),
  ).toBeVisible();
  // Scanned once it has finished sliding in: half-faded text is not what
  // anyone reads.
  // As a string: this file is type-checked without the DOM library.
  await page.evaluate(
    'Promise.all(document.getAnimations().map((animation) => animation.finished))',
  );
  await clean(page, 'sidebar as a sheet');
  await sheet.getByRole('link', { name: 'Plugins', exact: true }).click();
  await expect(page).toHaveURL('/_mallok/app/plugins');
});

test('the account menu opens from the keyboard and offers the account page', async ({
  page,
}) => {
  await signIn(page);
  const trigger = page.getByRole('button', { name: 'Account menu' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await clean(page, 'account menu open');
  await menu.getByRole('menuitem', { name: 'Account and API tokens' }).click();
  await expect(page).toHaveURL('/_mallok/app/account');
});
