import { defineConfig, devices } from '@playwright/test';

const reuseExistingRun = process.env.MALLOK_E2E_REUSE === '1';

/**
 * The end-to-end and accessibility run (docs/TESTING.md §2, §7).
 *
 * It drives a **real Worker**: `wrangler dev` with local D1 and R2, the same
 * code path a deployed site runs. The state directory is thrown away before
 * every run, because the first thing these tests exercise is the first-run
 * wizard, and a wizard only runs once per database.
 *
 * One worker, in file order, on purpose: the wizard creates the administrator
 * that every later test signs in as. Parallel workers would race for one
 * database.
 */
export default defineConfig({
  testDir: 'test/e2e',
  outputDir: '.tmp/e2e-results',
  fullyParallel: false,
  workers: 1,
  // A failure here is a real failure; a retry would only hide a flaky test.
  retries: 0,
  reporter: process.env.CI === 'true' ? 'line' : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './scripts/e2e-global-setup.mjs',
  webServer: {
    /*
     * The state directory is removed **here**, inside the server wrapper,
     * not in a `globalSetup`. Playwright starts the web server before it runs
     * global setup, so deleting the directory there pulled the SQLite file
     * out from under a wrangler process that had already opened and migrated
     * it: the wizard then appeared to work and the first public page request
     * failed with an internal error. The wrapper first takes an exclusive
     * lock, then removes the state and builds the hashed assets, so a second
     * run cannot replace chunks while this Worker is serving them.
     *
     * The build has to happen before wrangler starts too: the Worker imports
     * the compiled themes and serves the admin bundle from dist/assets.
     */
    command:
      // The wrapper runs `build:package` because `05-accessibility` builds each theme
      // with the packaged CLI. Without it the spec used a `dist/` directory
      // left over from an earlier release and passed against an artifact this
      // run never produced.
      //
      // The generated `-c` path is the important part. Run against the
      // repository's own configuration, Wrangler also loads the `.dev.vars`
      // beside it — a developer's local secrets, in a test run, which is the
      // defect `vitest.config.ts` was fixed for and which survived here. The
      // run-local configuration lives beside its own environment and points
      // `main` and assets at the private source snapshot.
      reuseExistingRun
        ? 'node scripts/e2e-server.mjs --require-running'
        : 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:8788/_mallok/api/setup/status',
    // Off by default so a run always tests the build it just made. Reuse is a
    // two-terminal workflow: first run `node scripts/e2e-server.mjs` and wait
    // for port 8788; only then set MALLOK_E2E_REUSE=1 for Playwright. If the
    // wrapper or its matching manifest is absent, the run fails closed rather
    // than attaching to an arbitrary process already using that port.
    reuseExistingServer: reuseExistingRun,
    timeout: 180_000,
    // Playwright otherwise SIGKILLs the whole process group. SIGTERM lets the
    // wrapper wait for Wrangler to exit and remove its ownership-checked lock;
    // the timeout remains a hard escape hatch for a stuck runtime. Playwright
    // cannot send this graceful signal on Windows; the wrapper's atomic dead-
    // owner recovery makes the next run safe after that forced termination.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
