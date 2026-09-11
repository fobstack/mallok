import type { Page } from '@playwright/test';

/**
 * The administrator the wizard creates, reused by every later spec.
 *
 * A fixed local-only value: the run starts from an empty database in
 * `.tmp/e2e-state`, which is deleted before every run and never deployed.
 */
export const ADMIN = {
  email: 'e2e@example.test',
  password: 'e2e-local-only-password',
} as const;

/**
 * Signs in through the interface.
 *
 * Through the form rather than the API on purpose: every write the admin
 * makes carries a CSRF token the browser session holds, so a test that logged
 * in over HTTP would then have to reimplement that handshake — and would stop
 * testing the thing users actually do.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/_mallok/app/');
  const email = page.locator('#login-email');
  if (await email.isVisible().catch(() => false)) {
    await email.fill(ADMIN.email);
    await page.locator('#login-password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page.waitForSelector('#login-password', { state: 'detached' });
}
