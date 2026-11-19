import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * The editor's layout (docs/ADMIN_I18N_AND_UI.md, U7–U9): it takes the
 * window's width and its field pane folds to a rail; the bar says what
 * state the item is in; on a phone one pane is shown at a time and the
 * save buttons stay on screen.
 */

/** Fails on any serious or critical WCAG 2.1 AA violation. */
async function clean(page: Page, label: string): Promise<void> {
  // axe cannot run inside the script-free preview frame and waits on it
  // until the test times out; 05-accessibility checks the frame itself.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('iframe[title="Preview"]')
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

/** Opens the starter's "About the mill" page, which is published. */
async function openPublished(page: Page): Promise<void> {
  await page.goto('/_mallok/app/');
  await page.getByRole('link', { name: 'About the mill' }).first().click();
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toBeVisible();
}

test('on a wide screen the editor fills the window and its fields fold', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await openPublished(page);

  // Wider than the 68 rem column every other page keeps (U7).
  const panes = page.getByRole('region', {
    name: 'Fields, Markdown and preview',
  });
  expect((await panes.boundingBox())?.width ?? 0).toBeGreaterThan(1100);

  // The item's state, and a way to see it (U8).
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Updated /)).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View on site' }),
  ).toHaveAttribute('href', '/about');

  await page.getByRole('button', { name: 'Hide fields' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toBeHidden();
  // Remembered by this browser.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show fields' })).toBeVisible();
  await clean(page, 'editor, fields folded');
  await page.getByRole('button', { name: 'Show fields' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toBeVisible();
});

test('on a phone one pane is shown and the save buttons stay on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openPublished(page);

  const publish = page.getByRole('button', { name: 'Publish' });
  await expect(publish).toBeInViewport();
  await clean(page, 'editor on a phone, fields');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toBeHidden();
  await expect(page.getByTitle('Preview')).toBeVisible();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.getByTitle('Preview')).toBeHidden();
  await expect(page.locator('.cm-content')).toBeVisible();
  // Scrolled through the text, the buttons are still there (U9).
  await page.mouse.wheel(0, 2000);
  await expect(publish).toBeInViewport();
  await clean(page, 'editor on a phone, writing');
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);
});
