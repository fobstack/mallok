import { readFile } from 'node:fs/promises';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Loads `.md` as a default-export string, mirroring the `Text` rule in
 * wrangler.jsonc. The worker project gets that rule from Wrangler; the `core`
 * project runs in plain Node, so without this it cannot import anything that
 * reaches `content/` — the starter, for one.
 */
function textModules(): Plugin {
  return {
    name: 'mallok-text-modules',
    async load(id) {
      const file = id.split('?')[0] ?? id;
      if (!file.endsWith('.md')) {
        return null;
      }
      return `export default ${JSON.stringify(await readFile(file, 'utf8'))};`;
    },
  };
}

/**
 * Six test projects, because the things being tested genuinely run in
 * different places:
 *
 *  - `core`            plain Node. `src/core`, which must not depend on the
 *                      Workers runtime, plus the admin's pure logic.
 *  - `worker`          real workerd. The full request path: D1, R2, Cache API.
 *  - `runtime`         plain Node. The page runtime's routing, cache
 *                      semantics, Liquid engine and Vite plugin — none of
 *                      which may need a platform to work.
 *  - `runtime-workerd` real workerd. The runtime's Cloudflare adapter,
 *                      including what may and may not enter a shared cache.
 *  - `runtime-dom`     a browser-like DOM. The island client, and the built
 *                      client bundle executed against server-rendered markup.
 *  - `runtime-build`   real Vite builds and a real dev server.
 *
 * The runtime moved into this repository from a separate package; its tests
 * came with it unchanged, because they are the reason its cache and routing
 * rules can be trusted.
 */
/**
 * The Workers environment every worker test runs in.
 *
 * Declared here in full rather than read from `wrangler.jsonc`, because
 * reading that file makes the pool load the `.dev.vars` beside it — a
 * developer's local secrets, in a test run. Everything the Worker needs is
 * listed; anything it should not have in a test (a real purge token, for
 * instance) is absent by construction.
 */
function workerEnvironment(
  extra: Record<string, string> = {},
): Record<string, unknown> {
  return {
    compatibilityDate: '2026-08-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['MEDIA'],
    bindings: {
      MALLOK_SECRET: 'test-secret-do-not-use',
      MALLOK_SITE: 'test',
      ...extra,
    },
    // The same Text rule wrangler.jsonc declares: themes, stylesheets and
    // migrations are imported as strings.
    modulesRules: [
      {
        type: 'Text',
        include: ['**/*.liquid', '**/*.css', '**/*.sql', '**/*.md'],
        fallthrough: true,
      },
    ],
  };
}

