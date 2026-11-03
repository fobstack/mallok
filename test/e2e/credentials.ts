import type { Page } from '@playwright/test';

/**
 * The administrator the wizard creates, reused by every later spec.
 *
 * A fixed local-only value: the run starts from an empty database inside its
 * private `.tmp/e2e-runs/` directory, which is deleted after the run and
 * never deployed.
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
  const email = page.getByLabel('Email', { exact: true });
  // Both the sign-in page and the shell load after the first paint, so wait
  // for whichever arrives before deciding whether to sign in.
  await email.or(page.getByRole('button', { name: 'Account menu' })).waitFor();
  if (await email.isVisible()) {
    await email.fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page
    .getByLabel('Password', { exact: true })
    .waitFor({ state: 'detached' });
}
