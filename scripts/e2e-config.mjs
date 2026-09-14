/**
 * Builds the Wrangler configuration and environment the browser tests use.
 *
 * The end-to-end suite used to run `wrangler dev` against the **repository's
 * own** `wrangler.jsonc`, which means Wrangler also loaded the `.dev.vars`
 * sitting beside it — a developer's local secrets, in a test run. That is the
 * same defect `vitest.config.ts` was fixed for, still present in the one
 * place that drives a real Worker: green on one laptop, red on another, and
 * green *because* of a value the repository does not contain.
 *
 * So the suite gets its own configuration and its own environment file, both
 * generated here into `.tmp/e2e/`. The configuration lives in that directory
 * rather than at the repository root precisely so that the root `.dev.vars`
 * is not adjacent to it; `main` and the assets directory are written as
 * absolute paths for the same reason.
 *
 * **The setup key is real.** These tests go through the wizard the way a site
 * owner does, with a key that has to be typed in, because refusing a keyless
 * setup is the production default (`docs/SECURITY.md §3.7`) and a suite that
 * turned it off with `MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY` would be testing a
 * configuration nobody ships.
 *
 * **The canary.** The root `.dev.vars` sets `MALLOK_SECRET` to a developer's
 * own value; the file written here sets a different one, and a different
 * `MALLOK_DEV_VARS_CANARY`. `test/e2e/00-isolation.spec.ts` reads what the
 * Worker actually used. If the root file ever reaches this process, the
 * values differ and that test fails — which is the only kind of isolation
 * check worth having, because it observes rather than asserts an intention.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repo, '.tmp/e2e');

/**
 * Values the suite knows, so it can prove the Worker used *these*.
 *
 * Not credentials: this Worker is local, its D1 and R2 are files under
 * `.tmp/`, and nothing here can reach Cloudflare. `MALLOK_SETUP_KEY` is typed
 * into the wizard by `01-wizard.spec.ts`.
 */
export const E2E_ENV = {
  MALLOK_SECRET: 'e2e-secret-not-a-real-one-0123456789abcdef',
  MALLOK_SETUP_KEY: 'e2e-setup-key-typed-into-the-wizard',
  MALLOK_DEV_VARS_CANARY: 'e2e-canary-value',
};

/** Writes the configuration and the environment file; returns their paths. */
export async function writeE2eConfig() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const config = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'mallok-e2e',
    main: resolve(repo, 'src/worker/index.ts'),
    compatibility_date: '2026-08-01',
    compatibility_flags: ['nodejs_compat'],
    assets: {
      directory: resolve(repo, 'dist/assets'),
      binding: 'ASSETS',
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'mallok-e2e-db',
        database_id: '00000000-0000-0000-0000-000000000000',
      },
    ],
    r2_buckets: [{ binding: 'MEDIA', bucket_name: 'mallok-e2e-media' }],
    ratelimits: [
      {
        name: 'RATE_LIMITER',
        namespace_id: '1001',
        simple: { limit: 100, period: 60 },
      },
    ],
    vars: {
      MALLOK_SITE: 'e2e',
      MALLOK_DOMAIN: '',
      // Deliberately **not** MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY. The wizard
      // requires a key here exactly as it does in production, and the suite
      // supplies one.
    },
    rules: [
      {
        type: 'Text',
        globs: ['**/*.liquid', '**/*.css', '**/*.sql', '**/*.md'],
        fallthrough: true,
      },
    ],
    // No cron: a trigger firing every minute during a browser run is noise,
    // and `test/worker/scheduled*.test.ts` covers the handler properly.
  };

  const configPath = resolve(outDir, 'wrangler.jsonc');
  const envPath = resolve(outDir, '.dev.vars');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(
    envPath,
    `${Object.entries(E2E_ENV)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    'utf8',
  );
  return { configPath, envPath, outDir };
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('e2e-config.mjs')
) {
  const { configPath } = await writeE2eConfig();
  process.stdout.write(`${configPath}\n`);
}
