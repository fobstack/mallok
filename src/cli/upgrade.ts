/**
 * `mallok upgrade --to <exact-version>` — the supported way to move a site
 * onto a new Mallok.
 *
 * A site's project holds its own configuration, content, theme choice and four
 * lines of composition; everything else arrives as the `mallok` dependency. So
 * an upgrade is a version number, an install, and a check that the site still
 * builds against what was installed.
 *
 * **This used to be much larger, and the size was not earning anything.** It
 * copied the whole project to a temporary directory, installed there, handed
 * control to the target version's own binary through a documented
 * inter-version protocol so that release could apply *its* project migrations,
 * ran the checks in the copy, and finally swapped the copy over the original
 * with a rename. The reasoning was sound and the machinery worked. It also
 * guarded **zero** migrations: `PROJECT_MIGRATIONS` was empty, and a
 * directory-swapping transaction that protects nothing contributes only its
 * own failure modes — a half-completed rename leaves no project at all.
 *
 * So it is gone, and what remains is the part that was always doing the work:
 *
 * - the target must be an **exact** version, not a range;
 * - versions are compared with `semver`, so `rc.10` is newer than `rc.2` and
 *   build metadata does not affect precedence;
 * - `package.json` and the lockfile are updated, and the target is installed;
 * - the project's **own** checks run — and because they run against the
 *   package that was just installed, they are the target version's checks;
 * - on any failure, `package.json` and the lockfile are restored and the
 *   previous version is reinstalled.
 *
 * The moment a release genuinely needs to change a file inside somebody's
 * project, this gets designed again with that migration in front of us. A
 * mechanism built for a migration nobody has written yet is a guess about what
 * that migration will turn out to need.
 *
 * Database schema migrations are deliberately elsewhere: the Worker applies
 * those on its first request after a deploy, which is the only place that can
 * do it safely for a database it is already serving.
 */

import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import semver from 'semver';
import { type CommandRunner, lastLine } from './cloudflare.js';
import { CliError, EXIT, type Reporter } from './output.js';
import {
  assertNpmProject,
  frozenInstallArgs,
  installArgs,
  runArgs,
} from './package-manager.js';
import { isMallokProject, projectWrangler } from './template.js';

/** Where the in-progress record and the lock live. */
const JOURNAL = '.mallok/upgrade-journal.json';
const LOCK = '.mallok/upgrade.lock';

/**
 * What an interrupted upgrade left behind.
 *
 * Written **before** the manifest is touched and removed only after the run
 * has finished, so its presence means "a change was in flight". It carries
 * the bytes of both files as they were, which is what lets the next run put
 * them back without knowing anything about what happened in between.
 */
interface Journal {
  readonly schemaVersion: 1;
  readonly from: string;
  readonly to: string;
  readonly startedAt: string;
  readonly manifest: string;
  readonly lock: string;
}

/**
 * Writes a file by creating a temporary one beside it and renaming.
 *
 * A rename within a directory is atomic, so a reader sees either the old file
 * or the new one — never a half-written journal, which is the one file that
 * must not be ambiguous.
 */
async function writeAtomic(path: string, body: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, body, 'utf8');
  await rename(temporary, path);
}

/**
 * Takes the project's upgrade lock, or refuses.
 *
 * `wx` fails when the file exists, which is the whole mechanism: two upgrades
 * in the same directory would both read the same "before", and the loser
 * would restore a manifest the winner had already replaced.
 */
