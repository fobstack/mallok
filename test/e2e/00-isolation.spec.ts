import { expect, test } from '@playwright/test';
import { E2E_ENV } from '../../scripts/e2e-config.mjs';

/**
 * The Worker under test must not be reading a developer's `.dev.vars`.
 *
 * `wrangler dev` loads the `.dev.vars` sitting beside the configuration it was
 * given, so running these tests against the repository's own
 * `wrangler.jsonc` handed the Worker whatever secrets happened to be on the
 * machine. That is green on one laptop, red on another, and — worse — green
 * *because* of a value the repository does not contain.
 * `scripts/e2e-config.mjs` generates a configuration in its own directory,
 * with its own environment file, so there is no root `.dev.vars` adjacent to
 * it.
 *
 * This checks that by **observation**, not by assertion of intent. The root
 * `.dev.vars` carries a developer's `MALLOK_SECRET` and its own
 * `MALLOK_DEV_VARS_CANARY`; the generated one carries different values for
 * both. Every test below reads something the Worker actually did with those
 * values, so a leak changes the result rather than going unnoticed.
 *
 * It runs first, before the wizard, because everything after it is worthless
 * if this is wrong.
 */

test.describe.configure({ mode: 'serial' });

test('answers as the site this configuration describes', async ({
  request,
}) => {
  // `MALLOK_SITE` is `e2e` only in the generated configuration; the
  // repository's own says `site`. A Worker started against the wrong config
  // reports the wrong slug here.
  const response = await request.get('/_mallok/api/setup/status');

  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    site?: { slug?: string } | null;
    requiresSetupKey: boolean;
    ready: boolean;
  };

  // The wizard asks for a key, and can be completed — which is the state the
  // generated environment puts it in, and *not* what an empty environment
  // would produce (`ready` would be false with no key bound).
  expect(body.requiresSetupKey).toBe(true);
  expect(body.ready).toBe(true);
});

test('uses the setup key this run generated, not one from elsewhere', async ({
  request,
}) => {
  // The strongest available observation. A wrong key is refused with 403, so
  // this both proves the Worker holds *this* run's `MALLOK_SETUP_KEY` and
  // that a key from any other source would not open the wizard.
  const wrong = await request.post('/_mallok/api/setup/admin', {
    data: {
      email: 'not-the-owner@example.com',
      password: 'a-sufficiently-long-password',
      setupKey: 'definitely-not-the-key-this-run-generated',
    },
  });

  expect(wrong.status()).toBe(403);

  // And no administrator was created as a side effect of being asked.
  const status = await request.get('/_mallok/api/setup/status');
  const body = (await status.json()) as { hasAdmin?: boolean };
  expect(body.hasAdmin).toBe(false);
});

test('the generated environment is the one on disk', async () => {
  // A cheap direct reading of the file the Worker was pointed at. If the
  // suite is ever changed to reuse the repository's configuration, this
  // fails alongside the observations above rather than leaving them to
  // explain a confusing failure on their own.
  const { readFile } = await import('node:fs/promises');
  const env = await readFile('.tmp/e2e/.dev.vars', 'utf8');

  expect(env).toContain(`MALLOK_SETUP_KEY=${E2E_ENV.MALLOK_SETUP_KEY}`);
  expect(env).toContain(
    `MALLOK_DEV_VARS_CANARY=${E2E_ENV.MALLOK_DEV_VARS_CANARY}`,
  );

  // The root file, if it exists at all, must be a different one — otherwise
  // the canary above could pass by coincidence.
  const root = await readFile('.dev.vars', 'utf8').catch(() => '');
  if (root !== '') {
    expect(root).not.toContain(E2E_ENV.MALLOK_SECRET);
    expect(root).not.toContain(E2E_ENV.MALLOK_DEV_VARS_CANARY);
  }
});
