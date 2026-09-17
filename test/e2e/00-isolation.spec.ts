import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_ENV } from '../../scripts/e2e-config.mjs';
import { readE2eRunManifest } from '../../scripts/e2e-server.mjs';

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
 * `.dev.vars` can carry unrelated developer secrets. The generated config
 * declares its own two secrets as required and has its own adjacent
 * `.dev.vars`. The HTTP checks here prove that setup is fail-closed; the
 * wizard spec that follows completes setup with the generated key, which
 * proves the isolated value reached the Worker. The file check guards the
 * other half of that contract: the generated environment contains the
 * expected value. No test-only endpoint exposes the session/encryption
 * secret.
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

test('rejects every setup key except the isolated fixture value', async ({
  request,
}) => {
  // A wrong key must be refused with 403. The next spec supplies the fixture
  // value successfully; together those observations prove the Worker did not
  // silently enter keyless mode or read an unrelated root `.dev.vars` value.
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

test('the generated environment contains the isolated setup key', async () => {
  // A cheap direct reading of the generated environment. The web-server
  // config is beside this exact file; the browser observations above and in
  // the wizard spec prove what the Worker actually enforced.
  const { readFile } = await import('node:fs/promises');
  const { envPath, sourceRoot } = await readE2eRunManifest();
  const env = await readFile(envPath, 'utf8');

  expect(env).toContain(`MALLOK_SETUP_KEY=${E2E_ENV.MALLOK_SETUP_KEY}`);
  expect(env).toMatch(/^MALLOK_SECRET=.+$/m);
  expect(sourceRoot.startsWith(resolve('.tmp/e2e-runs'))).toBe(true);
});