export default defineConfig({
  test: {
    /**
     * Coverage is collected from the Node projects only.
     *
     * V8 coverage cannot be gathered from code executing inside `workerd`, so
     * `src/worker`, `src/db` and `src/plugins` — which run there — are not
     * measurable here however well they are tested. They are excluded rather
     * than reported as zero, because a gate that counts thoroughly tested code
     * as uncovered teaches everyone to ignore it. `docs/TESTING.md §5` says
     * which directories the gate covers and which it cannot.
     *
     * The thresholds are today's measured floor, not an aspiration: their job
     * is to fail when coverage drops, and a threshold set above the current
     * number fails immediately and gets removed.
     */
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/core/**', 'src/cli/**', 'src/runtime/**'],
      exclude: ['**/*.d.ts', '**/tsconfig.json'],
      thresholds: {
        'src/core/**': { lines: 90, branches: 82 },
        'src/cli/**': { lines: 83, branches: 72 },
        'src/runtime/**': { lines: 88, branches: 85 },
      },
    },
    projects: [
      {
        plugins: [textModules()],
        test: {
          name: 'core',
          environment: 'node',
          include: [
            'test/core/**/*.test.ts',
            'test/admin/**/*.test.ts',
            'test/cli/**/*.test.ts',
          ],
          // Its own project below: it builds two complete packages from two
          // source trees and drives four real installs, which is fifteen
          // minutes. `pnpm test` stays usable; `pnpm test:release` runs it,
          // and the release gate runs that.
          exclude: ['test/cli/upgrade-target-owned.test.ts'],
          // Builds `dist/pkg` once. Two CLI test files need it, they run
          // concurrently, and the build starts by removing the directory.
          globalSetup: ['test/cli/helpers/build-package.ts'],
        },
      },
      {
        plugins: [textModules()],
        test: {
          name: 'release',
          environment: 'node',
          include: ['test/cli/upgrade-target-owned.test.ts'],
          globalSetup: ['test/cli/helpers/build-package.ts'],
          testTimeout: 1_800_000,
          hookTimeout: 1_800_000,
        },
      },
      {
        plugins: [
          cloudflareTest({
            // No `wrangler.configPath`. Pointing at the repository's own
            // configuration made the pool load the `.dev.vars` beside it, so
            // every worker test ran with a developer's local secret — green
            // on one laptop, red on another, and green *because* of a value
            // the repository does not contain.
            // `test/worker/environment-isolation.test.ts` is the tripwire.
            main: 'src/worker/index.ts',
            miniflare: workerEnvironment(),
          }),
        ],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
          // Their own projects below: each needs an environment the rest
          // must not have.
          exclude: [
            'test/worker/setup-key.test.ts',
            'test/worker/setup-concurrency.test.ts',
            'test/worker/setup-claim.test.ts',
          ],
        },
      },
      {
        /*
         * The first-run wizard with a one-time setup key.
         *
         * A separate project because the key is an *environment* difference:
         * every other worker test bootstraps an administrator directly, and
         * binding `MALLOK_SETUP_KEY` for all of them would make them all
         * exercise the same path instead of the ones they are about.
         */
        plugins: [
          cloudflareTest({
            main: 'src/worker/index.ts',
            miniflare: workerEnvironment({
              MALLOK_SETUP_KEY: 'a-one-time-setup-key-for-this-test',
              MALLOK_REQUIRE_SETUP_KEY: 'true',
              MALLOK_DOMAIN: 'provisioned.example',
            }),
          }),
        ],
        test: {
          name: 'worker-setup-key',
          include: [
            'test/worker/setup-key.test.ts',
            'test/worker/setup-concurrency.test.ts',
          ],
        },
      },
      {
        /*
         * A site between its first deploy and its secrets being set.
         *
         * `MALLOK_REQUIRE_SETUP_KEY` is declared and `MALLOK_SETUP_KEY` is
         * not — the exact window an automated scanner needs, and the one a
         * site must refuse to be claimed in.
         */
        plugins: [
          cloudflareTest({
            main: 'src/worker/index.ts',
            miniflare: workerEnvironment({
              MALLOK_REQUIRE_SETUP_KEY: 'true',
            }),
          }),
        ],
        test: {
          name: 'worker-unclaimable',
          include: ['test/worker/setup-claim.test.ts'],
        },
      },
      {
        test: {
          name: 'runtime',
          environment: 'node',
          include: ['test/runtime/*.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './test/runtime/workerd/wrangler.jsonc' },
          }),
        ],
        test: {
          name: 'runtime-workerd',
          include: ['test/runtime/workerd/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'runtime-dom',
          environment: 'happy-dom',
          // The markup these tests inject carries `<script src>` and `<link>`
          // tags naming built assets. Left to itself happy-dom tries to fetch
          // them over the network, which fails with ECONNREFUSED and surfaces
          // as an unhandled error after the run — green tests, exit code 1.
          // The island client is loaded explicitly by the test instead.
          environmentOptions: {
            happyDOM: {
              settings: {
                disableJavaScriptFileLoading: true,
                disableCSSFileLoading: true,
                fetch: { disableSameOriginPolicy: true },
              },
            },
          },
          include: ['test/runtime/dom/**/*.test.tsx'],
          // One of these runs two real Vite builds before it can assert
          // anything about the code a browser would actually execute.
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'runtime-build',
          environment: 'node',
          include: ['test/runtime/build/**/*.test.ts'],
          // Real Vite builds and a dev server: slower than a unit test, and
          // they must not be killed halfway through.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
