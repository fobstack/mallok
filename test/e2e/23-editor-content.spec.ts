import { expect, type Page, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * The writing-first editor keeps the Markdown the operator's own file
 * (docs/ADMIN_SIMPLE.md, D4; docs/ADMIN.md §6.2): it hides the front
 * matter, it does not rewrite it. An edit to the text leaves the block's
 * bytes alone, and an edit to a field keeps every key the theme does not
 * declare.
 */

const HEAD =
  '---\ntitle: Kept as typed\n# a comment the YAML writer would drop\nextra_note:   spaced   value\nweight: 3\n---\n';

async function token(page: Page): Promise<string> {
  // Tokens live under Advanced since ADMIN_SIMPLE G18.
  await page.goto('/_mallok/app/settings/advanced');
  await page.getByLabel('New token name').fill(`e2e-content-${Date.now()}`);
  await page.getByRole('button', { name: 'Create token' }).click();
  const value = (
    await page.getByRole('alert').locator('code').textContent()
  )?.trim();
  await page.getByRole('button', { name: 'Done' }).click();
  return value ?? '';
}

async function create(page: Page, bearer: string, slug: string) {
  const created = await page.request.post('/_mallok/api/content', {
    headers: { authorization: `Bearer ${bearer}` },
    data: { kind: 'page', slug, markdown: `${HEAD}\nFirst paragraph.\n` },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function stored(page: Page, bearer: string, id: string) {
  const response = await page.request.get(`/_mallok/api/content/${id}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  return ((await response.json()) as { markdown: string }).markdown;
}

async function update(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/content') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Update' }).first().click();
  expect((await saved).status()).toBeLessThan(300);
}

test('an edit to the text leaves the front matter byte for byte', async ({
  page,
}) => {
  await signIn(page);
  const bearer = await token(page);
  const id = await create(page, bearer, 'kept-as-typed');

  await page.goto(`/_mallok/app/content/${id}?kind=page`);
  const text = page.locator('.cm-content');
  await expect(text).toContainText('First paragraph.');
  await expect(text).not.toContainText('extra_note');
  await text.click();
  await text.press('ControlOrMeta+End');
  await text.pressSequentially('Second paragraph.');
  await update(page);

  const markdown = await stored(page, bearer, id);
  expect(markdown.startsWith(HEAD)).toBe(true);
  expect(markdown).toContain('First paragraph.');
  expect(markdown).toContain('Second paragraph.');
});

test('an edit to a field keeps every key the theme does not declare', async ({
  page,
}) => {
  await signIn(page);
  const bearer = await token(page);
  const id = await create(page, bearer, 'kept-keys');

  await page.goto(`/_mallok/app/content/${id}?kind=page`);
  await expect(page.locator('.cm-content')).toContainText('First paragraph.');
  await page
    .getByRole('complementary', { name: 'Page settings' })
    .getByLabel('Summary')
    .fill('A short summary.');
  await update(page);

  const markdown = await stored(page, bearer, id);
  // The block is written again for a field edit, as it always was; what it
  // holds is kept.
  expect(markdown).toContain('description: A short summary.');
  expect(markdown).toContain('extra_note: spaced   value');
  expect(markdown).toContain('weight: 3');
  expect(markdown).toContain('title: Kept as typed');
  expect(markdown).toContain('First paragraph.');
});
