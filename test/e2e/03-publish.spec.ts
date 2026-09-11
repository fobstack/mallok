import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * The publish loop (`AC-CONTENT-01`, docs/ADMIN.md §6).
 *
 * The product's central promise is that editing content takes effect without
 * a build or a deploy (docs/PRODUCT_VISION.md §3). This walks it: write a
 * page in the admin, publish it, read it on the public site, edit it, and see
 * the edit. Nothing here stubs the Worker — the page is rendered by the same
 * code a deployed site runs.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'End to end test page';
const SLUG = 'end-to-end-test-page';
const BODY = 'The first body text, written by the end-to-end test.';
const EDITED = 'The second body text, after an edit.';

/**
 * Clicks a save button and waits for the server to have accepted the save.
 *
 * Waiting for the button to become enabled again is not enough — it never
 * disables long enough to observe, so the next `goto` cancelled a request
 * that was still in flight and the page really was not there yet.
 */
async function saveWith(
  page: Page,
  name: 'Publish' | 'Save draft',
): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/_mallok/api/content') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBeLessThan(400);
}

/**
 * Appends body text at the end of the Markdown pane.
 *
 * The pane holds the **whole document**, front matter included — the fields
 * form and the source are two views of one text (docs/ADMIN.md §6.1). A
 * select-all here therefore selects the `---` block too, and typing over it
 * deletes the title the form just wrote. So this moves to the end and types.
 */
async function appendBody(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await expect(page.locator('.cm-editor.cm-focused')).toBeVisible();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially(`\n\n${text}`);
}

/** Replaces the whole document, front matter and all. */
async function rewriteDocument(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await expect(page.locator('.cm-editor.cm-focused')).toBeVisible();
  await editor.press('ControlOrMeta+a');
  await editor.pressSequentially(text);
}

test('writes and publishes a page that is immediately public', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'New' }).click();

  // `page` is one of the two kinds the core always has (docs/ARCHITECTURE §8).
  await page.locator('.editor-bar select').selectOption('page');
  await page.locator('#fm-title').fill(TITLE);
  await page.locator('.editor-bar input').fill(SLUG);
  await appendBody(page, BODY);

  await saveWith(page, 'Publish');

  // No build, no deploy, no cache to wait for: the page is there now.
  const response = await page.goto(`/${SLUG}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).toContainText(BODY);
  await expect(page).toHaveTitle(new RegExp(TITLE));
});

test('shows an edit on the public page, once the cache lets it', async ({
  page,
}) => {
  // This site has no purge token — `wrangler dev` has no zone to purge — so
  // the wizard lowered `cache_ttl` to 60 seconds and said so on screen
  // (docs/CLOUDFLARE_RESOURCES.md §6). An edit is therefore live *within a
  // minute*, not instantly, and this test pins that behaviour rather than the
  // one the product only has with a token configured.
  test.setTimeout(150_000);

  await signIn(page);
  await page.getByRole('link', { name: TITLE }).click();
  // The document arrives after the route renders; rewriting before it lands
  // would be overwritten by the load.
  await expect(page.locator('.cm-content')).toContainText(BODY);

  await rewriteDocument(page, `---\ntitle: ${TITLE}\n---\n\n${EDITED}`);
  await saveWith(page, 'Publish');

  // The save response above already proved the new text is stored; what is
  // left to prove is when a reader sees it.
  await expect(async () => {
    const fresh = await page.request.get(`/${SLUG}`);
    expect(await fresh.text()).toContain(EDITED);
  }).toPass({ timeout: 120_000, intervals: [5_000] });

  await page.goto(`/${SLUG}`);
  await expect(page.locator('body')).not.toContainText(BODY);
});

test('keeps a draft off the public site', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'New' }).click();

  await page.locator('.editor-bar select').selectOption('page');
  await page.locator('#fm-title').fill('Not for readers');
  await page.locator('.editor-bar input').fill('not-for-readers');
  await appendBody(page, 'This page is a draft and must stay invisible.');
  await saveWith(page, 'Save draft');

  const response = await page.goto('/not-for-readers');
  expect(response?.status()).toBe(404);
});
