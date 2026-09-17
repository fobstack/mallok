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
 * So the suite gets its own configuration and its own environment file under
 * its ignored `.tmp/` run directory. The configuration lives there rather
 * than at the repository root precisely so that the root `.dev.vars` is not
 * adjacent to it; `main` and the assets directory are written as absolute
 * paths into the run's private source snapshot for the same reason.
 *
 * **The setup key is real.** These tests go through the wizard the way a site
 * owner does, with a key that has to be typed in, because refusing a keyless
 * setup is the production default (`docs/SECURITY.md §3.7`) and a suite that
 * turned it off with `MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY` would be testing a
 * configuration nobody ships.
 *
 * **The canary.** The generated config declares both secrets as required.
 * Wrangler therefore loads them from the `.dev.vars` beside that config and
 * warns visibly when either is absent. The browser suite observes the exact
 * setup key through the real wizard. It does not expose `MALLOK_SECRET`
 * through a test-only Worker endpoint.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutDir = resolve(repo, '.tmp/e2e');

/**
 * Non-secret values the suite knows, so it can exercise the setup flow.
 *
 * `MALLOK_SETUP_KEY` is typed into the wizard by `01-wizard.spec.ts`. The
 * encryption/session secret is deliberately absent: each run creates a fresh
 * value below and writes it only to the ignored `.tmp/` directory.
 */
export const E2E_ENV = {
  MALLOK_SETUP_KEY: 'e2e-setup-key-typed-into-the-wizard',
};

/** Writes the configuration and the environment file; returns their paths. */
export async function writeE2eConfig(
  outDir = defaultOutDir,
  projectRoot = repo,
) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const config = {
    // biome-ignore lint/style/useNamingConvention: Wrangler's own key, and it has to be spelled this way
    $schema: 'node_modules/wrangler/config-schema.json',
    name: 'mallok-e2e',
    main: resolve(projectRoot, 'src/worker/index.ts'),
    compatibility_date: '2026-08-01',
    compatibility_flags: ['nodejs_compat'],
    assets: {
      directory: resolve(projectRoot, 'dist/assets'),
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
    secrets: {
      required: ['MALLOK_SECRET', 'MALLOK_SETUP_KEY'],
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
  const runtimeEnv = {
    ...E2E_ENV,
    // A real deployment must never reuse a public fixture value for the key
    // that signs sessions and encrypts plugin secrets. The browser suite has
    // the same invariant even though its Worker and storage are local.
    MALLOK_SECRET: randomBytes(32).toString('base64url'),
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(
    envPath,
    `${Object.entries(runtimeEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  return { configPath, envPath, outDir };
}

if (process.argv[1]?.endsWith('e2e-config.mjs')) {
  const { configPath } = await writeE2eConfig();
  process.stdout.write(`${configPath}\n`);
}
