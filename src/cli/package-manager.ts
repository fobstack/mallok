/**
 * Which package manager a generated project uses: **npm**, and only npm.
 *
 * 0.1.0-rc.3 advertised a choice of npm or pnpm. npm was tested end to end;
 * pnpm was not, and when it was finally exercised it did not work — pnpm
 * would not install the candidate package from the local registry the release
 * test serves it from, so the one path that proves a project can be built
 * from a published artifact had never been run under it. Shipping a flag for
 * that is shipping a claim.
 *
 * So the flag is gone and the surface is one manager. npm is the right one to
 * keep: it comes with Node, which makes the documented prerequisite — Node 22
 * — genuinely sufficient on a new machine.
 *
 * Adding pnpm back is a piece of work, not a flag: `create`, `upgrade` and a
 * clean reinstall all have to pass under it, and the project has to record
 * which manager owns it so that `upgrade` cannot pick the other one.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError, EXIT } from './output.js';

/** The lockfile npm writes, and the one a project is expected to carry. */
export const LOCKFILE = 'package-lock.json';

/** Lockfiles belonging to managers this version does not drive. */
const FOREIGN_LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'];

/** The arguments that install a project's dependencies for the first time. */
export function installArgs(): string[] {
  // Not a frozen install: a generated project has no lockfile yet. The
  // install is what writes one, and the lockfile is then checked into the
  // site's repository as the record of what it was verified against.
  return ['install'];
}

/** The arguments that reinstall from an existing lockfile, changing nothing. */
export function frozenInstallArgs(): string[] {
  return ['ci'];
}

/** The arguments that run one of the project's own scripts. */
export function runArgs(script: string): string[] {
  return ['run', script];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuses to act on a project another package manager owns.
 *
 * Running `npm ci` in a directory holding a `pnpm-lock.yaml` would resolve a
 * different dependency tree from the one its owner tested, and quietly write
 * a second lockfile beside the first. Two lockfiles in one project is a
 * problem that outlives whoever created it.
 */
export async function assertNpmProject(projectDir: string): Promise<void> {
  const foreign: string[] = [];
  for (const lockfile of FOREIGN_LOCKFILES) {
    if (await exists(join(projectDir, lockfile))) {
      foreign.push(lockfile);
    }
  }
  if (foreign.length === 0) {
    return;
  }
  throw new CliError(
    EXIT.user,
    `This project has a ${foreign.join(' and a ')}, and this version of Mallok drives npm.`,
    'Mallok 0.1 supports npm only, because that is the path its release ' +
      'gate actually exercises. Either install with npm and remove the other ' +
      'lockfile, or run the install, build and deploy steps yourself.',
  );
}