async function takeLock(projectDir: string): Promise<() => Promise<void>> {
  const path = join(projectDir, LOCK);
  await mkdir(join(projectDir, '.mallok'), { recursive: true });
  try {
    const handle = await open(path, 'wx');
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`,
    );
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(
        EXIT.user,
        'Another upgrade is already running in this project.',
        `If none is, the previous one was killed: remove ${LOCK} and try ` +
          'again. It is a lock, not state — nothing is lost by deleting it.',
      );
    }
    throw error;
  }
  return async () => {
    await rm(path, { force: true });
  };
}

/** Puts back whatever an interrupted run was in the middle of changing. */
async function recover(
  projectDir: string,
  report: Reporter,
  runner: CommandRunner | undefined,
): Promise<void> {
  const path = join(projectDir, JOURNAL);
  const raw = await readFile(path, 'utf8').catch(() => null);
  if (raw === null) {
    return;
  }
  let journal: Journal;
  try {
    journal = JSON.parse(raw) as Journal;
    if (typeof journal.manifest !== 'string') {
      throw new Error('no manifest');
    }
  } catch {
    throw new CliError(
      EXIT.user,
      `${JOURNAL} records an unfinished upgrade and cannot be read.`,
      'It holds the package.json and lockfile an interrupted run was about ' +
        'to change. Restore those two files from version control, then ' +
        'delete it.',
    );
  }

  report.step(
    `An upgrade from ${journal.from} to ${journal.to} did not finish; putting the project back…`,
  );
  await writeAtomic(join(projectDir, 'package.json'), journal.manifest);
  await writeAtomic(join(projectDir, 'package-lock.json'), journal.lock);
  if (runner !== undefined) {
    const back = await runner('npm', frozenInstallArgs(), { cwd: projectDir });
    if (back.code !== 0) {
      throw new CliError(
        EXIT.user,
        `Restored package.json and the lockfile to ${journal.from}, but reinstalling failed.`,
        `${lastLine(back.stderr, back.stdout)} — run \`npm ci\` to finish, ` +
          `then delete ${JOURNAL}.`,
      );
    }
  }
  await rm(path, { force: true });
}

/** The version of `mallok` actually present in `node_modules`. */
async function installedVersion(projectDir: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await readFile(
        join(projectDir, 'node_modules/mallok/package.json'),
        'utf8',
      ),
    ) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

const execFileAsync = promisify(execFile);

export interface UpgradeOptions {
  readonly to: string;
  readonly projectDir?: string;
  /** Report what would change; write nothing. */
  readonly dryRun?: boolean;
  /** Skip the project's typecheck, test, build and deploy dry-run. */
  readonly skipChecks?: boolean;
  readonly run?: CommandRunner;
}

export interface UpgradeResult {
  readonly from: string;
  readonly to: string;
  readonly changed: boolean;
  readonly checks: readonly string[];
}

/**
 * An exact version, not a range.
 *
 * Upgrading is a decision. A range would let an ordinary `npm install` move
 * the framework under a site that was working, at a moment nobody chose.
 */
function assertExactVersion(version: string): void {
  if (semver.valid(version) === null) {
    throw new CliError(
      EXIT.user,
      `"${version}" is not an exact version.`,
      'Write the version you mean, such as --to 0.1.0-rc.5. A range would ' +
        'let an install change the framework under a site that was working.',
    );
  }
}

/**
 * Compares two versions; negative when `a` is older.
 *
 * `semver.compare`, not a hand-rolled parse. The one this replaces compared
 * pre-release tags as strings, so `rc.10` sorted before `rc.2` and upgrading
 * from rc.2 to rc.10 was refused as a downgrade — a bug that shows up on a
 * release train's tenth candidate and not one release earlier.
 */
export function compareVersions(a: string, b: string): number {
  return semver.compare(a, b);
}

