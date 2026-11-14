import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * The interface language (docs/ADMIN_I18N_AND_UI.md, D2 and D7).
 *
 * It is chosen in the account menu and kept in this browser — no cookie, so
 * the edge cache never varies by it — and, since phase 3, with the account,
 * so another browser follows once it signs in.
 */

test('switches the shell to Simplified Chinese and keeps the choice', async ({
  page,
  context,
  browser,
}) => {
  await signIn(page);
  const cookiesBefore = await context.cookies();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'Account menu' }).click();
  // Each language is listed in its own name, under a label that says this is
  // the interface's language and not the site's.
  await expect(page.getByText('Interface language')).toBeVisible();
  await page.getByRole('menuitemradio', { name: '简体中文' }).click();

  const sidebar = page.locator('[data-sidebar="sidebar"]').first();
  await expect(sidebar.getByRole('link', { name: '媒体' })).toBeVisible();
  await expect(sidebar.getByText('设置', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await page.reload();
  await expect(sidebar.getByRole('link', { name: '媒体' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  // The choice lives in this browser's storage, not in a cookie the edge
  // cache or the Worker would see.
  expect(await context.cookies()).toEqual(cookiesBefore);

  // The account keeps it too (D2): another browser, with nothing stored and
  // an English preference, is in Chinese the moment it signs in.
  const elsewhere = await browser.newContext({ locale: 'en-US' });
  try {
    const other = await elsewhere.newPage();
    await signIn(other);
    await expect(
      other.locator('[data-sidebar="sidebar"]').first().getByRole('link', {
        name: '媒体',
      }),
    ).toBeVisible();
    await expect(other.locator('html')).toHaveAttribute('lang', 'zh-CN');
  } finally {
    await elsewhere.close();
  }

  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(sidebar.getByRole('link', { name: 'Media' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test.describe('a browser that prefers Chinese', () => {
  test.use({ locale: 'zh-CN' });

  test('is greeted in Chinese before anyone has chosen', async ({ page }) => {
    await page.goto('/_mallok/app/');
    await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();
    await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
});

test('can be chosen on the sign-in page, before there is a session', async ({
  page,
}) => {
  await page.goto('/_mallok/app/');
  await page
    .getByRole('combobox', { name: 'Interface language' })
    .selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test("a theme's declarations are in Chinese, and its preview is not", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitemradio', { name: '简体中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  try {
    await page.goto('/_mallok/app/content');
    await page.getByRole('link', { name: 'Grade 5 titanium bar' }).click();
    // The theme's admin catalog names the fields (docs/THEME_FORMAT.md
    // §10.1)…
    await expect(page.getByLabel('牌号', { exact: true })).toBeVisible();
    await expect(page.getByText('规格', { exact: true })).toBeVisible();
    // …while the preview is the page a reader gets, in the content's
    // language, rendered from the declarations as the theme wrote them.
    const preview = page.frameLocator('iframe[title="预览"]');
    await expect(
      preview.getByRole('heading', { name: 'Grade 5 titanium bar' }),
    ).toBeVisible();
    await expect(preview.getByText('产品', { exact: true })).toHaveCount(0);
  } finally {
    await page.getByRole('button', { name: '账号菜单' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  }
});
