import { expect, test } from '@playwright/test';
import { signIn } from './credentials.js';

/**
 * Overview, the first screen after sign-in (docs/ADMIN_SIMPLE.md, D1): what
 * is left to set up, each plugin's newest rows, and what was edited last.
 * The steps are derived, never stored: filling in what a step asks for
 * removes it.
 */

test('the overview says what to set up next, and a step goes once done', async ({
  page,
}) => {
  await signIn(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview' }),
  ).toBeVisible();
  const setup = page.getByRole('region', { name: 'Finish setting up' });
  const recipient = setup.getByText('Inquiry: fill in Recipient email');
  await expect(recipient).toBeVisible();
  // wrangler dev has no custom domain, and the step says what that means.
  await expect(setup.getByText('Connect your domain')).toBeVisible();
  await expect(setup.getByText(/\d+ of \d+ done/)).toBeVisible();

  // Each plugin list's newest rows, and what was edited last.
  await expect(
    page.getByRole('region', { name: 'Inquiries' }).getByRole('link', {
      name: 'All Inquiries',
    }),
  ).toHaveAttribute('href', '/_mallok/app/plugins/inquiry/inquiries');
  const recent = page.getByRole('region', { name: 'Recently edited' });
  await expect(recent.getByRole('listitem').first()).toBeVisible();

  // The step's button goes where the setting is; filled in, the step goes.
  await setup
    .getByRole('listitem')
    .filter({ hasText: 'Inquiry: fill in Recipient email' })
    .getByRole('link', { name: 'Fill in' })
    .click();
  await expect(page).toHaveURL(/\/plugins#plugin-inquiry$/);
  const card = page.locator('#plugin-inquiry');
  await card.getByLabel('Recipient email').fill('sales@example.test');
  await card.getByRole('button', { name: 'Save settings' }).click();
  await expect(card.getByText('Saved')).toBeVisible();

  await page
    .locator('[data-sidebar="sidebar"]')
    .getByRole('link', { name: 'Overview' })
    .click();
  await expect(setup.getByText('Connect your domain')).toBeVisible();
  await expect(recipient).toHaveCount(0);
});
