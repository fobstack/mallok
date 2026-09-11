import { defineConfig, devices } from '@playwright/test';

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
  webServer: {
    /*
     * The state directory is removed **here**, inside the server command,
     * not in a `globalSetup`. Playwright starts the web server before it runs
     * global setup, so deleting the directory there pulled the SQLite file
     * out from under a wrangler process that had already opened and migrated
     * it: the wizard then appeared to work and the first public page request
     * failed with an internal error. Removing it before wrangler starts is
     * the only ordering that is actually guaranteed.
     *
     * The build has to happen before wrangler starts too: the Worker imports
     * the compiled themes and serves the admin bundle from dist/assets.
     */
    command:
      'rm -rf .tmp/e2e-state && pnpm run build:themes && pnpm run build:admin && npx wrangler dev --port 8788 --persist-to .tmp/e2e-state',
    url: 'http://127.0.0.1:8788/_mallok/api/setup/status',
    // Off by default so a run always tests the build it just made. Set
    // MALLOK_E2E_REUSE=1 to attach to a `wrangler dev` you started yourself,
    // which is how you read the Worker's own logs while debugging one.
    reuseExistingServer: process.env.MALLOK_E2E_REUSE === '1',
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
