import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Builds the publishable package once, for the whole test project.
 *
 * A Vitest `globalSetup` rather than a `beforeAll` in each file: several tests
 * need the package, they run concurrently, and `scripts/build-package.mjs`
 * starts by removing `dist/pkg`. One of them would occasionally find the
 * directory disappearing underneath it — a failure that looked like a broken
 * build and was a race between two tests.
 */
export default async function build(): Promise<void> {
  const candidate = process.env.MALLOK_CANDIDATE_TARBALL;
  if (candidate !== undefined) {
    // The release workflow has already packed the one immutable candidate.
    // Rebuilding `dist/pkg` here would make the boundary tests green against
    // a directory other than the tarball selected for publication.
    await stat(resolve(candidate));
    return;
  }
  await run('node', ['scripts/build-package.mjs'], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });
}
