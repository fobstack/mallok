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
  ['General', '/_mallok/app/settings'],
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
  // The group labels fade out as it collapses; scanned mid-fade, their
  // half-transparent text failed the contrast check now and then.
  await page.evaluate(
    'Promise.all(document.getAnimations().map((animation) => animation.finished))',
  );
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

test('the sidebar lists plugin panels and opens the public site', async ({
  page,
}) => {
  await signIn(page);
  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  // A plugin's list is a section of the site, between Media and Plugins
  // (docs/ADMIN_I18N_AND_UI.md, U3)…
  const inquiries = sidebar.getByRole('link', { name: 'Inquiries' });
  await inquiries.click();
  await expect(page).toHaveURL('/_mallok/app/plugins/inquiry/inquiries');
  await expect(inquiries).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inquiries');
  // …while a panel attached to a content kind stays in that kind's editor.
  await expect(
    sidebar.getByRole('link', { name: 'Product notes' }),
  ).toHaveCount(0);
  // The public site opens in a tab of its own.
  const site = sidebar.getByRole('link', { name: /^View site/ });
  await expect(site).toHaveAttribute('href', '/');
  await expect(site).toHaveAttribute('target', '_blank');
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
  await menu.getByRole('menuitem', { name: 'Account' }).click();
  await expect(page).toHaveURL('/_mallok/app/account');
});

test('every page starts beside the sidebar, and only a list reaches further', async ({
  page,
}) => {
  // A centred column left a band beside the sidebar on a wide window, and
  // moved the page's left edge from one page to the next
  // (docs/ADMIN_SIMPLE.md, D7).
  await page.setViewportSize({ width: 1920, height: 900 });
  await signIn(page);
  const edges: Record<string, { left: number; width: number }> = {};
  for (const [name, path] of [
    ['form', '/_mallok/app/settings'],
    ['list', '/_mallok/app/media'],
  ] as const) {
    await page.goto(path);
    const heading = page.getByRole('heading', { level: 1 }).first();
    await heading.waitFor();
    const column = page.locator('[data-page-width]').first();
    const box = await column.boundingBox();
    edges[name] = { left: box?.x ?? -1, width: box?.width ?? -1 };
  }
  const sidebar = await page
    .locator('[data-slot="sidebar-container"]')
    .first()
    .boundingBox();
  expect(edges.form?.left).toBe(edges.list?.left);
  // Beside the sidebar: its width plus the column's padding, nothing more.
  expect((edges.form?.left ?? 0) - (sidebar?.width ?? 0)).toBeLessThan(48);
  // A form stops at 56 rem, a list at 90; neither spans a 1920 px window.
  expect(edges.form?.width).toBeLessThan(edges.list?.width ?? 0);
  expect(edges.list?.width).toBeLessThanOrEqual(1440);
});
