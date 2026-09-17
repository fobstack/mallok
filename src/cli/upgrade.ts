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
import { randomUUID } from 'node:crypto';
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

interface UpgradeLock {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly owner: string;
  readonly startedAt: string;
}

interface PackageLockState {
  readonly declared: string;
  readonly installed: string;
}

/**
 * Writes a file by creating a temporary one beside it and renaming.
 *
 * A rename within a directory is atomic, so a reader sees either the old file
 * or the new one — never a half-written journal, which is the one file that
 * must not be ambiguous.
 */
async function writeAtomic(path: string, body: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePackageLock(raw: string, label: string): PackageLockState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(
      EXIT.user,
      `${label} is not valid JSON.`,
      'Restore package-lock.json from version control or run `npm install` ' +
        'and review the result before upgrading.',
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed.packages)) {
    throw new CliError(
      EXIT.user,
      `${label} does not contain npm's packages map.`,
      'Mallok needs the root dependency and installed package recorded in ' +
        'package-lock.json before it can upgrade safely.',
    );
  }
  const root = parsed.packages[''];
  const installed = parsed.packages['node_modules/mallok'];
  if (!isRecord(root) || !isRecord(root.dependencies)) {
    throw new CliError(
      EXIT.user,
      `${label} does not record the root project's dependencies.`,
      'Run `npm install`, commit package-lock.json, and try again.',
    );
  }
  const declared = root.dependencies.mallok;
  const installedVersion = isRecord(installed) ? installed.version : undefined;
  if (typeof declared !== 'string' || typeof installedVersion !== 'string') {
    throw new CliError(
      EXIT.user,
      `${label} does not record both the declared and installed Mallok versions.`,
      'Run `npm install`, commit package-lock.json, and try again.',
    );
  }
  return { declared, installed: installedVersion };
}

function exactIsoDate(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function parseJournal(raw: string): Journal {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      typeof parsed.from !== 'string' ||
      semver.valid(parsed.from) === null ||
      typeof parsed.to !== 'string' ||
      semver.valid(parsed.to) === null ||
      typeof parsed.startedAt !== 'string' ||
      !exactIsoDate(parsed.startedAt) ||
      typeof parsed.manifest !== 'string' ||
      typeof parsed.lock !== 'string'
    ) {
      throw new Error('invalid journal schema');
    }
    const manifest = JSON.parse(parsed.manifest) as unknown;
    if (
      !isRecord(manifest) ||
      !isRecord(manifest.dependencies) ||
      manifest.dependencies.mallok !== parsed.from
    ) {
      throw new Error('invalid journal manifest');
    }
    const lock = parsePackageLock(
      parsed.lock,
      `The lockfile inside ${JOURNAL}`,
    );
    if (lock.declared !== parsed.from || lock.installed !== parsed.from) {
      throw new Error('journal lockfile disagrees with from');
    }
    return parsed as unknown as Journal;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      EXIT.user,
      `${JOURNAL} records an unfinished upgrade and cannot be trusted.`,
      'It must contain a complete versioned record and valid package.json ' +
        'and package-lock.json snapshots. Restore those files from version ' +
        `control, then delete ${JOURNAL}.`,
    );
  }
}

