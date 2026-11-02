import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Prefixing the default language, from Settings → Site → Languages
 * (docs/ADMIN.md §6.6, docs/ARCHITECTURE.md §9).
 *
 * It rewrites every URL, so the checkbox asks first. The test turns it on,
 * sees the site's root redirect to the default language's home, and turns it
 * off again, because the browser tests share one site.
 */
test('the default language can be prefixed, and the root then redirects', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto('/_mallok/app/settings');
  const box = page.getByRole('checkbox', {
    name: /Prefix the default language too/,
  });
  await expect(box).not.toBeChecked();

  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  const switched = page.waitForResponse(
    (response) =>
      response.url().endsWith('/_mallok/api/settings/locale-prefix') &&
      response.request().method() === 'POST',
  );
  // The box follows the saved setting, so it changes only once the switch
  // has answered: `check()` would see it unchanged straight after the click.
  await box.click();
  expect((await switched).status()).toBe(200);
  expect(asked[0]).toContain('redirects to its new one');
  await expect(
    page.getByText(/URLs moved, each with a redirect/),
  ).toBeVisible();
  await expect(box).toBeChecked();

  // This site has no purge token, so the home page the earlier tests cached
  // at `/` lasts until `cache_ttl` (60 seconds here) runs out, as an edit's
  // does (03-publish.spec.ts). With a token the switch purges it at once.
  let location = '';
  await expect(async () => {
    const root = await page.request.get('/', { maxRedirects: 0 });
    expect(root.status()).toBe(301);
    location = root.headers().location ?? '';
  }).toPass({ timeout: 120_000, intervals: [5_000] });
  const home = new URL(location).pathname;
  expect(home).toMatch(/^\/[a-z]{2}(-[a-z]{2,4})?$/);
  expect((await page.request.get(home)).status()).toBe(200);

  const back = page.waitForResponse((response) =>
    response.url().endsWith('/_mallok/api/settings/locale-prefix'),
  );
  await box.click();
  expect((await back).status()).toBe(200);
  await expect(box).not.toBeChecked();
  expect((await page.request.get('/', { maxRedirects: 0 })).status()).toBe(200);
});