/** The version of `mallok` a project's manifest pins. */
export async function currentVersion(projectDir: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(projectDir, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  const version = manifest.dependencies?.mallok;
  if (version === undefined) {
    throw new CliError(
      EXIT.user,
      'This project does not depend on mallok.',
      'Run `mallok upgrade` from inside a project `mallok create` made.',
    );
  }
  return version;
}

/** Rewrites the exact dependency, leaving everything else in the manifest. */
async function setVersion(projectDir: string, version: string): Promise<void> {
  const path = join(projectDir, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  await writeFile(
    path,
    `${JSON.stringify(
      {
        ...manifest,
        dependencies: { ...manifest.dependencies, mallok: version },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/**
 * The checks a site runs against whatever `mallok` is installed.
 *
 * These are the project's own scripts, so they exercise the package that was
 * just installed — which is what makes them the target version's checks
 * rather than the old CLI's idea of them.
 */
const CHECKS: readonly string[] = ['typecheck', 'test', 'build'];

/**
 * Upgrades a project.
 *
 * The only state this touches is `package.json`, the lockfile and
 * `node_modules` — and all three are put back together if anything fails.
 */
export async function upgradeProject(
  options: UpgradeOptions,
  report: Reporter,
): Promise<UpgradeResult> {
  const projectDir = options.projectDir ?? process.cwd();
  assertExactVersion(options.to);
  await assertNpmProject(projectDir);
  if (!(await isMallokProject(projectDir))) {
    throw new CliError(
      EXIT.user,
      'This is not a Mallok project.',
      'Run `mallok upgrade` from the directory that holds wrangler.jsonc.',
    );
  }

  // An interrupted run is put back before anything else is considered.
  await recover(projectDir, report, options.run);

  const from = await currentVersion(projectDir);
  if (semver.valid(from) === null) {
    throw new CliError(
      EXIT.user,
      `This project's mallok dependency is "${from}", which is not an exact version.`,
      'Set it to the version the site is actually running before upgrading.',
    );
  }

  // The lockfile is not optional. The rollback restores it, and a rollback
  // that cannot restore what it never read leaves the manifest on the old
  // version beside a `node_modules` holding the new one — a project that
  // fails in a way nobody can read.
  const lockPath = join(projectDir, 'package-lock.json');
  // Read as text, not bytes: this project's types resolve `Buffer` through
  // `@cloudflare/workers-types`, whose `toString` takes no encoding. A
  // lockfile is UTF-8 JSON, so the round trip is exact.
  const lockBefore = await readFile(lockPath, 'utf8').catch(() => null);
  if (lockBefore === null) {
    throw new CliError(
      EXIT.user,
      'This project has no readable package-lock.json.',
      'An upgrade restores it if anything fails, so it has to be there and ' +
        'be readable first. Run `npm install` to produce one, commit it, and ' +
        'try again.',
    );
  }

  const direction = compareVersions(options.to, from);
  if (direction < 0) {
    throw new CliError(
      EXIT.user,
      `${options.to} is older than the ${from} this project is on.`,
      'Downgrading is refused: a release can migrate a database forward, and ' +
        'there is no general way back. If you need an older version, restore ' +
        'the project from version control.',
    );
  }
  if (direction === 0) {
    // "Already on that version" is checked in all three places, not read off
    // the manifest. A manifest saying 2.0.0 beside a lockfile and a
    // `node_modules` holding 1.0.0 is a run that was interrupted after the
    // manifest was written — a project that needs the install it never
    // finished, not one with nothing to do.
    //
    // And the comparison is **exact**, not `semver.compare`. Build metadata
    // is explicitly not precedence, so `1.0.0+build.1` and `1.0.0+build.2`
    // compare equal — and they are not the same artefact.
    const installed = await installedVersion(projectDir);
    const lockText = lockBefore;
    const settled =
      from === options.to &&
      installed === options.to &&
      lockText.includes(options.to);
    if (settled) {
      report.step(`Already on ${options.to}; nothing to do.`);
      return { from, to: options.to, changed: false, checks: [] };
    }
    report.step(
      `package.json says ${options.to}, but ${
        installed === null
          ? 'it is not installed'
          : `node_modules holds ${installed}`
      }; finishing the install…`,
    );
  }

  if (options.dryRun === true) {
    report.step(`Would set mallok to ${options.to} (currently ${from}).`);
    return { from, to: options.to, changed: false, checks: [] };
  }

  const runner = options.run;
  if (runner === undefined) {
    throw new CliError(EXIT.user, 'No command runner was provided.');
  }

  // What has to go back if anything fails. The lockfile is kept as bytes and
  // written back unchanged: an install rewrites it, and a project left with
  // the old manifest beside a new lockfile is a project whose next `npm ci`
  // installs something nobody asked for.
  const manifestPath = join(projectDir, 'package.json');
  const manifestBefore = await readFile(manifestPath, 'utf8');

  const release = await takeLock(projectDir);

  const restore = async (): Promise<void> => {
    report.step(`Restoring ${from}…`);
    await writeAtomic(manifestPath, manifestBefore);
    await writeAtomic(lockPath, lockBefore);
    // `ci`, not `install`: the restored lockfile is the record of what this
    // project was working with, and `install` is free to rewrite it. And the
    // tree is reinstalled rather than left alone — it holds the target at
    // this point, and files saying one version beside a tree holding another
    // fails in a way nobody can read.
    const back = await runner('npm', frozenInstallArgs(), { cwd: projectDir });
    if (back.code !== 0) {
      throw new CliError(
        EXIT.user,
        `Rolled back to ${from}, but reinstalling it failed.`,
        `${lastLine(back.stderr, back.stdout)} — package.json and the ` +
          'lockfile are back as they were; run `npm ci` to finish.',
      );
    }
    // What landed is checked rather than assumed: a `ci` that exits 0 having
    // installed something else is exactly the case a rollback must not sign
    // off on.
    const landed = await installedVersion(projectDir);
    if (landed !== null && landed !== from) {
      throw new CliError(
        EXIT.user,
        `Rolled back to ${from}, but node_modules now holds ${landed}.`,
        'package.json and the lockfile are back as they were. Run `npm ci` ' +
          'and check the result before deploying.',
      );
    }
  };

  const checks: string[] = [];
  try {
    // The journal goes down **before** the manifest changes, so a crash at
    // any point after this leaves a record of what was in flight.
    await writeAtomic(
      join(projectDir, JOURNAL),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          from,
          to: options.to,
          startedAt: new Date().toISOString(),
          manifest: manifestBefore,
          lock: lockBefore,
        } satisfies Journal,
        null,
        2,
      )}\n`,
    );

    report.step(`Setting mallok to ${options.to}…`);
    await setVersion(projectDir, options.to);

    report.step('Installing…');
    const install = await runner('npm', installArgs(), { cwd: projectDir });
    if (install.code !== 0) {
      throw new CliError(
        EXIT.user,
        `Installing mallok ${options.to} failed.`,
        lastLine(install.stderr, install.stdout),
      );
    }

    if (options.skipChecks !== true) {
      // These run against the package that was just installed, which is what
      // makes them the *target version's* checks rather than the old one's.
      for (const check of CHECKS) {
        report.step(`Checking ${check}…`);
        const result = await runner('npm', runArgs(check), {
          cwd: projectDir,
        });
        if (result.code !== 0) {
          throw new CliError(
            EXIT.user,
            `${check} failed on ${options.to}.`,
            lastLine(result.stderr, result.stdout),
          );
        }
        checks.push(check);
      }

      report.step('Checking the deploy would succeed…');
      const dryRun = await runner(
        projectWrangler(projectDir),
        ['deploy', '--dry-run'],
        { cwd: projectDir },
      );
      if (dryRun.code !== 0) {
        throw new CliError(
          EXIT.user,
          `The deploy dry-run failed on ${options.to}.`,
          lastLine(dryRun.stderr, dryRun.stdout),
        );
      }
      checks.push('deploy --dry-run');
    }
  } catch (error) {
    await restore();
    throw error;
  } finally {
    // The journal is the record of an *unfinished* change, so it goes once
    // the change has either finished or been undone. The lock goes with it.
    await rm(join(projectDir, JOURNAL), { force: true });
    await release();
  }

  return { from, to: options.to, changed: true, checks };
}

/** Runs a command, for callers that do not want to build a runner. */
export const nodeRunner: CommandRunner = async (command, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
};