function parseUpgradeLock(raw: string): UpgradeLock | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      typeof parsed.pid !== 'number' ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.owner !== 'string' ||
      parsed.owner.length === 0 ||
      typeof parsed.startedAt !== 'string' ||
      !exactIsoDate(parsed.startedAt)
    ) {
      return null;
    }
    return parsed as unknown as UpgradeLock;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
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
  const owner = randomUUID();
  const ours: UpgradeLock = {
    schemaVersion: 1,
    pid: process.pid,
    owner,
    startedAt: new Date().toISOString(),
  };

  for (;;) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify(ours)}\n`);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(path, { force: true });
        throw error;
      }
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw readError;
      }
      const existing = parseUpgradeLock(raw);
      if (existing === null) {
        throw new CliError(
          EXIT.user,
          `${LOCK} exists but is not a valid Mallok upgrade lock.`,
          'Do not delete it while another upgrade may be running. Inspect ' +
            'the file and running processes first.',
        );
      }
      const alive = processIsAlive(existing.pid);
      throw new CliError(
        EXIT.user,
        alive
          ? 'Another upgrade is already running in this project.'
          : 'A previous upgrade left its lock behind.',
        alive
          ? `${LOCK} belongs to process ${existing.pid}. Wait for it to finish.`
          : `${LOCK} names process ${existing.pid}, which is no longer running. ` +
              'Inspect the journal and project state before removing the lock manually. ' +
              'Mallok will not reclaim it automatically because replacing a lock by path ' +
              'can race with a newly started upgrade.',
      );
    }
  }

  return async () => {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CliError(
          EXIT.user,
          `${LOCK} disappeared while this upgrade was running.`,
          'Mallok cannot prove it held exclusive access. Inspect the project ' +
            'before trying another upgrade.',
        );
      }
      throw error;
    }
    if (parseUpgradeLock(raw)?.owner !== owner) {
      throw new CliError(
        EXIT.user,
        `${LOCK} changed ownership while this upgrade was running.`,
        'Mallok left the lock in place. Inspect the project before trying again.',
      );
    }
    await rm(path);
  };
}

/** Puts back whatever an interrupted run was in the middle of changing. */
async function recover(
  projectDir: string,
  report: Reporter,
  runner: CommandRunner | undefined,
): Promise<void> {
  const path = join(projectDir, JOURNAL);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  const journal = parseJournal(raw);
  if (runner === undefined) {
    throw new CliError(
      EXIT.user,
      `${JOURNAL} records an unfinished upgrade that needs recovery.`,
      'Run this command through the Mallok CLI so it can reinstall the ' +
        'recorded version before continuing.',
    );
  }

  report.step(
    `An upgrade from ${journal.from} to ${journal.to} did not finish; putting the project back…`,
  );
  await writeAtomic(join(projectDir, 'package.json'), journal.manifest);
  await writeAtomic(join(projectDir, 'package-lock.json'), journal.lock);
  const back = await runner('npm', frozenInstallArgs(), { cwd: projectDir });
  if (back.code !== 0) {
    throw new CliError(
      EXIT.user,
      `Restored package.json and the lockfile to ${journal.from}, but reinstalling failed.`,
      `${lastLine(back.stderr, back.stdout)} — fix the install and retry; ` +
        `${JOURNAL} has been kept as the recovery record.`,
    );
  }
  await assertProjectVersion(projectDir, journal.from, 'Recovered project');
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

async function assertProjectVersion(
  projectDir: string,
  expected: string,
  label: string,
): Promise<void> {
  let declared: string;
  try {
    declared = await currentVersion(projectDir);
  } catch {
    throw new CliError(
      EXIT.user,
      `${label} does not have a readable Mallok dependency.`,
      `Expected package.json to pin mallok ${expected}.`,
    );
  }
  const lockRaw = await readFile(join(projectDir, 'package-lock.json'), 'utf8');
  const lock = parsePackageLock(lockRaw, `${label}'s package-lock.json`);
  const installed = await installedVersion(projectDir);
  if (
    declared !== expected ||
    lock.declared !== expected ||
    lock.installed !== expected ||
    installed !== expected
  ) {
    throw new CliError(
      EXIT.user,
      `${label} is not consistently on Mallok ${expected}.`,
      `package.json=${declared}, lock declaration=${lock.declared}, ` +
        `lock installation=${lock.installed}, node_modules=${installed ?? 'missing'}.`,
    );
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
  await writeAtomic(
    path,
    `${JSON.stringify(
      {
        ...manifest,
        dependencies: { ...manifest.dependencies, mallok: version },
      },
      null,
      2,
    )}\n`,
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
  if (!(await isMallokProject(projectDir))) {
    throw new CliError(
      EXIT.user,
      'This is not a Mallok project.',
      'Run `mallok upgrade` from the directory that holds wrangler.jsonc.',
    );
  }

  // Only the shape check above happens without the lock. Every read of
  // dependency state, including crash recovery, is serialized below.
  const release = await takeLock(projectDir);
  try {
    await assertNpmProject(projectDir);
    await recover(projectDir, report, options.run);

    const from = await currentVersion(projectDir);
    if (semver.valid(from) === null) {
      throw new CliError(
        EXIT.user,
        `This project's mallok dependency is "${from}", which is not an exact version.`,
        'Set it to the version the site is actually running before upgrading.',
      );
    }

    const lockPath = join(projectDir, 'package-lock.json');
    let lockBefore: string;
    try {
      lockBefore = await readFile(lockPath, 'utf8');
    } catch {
      throw new CliError(
        EXIT.user,
        'This project has no readable package-lock.json.',
        'An upgrade restores it if anything fails, so it has to be there and ' +
          'be readable first. Run `npm install` to produce one, commit it, and ' +
          'try again.',
      );
    }
    const lockBeforeState = parsePackageLock(
      lockBefore,
      "This project's package-lock.json",
    );

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
    const installedBefore = await installedVersion(projectDir);
    const baselineIsConsistent =
      lockBeforeState.declared === from &&
      lockBeforeState.installed === from &&
      installedBefore === from;
    if (direction === 0 && from === options.to && baselineIsConsistent) {
      report.step(`Already on ${options.to}; nothing to do.`);
      return { from, to: options.to, changed: false, checks: [] };
    }
    if (!baselineIsConsistent) {
      throw new CliError(
        EXIT.user,
        `This project is not consistently on Mallok ${from}.`,
        `package.json=${from}, lock declaration=${lockBeforeState.declared}, ` +
          `lock installation=${lockBeforeState.installed}, ` +
          `node_modules=${installedBefore ?? 'missing'}. Run \`npm ci\` or ` +
          'restore the project before upgrading.',
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

    const manifestPath = join(projectDir, 'package.json');
    const manifestBefore = await readFile(manifestPath, 'utf8');
    const journalPath = join(projectDir, JOURNAL);
    let transactionStarted = false;

    const restore = async (): Promise<void> => {
      report.step(`Restoring ${from}…`);
      await writeAtomic(manifestPath, manifestBefore);
      await writeAtomic(lockPath, lockBefore);
      const back = await runner('npm', frozenInstallArgs(), {
        cwd: projectDir,
      });
      if (back.code !== 0) {
        throw new CliError(
          EXIT.user,
          `Rolled back to ${from}, but reinstalling it failed.`,
          `${lastLine(back.stderr, back.stdout)} — the recovery journal was ` +
            'kept. Run `npm ci`, verify the old version, and retry the upgrade.',
        );
      }
      await assertProjectVersion(projectDir, from, 'Rolled-back project');
    };

    const checks: string[] = [];
    try {
      // Set before writing: if the atomic writer reports an unusual cleanup
      // error after its rename, restoring an unchanged baseline is harmless;
      // losing a journal that may exist is not.
      transactionStarted = true;
      await writeAtomic(
        journalPath,
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
      await assertProjectVersion(projectDir, options.to, 'Installed project');

      if (options.skipChecks !== true) {
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

      // Project scripts are allowed to do anything. Re-check the dependency
      // state before committing the transaction.
      await assertProjectVersion(projectDir, options.to, 'Upgraded project');
      await rm(journalPath);
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        await restore();
        await rm(journalPath);
        transactionStarted = false;
      }
      throw error;
    }

    return { from, to: options.to, changed: true, checks };
  } finally {
    await release();
  }
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
