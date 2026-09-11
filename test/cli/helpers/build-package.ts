import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Builds the publishable package once, for the whole test project.
 *
 * A Vitest `globalSetup` rather than a `beforeAll` in each file: two test
 * files need the package, they run concurrently, and `scripts/build-package.mjs`
 * starts by removing `dist/pkg`. One of them would occasionally find the
 * directory disappearing underneath it — a failure that looked like a broken
 * build and was a race between two tests.
 */
export default async function build(): Promise<void> {
  await run('node', ['scripts/build-package.mjs'], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });
}
