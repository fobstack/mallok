import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * The editor's layout (docs/ADMIN_I18N_AND_UI.md, U7–U9, and
 * docs/ADMIN_SIMPLE.md, D4–D6): writing first — the title, the text with
 * its toolbar, the type's fields as cards — with one settings panel beside
 * it that closes and is remembered, the preview a button away, and on a
 * phone one column with the save buttons on screen.
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

test('on a wide screen the editor fills the window, writing first', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await openPublished(page);

  // Wider than any other page's column, which stops at 90 rem (U7, D7).
  const editor = page.getByRole('region', { name: 'Editor' });
  expect((await editor.boundingBox())?.width ?? 0).toBeGreaterThan(1100);

  // The item's state, and a way to see it (U8).
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Updated /)).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View on site' }).first(),
  ).toHaveAttribute('href', '/about');

  // The title, the text and its toolbar; no front matter in sight (D4).
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toHaveValue('About the mill');
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Text' })).not.toContainText(
    'title:',
  );
  await expect(
    page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button'),
  ).toHaveCount(9);
  // Publishing, summary and the address live in the panel.
  const panel = page.getByRole('complementary', { name: 'Page settings' });
  await expect(panel.getByLabel('Summary')).toBeVisible();
  await expect(panel.getByLabel('Publish date')).toBeVisible();
  await clean(page, 'editor, writing');

  await page.getByRole('button', { name: 'Hide settings' }).click();
  await expect(panel).toBeHidden();
  // Remembered by this browser.
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Show settings' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show settings' }).click();
  await expect(panel).toBeVisible();

  // The preview is the page as visitors get it, a button away.
  await expect(page.getByTitle('Preview')).toBeHidden();
  await page.getByRole('button', { name: 'Preview' }).first().click();
  await expect(page.getByTitle('Preview')).toBeVisible();
  await clean(page, 'editor, preview');
});

test('on a phone the editor is one column and the save buttons stay on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openPublished(page);

  // A published item's primary button is "Update" (G1, D6); on a phone the
  // one in the bar pinned to the bottom is the one shown.
  const update = page.getByRole('button', { name: 'Update' }).last();
  await expect(update).toBeInViewport();
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toBeInViewport();
  await clean(page, 'editor on a phone');

  await page.getByRole('button', { name: 'Preview' }).last().click();
  await expect(page.getByTitle('Preview')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Preview' }).last().click();
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeVisible();
  // Scrolled through the text, the buttons are still there (U9).
  await page.mouse.wheel(0, 2000);
  await expect(update).toBeInViewport();
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);
});
