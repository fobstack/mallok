import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * The interface language (docs/ADMIN_I18N_AND_UI.md, D2 and D7).
 *
 * It is chosen in the account menu and kept in this browser only: no cookie,
 * nothing the Worker sees. Phase 1 translates the shell and the sign-in page;
 * the pages inside the shell still read English.
 */

test('switches the shell to Simplified Chinese and keeps the choice', async ({
  page,
  context,
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
