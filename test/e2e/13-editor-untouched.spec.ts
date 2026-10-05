import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Opening an item and not editing it (docs/ADMIN.md §6.2).
 *
 * The Markdown pane is a view of the document, and the document is pushed
 * into it when the item arrives. That push used to come back out as an edit:
 * whenever the pane was ready before the item was — which is every time
 * after the first, once its code is loaded — the editor showed "Unsaved"
 * for an item nobody had touched. For most items the text it "edited in" was
 * the same text. For one with Windows line endings it was not: the pane
 * holds `\n`, so Publish would have rewritten every line ending of a
 * document its author never changed.
 */

const CRLF =
  '---\r\ntitle: Windows line endings\r\n---\r\n\r\nFirst line.\r\nSecond line.\r\n';

/** Opens an item from inside the app, as a click in the list would. */
async function openInSession(page: Page, id: string): Promise<void> {
  await page.getByRole('link', { name: 'Content' }).first().click();
  await expect(
    page.locator('a[href^="/_mallok/app/content/"]').first(),
  ).toBeVisible();
  // As a string: this file is type-checked without the DOM library.
  await page.evaluate(
    `window.history.pushState({}, '', '/_mallok/app/content/${id}');
     window.dispatchEvent(new PopStateEvent('popstate'));`,
  );
  await expect(page.locator('.cm-content')).toBeVisible();
  // The preview is debounced behind the document; once it has rendered,
  // everything that reacts to the item arriving has run.
  await expect(page.locator('.preview-note')).toContainText('/');
  await page.waitForTimeout(600);
}

test('an item that is opened and not edited is not unsaved, and saves as unchanged', async ({
  page,
}) => {
  await signIn(page);

  // A token, to create an item whose bytes the test controls exactly.
  await page.goto('/_mallok/app/account');
  await page.locator('#token-name').fill(`e2e-untouched-${Date.now()}`);
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = (
    await page.locator('.token-reveal code').textContent()
  )?.trim();
  await page.getByRole('button', { name: 'Done' }).click();
  const created = await page.request.post('/_mallok/api/content', {
    headers: { authorization: `Bearer ${token}` },
    data: { kind: 'page', slug: 'crlf-untouched', markdown: CRLF },
  });
  expect(created.status()).toBe(201);
  const crlf = ((await created.json()) as { id: string }).id;

  const listed = await page.request.get(
    '/_mallok/api/content?kind=product&locale=en&limit=1',
    { headers: { authorization: `Bearer ${token}` } },
  );
  const product = ((await listed.json()) as { items: { id: string }[] })
    .items[0]?.id as string;

  // Warm the editor's code, then open items the way a session does.
  await page.goto('/_mallok/app/');
  for (const id of [product, crlf, product, crlf]) {
    await openInSession(page, id);
    await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  }

  // Still on the CRLF item, untouched. Publishing it stores nothing new:
  // the server compares bytes, and they are the bytes it already has.
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/content') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Publish' }).click();
  const answer = (await (await saved).json()) as { unchanged?: boolean };
  expect(answer.unchanged).toBe(true);
  const stored = await page.request.get(`/_mallok/api/content/${crlf}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(((await stored.json()) as { markdown: string }).markdown).toBe(CRLF);
});
