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
  name: 'Publish' | 'Save draft' | 'Update',
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
 * Appends body text at the end of the text pane, which holds the body
 * alone since the editor became writing-first (docs/ADMIN_SIMPLE.md, D4).
 */
async function appendBody(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await expect(page.locator('.cm-editor.cm-focused')).toBeVisible();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially(`\n\n${text}`);
}

/**
 * Replaces the whole document, front matter and all, in "Edit source": the
 * one place the stored document is shown entire (D4 option C).
 */
async function rewriteDocument(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Edit source (Markdown)' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Markdown source' }),
  ).toBeVisible();
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
  // From the list of every type; Overview has an Add menu instead (D1).
  await page.goto('/_mallok/app/content');
  await page.getByRole('button', { name: 'Add content' }).click();

  // `page` is one of the two kinds the core always has (docs/ARCHITECTURE §8).
  await page.getByRole('combobox', { name: /^Type/ }).selectOption('page');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(TITLE);
  await page.getByLabel('URL slug', { exact: true }).fill(SLUG);
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
  // A page already on the site is updated, not published again (G1, D6).
  await saveWith(page, 'Update');

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
  // From the list of every type; Overview has an Add menu instead (D1).
  await page.goto('/_mallok/app/content');
  await page.getByRole('button', { name: 'Add content' }).click();

  await page.getByRole('combobox', { name: /^Type/ }).selectOption('page');
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Not for readers');
  await page.getByLabel('URL slug', { exact: true }).fill('not-for-readers');
  await appendBody(page, 'This page is a draft and must stay invisible.');
  await saveWith(page, 'Save draft');

  const response = await page.goto('/not-for-readers');
  expect(response?.status()).toBe(404);
});

test('a published page is updated or unpublished, never saved back to a draft', async ({
  page,
}) => {
  await signIn(page);
  // From the list of every type; Overview has an Add menu instead (D1).
  await page.goto('/_mallok/app/content');
  await page.getByRole('button', { name: 'Add content' }).click();
  await page.getByRole('combobox', { name: /^Type/ }).selectOption('page');
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Live for now');
  await page.getByLabel('URL slug', { exact: true }).fill('live-for-now');
  // Not fetched while live: that would put it in the edge cache, which with
  // no purge token here keeps it for a minute (see the test above), and
  // the 404 below would wait on the cache instead of on the save.
  await saveWith(page, 'Publish');

  // Once it is live, nothing reads "Save draft": the safe-looking button
  // used to take the page off the site (docs/ADMIN_SIMPLE.md, G1).
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();

  // Taking it off asks first; declining sends nothing.
  let posted = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/_mallok/api/content')
    ) {
      posted += 1;
    }
  });
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Unpublish' }).click();
  await page.waitForTimeout(300);
  expect(posted).toBe(0);

  // The question says what a visitor will see (D6).
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/content') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Unpublish' }).click();
  expect(((await (await saved).json()) as { status: string }).status).toBe(
    'draft',
  );
  expect((await page.request.get('/live-for-now')).status()).toBe(404);
  // A draft again, so the buttons are a draft's.
  expect(asked).toContain('visitors no longer see it');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();

  // Deleting it, from the same menu, says what goes and what stays, and
  // leaves its list.
  let warned = '';
  page.once('dialog', (dialog) => {
    warned = dialog.message();
    void dialog.accept();
  });
  const deleted = page.waitForResponse(
    (response) =>
      response.url().includes('/_mallok/api/content/') &&
      response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  expect((await deleted).status()).toBeLessThan(300);
  expect(warned).toContain('"Live for now"');
  expect(warned).toContain('cannot be undone');
  await expect(page).toHaveURL(/\/content\?kind=page$/);
  await expect(page.getByRole('link', { name: 'Live for now' })).toHaveCount(0);
});
