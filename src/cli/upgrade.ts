/**
 * `mallok upgrade --to <exact-version>` — the supported way to move a site
 * onto a new Mallok.
 *
 * A site is a thin shell whose framework is one exact dependency, so an
 * upgrade is that number, an install, whatever *project* migrations the new
 * version needs, and the same checks `create` runs before it will deploy
 * anything. What it is not is a merge: nothing of Mallok's own source lives
 * in the project, so there is nothing to reconcile.
 *
 * Four properties, all tested against two real tarballs
 * (`test/cli/upgrade.test.ts`):
 *
 * - content, settings, theme choice and plugins survive untouched;
 * - each project migration runs **once**, recorded by id;
 * - running it again when already on that version changes nothing and exits 0;
 * - a failure leaves the project on the old version, not half-converted.
 *
 * Database schema migrations are deliberately **not** here. The Worker applies
 * those itself on its first request after a deploy, which is the only place
 * that can do it safely for a database it is already serving.
 */

import { copyFile, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandRunner, lastLine } from './cloudflare.js';
import { CliError, EXIT, type Reporter } from './output.js';
import {
  frozenInstallArgs,
  installArgs,
  LOCKFILES,
  type PackageManager,
  runArgs,
} from './package-manager.js';
import { isMallokProject, projectWrangler } from './template.js';

/** Where the record of applied project migrations lives. */
const HISTORY_FILE = '.mallok/upgrades.json';

/** What the history file holds. */
interface UpgradeHistory {
  readonly schemaVersion: number;
  /** Ids of migrations already applied, in the order they were applied. */
  readonly applied: readonly string[];
  readonly versions: readonly { from: string; to: string; at: string }[];
}

const EMPTY_HISTORY: UpgradeHistory = {
  schemaVersion: 1,
  applied: [],
  versions: [],
};

/**
 * A change to a **project's own files** that a release needs.
 *
 * Not a database migration and not a code change: those live in the package.
 * This is for the handful of things that live in the site's repository —
 * a renamed configuration key, a script that has to change.
 *
 * Each has a stable id, and the id is what makes it run once.
 */
export interface ProjectMigration {
  readonly id: string;
  readonly description: string;
  /** Applied in a working copy; returns true when it changed something. */
  readonly apply: (projectDir: string) => Promise<boolean>;
}

/**
 * Project migrations, oldest first.
 *
 * Empty in 0.1.0-rc.3: the shell is new, and inventing a migration to
 * demonstrate the mechanism would be a lie in the shape of a feature. The
 * mechanism itself is tested with a fixture migration.
 */
export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = [];

export interface UpgradeOptions {
  readonly to: string;
  readonly projectDir?: string;
  readonly packageManager?: PackageManager;
  /** Report what would change; write nothing. */
  readonly dryRun?: boolean;
  /** Skip lint, typecheck, test and the deploy dry-run. */
  readonly skipChecks?: boolean;
  readonly run?: CommandRunner;
  /** Injected in tests; defaults to the real list. */
  readonly migrations?: readonly ProjectMigration[];
}

export interface UpgradeResult {
  readonly from: string;
  readonly to: string;
  readonly changed: boolean;
  readonly migrationsApplied: readonly string[];
  readonly checks: readonly string[];
}

/** An exact version, not a range. */
function assertExactVersion(version: string): void {
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw new CliError(
      EXIT.user,
      `"${version}" is not an exact version.`,
      'Upgrading is a decision: write the version you mean, such as ' +
        '--to 0.1.0-rc.3. A range would let an install change the framework ' +
        'under a site that was working.',
    );
  }
}

async function readHistory(projectDir: string): Promise<UpgradeHistory> {
  try {
    const parsed = JSON.parse(
      await readFile(join(projectDir, HISTORY_FILE), 'utf8'),
    ) as UpgradeHistory;
    if (!Array.isArray(parsed.applied)) {
      throw new Error('no applied list');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_HISTORY;
    }
    // Fail closed, for the same reason the create ledger does: a migration
    // history that cannot be read is not an empty one, and re-applying a
    // migration is how a project ends up converted twice.
    throw new CliError(
      EXIT.user,
      `${HISTORY_FILE} could not be read.`,
      'It records which project migrations have already run. Repair it rather ' +
        'than deleting it.',
    );
  }
}

async function writeHistory(
  projectDir: string,
  history: UpgradeHistory,
): Promise<void> {
  const path = join(projectDir, HISTORY_FILE);
  const temporary = `${path}.tmp`;
  const { mkdir, rename } = await import('node:fs/promises');
  await mkdir(join(projectDir, '.mallok'), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
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
 * Upgrades a project.
 *
 * The work happens in place, but the two files that decide what the project
 * *is* — its manifest and its lockfile — are copied aside first and put back
 * if anything fails. A project left pinned to a version whose install failed
 * is a project that cannot build and cannot easily be explained.
 */
export async function upgradeProject(
  options: UpgradeOptions,
  report: Reporter,
): Promise<UpgradeResult> {
  const projectDir = options.projectDir ?? process.cwd();
  const manager = options.packageManager ?? 'npm';
  const migrations = options.migrations ?? PROJECT_MIGRATIONS;
  assertExactVersion(options.to);

  if (!(await isMallokProject(projectDir))) {
    throw new CliError(
      EXIT.user,
      'This is not a Mallok project.',
      'Run `mallok upgrade` from the directory that holds wrangler.jsonc.',
    );
  }

  const from = await currentVersion(projectDir);
  const history = await readHistory(projectDir);
  const pending = migrations.filter(
    (migration) => !history.applied.includes(migration.id),
  );

  if (from === options.to && pending.length === 0) {
    // Idempotent by design: the second run of the same upgrade is a no-op,
    // not a reinstall. Saying so is more useful than doing it again.
    report.step(`Already on ${options.to}; nothing to do.`);
    return {
      from,
      to: options.to,
      changed: false,
      migrationsApplied: [],
      checks: [],
    };
  }

  if (options.dryRun === true) {
    report.step(`Would set mallok to ${options.to} (currently ${from}).`);
    for (const migration of pending) {
      report.step(`  would apply ${migration.id}: ${migration.description}`);
    }
    return {
      from,
      to: options.to,
      changed: false,
      migrationsApplied: pending.map((migration) => migration.id),
      checks: [],
    };
  }

  const manifestPath = join(projectDir, 'package.json');
  const lockPath = join(projectDir, LOCKFILES[manager]);
  const backup = join(projectDir, '.mallok', 'upgrade-backup');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(backup, { recursive: true });
  await copyFile(manifestPath, join(backup, 'package.json'));
  await copyFile(lockPath, join(backup, LOCKFILES[manager])).catch(
    () => undefined,
  );

  const runner = options.run;
  if (runner === undefined) {
    throw new CliError(EXIT.user, 'No command runner was provided.');
  }

  const applied: string[] = [];
  const checks: string[] = [];
  try {
    report.step(`Setting mallok to ${options.to}…`);
    await setVersion(projectDir, options.to);

    report.step('Installing…');
    const install = await runner(manager, installArgs(manager), {
      cwd: projectDir,
    });
    if (install.code !== 0) {
      throw new CliError(
        EXIT.user,
        `Installing mallok ${options.to} failed.`,
        lastLine(install.stderr, install.stdout),
      );
    }

    for (const migration of pending) {
      report.step(`Applying ${migration.id}: ${migration.description}…`);
      await migration.apply(projectDir);
      applied.push(migration.id);
    }

    if (options.skipChecks !== true) {
      // Lint is deliberately not here. It checks the site's own formatting,
      // which the site owns and which says nothing about whether the upgrade
      // worked — failing someone's upgrade because their JSON is indented
      // differently from the formatter's preference is hostile. What is
      // checked is whether the site still type-checks, tests, builds and
      // would deploy against the new framework.
      for (const [label, command, args] of [
        ['typecheck', manager, runArgs(manager, 'typecheck')],
        ['test', manager, runArgs(manager, 'test')],
        ['build', manager, runArgs(manager, 'build')],
        [
          'deploy --dry-run',
          projectWrangler(projectDir),
          ['deploy', '--dry-run', '--outdir', 'dist/worker-upgrade'],
        ],
      ] as const) {
        report.step(`Checking ${label}…`);
        const result = await runner(command, args, { cwd: projectDir });
        if (result.code !== 0) {
          throw new CliError(
            EXIT.user,
            `${label} failed after the upgrade.`,
            lastLine(result.stderr, result.stdout),
          );
        }
        checks.push(label);
      }
    }

    await writeHistory(projectDir, {
      schemaVersion: 1,
      applied: [...history.applied, ...applied],
      versions: [
        ...history.versions,
        { from, to: options.to, at: new Date().toISOString() },
      ],
    });
  } catch (error) {
    // Put the project back where it was. The installed `node_modules` may now
    // hold the new version, but the manifest and lockfile decide what the
    // project *is*, and a re-install restores the rest.
    report.warn('The upgrade failed; restoring package.json and the lockfile.');
    await copyFile(join(backup, 'package.json'), manifestPath).catch(
      () => undefined,
    );
    await copyFile(join(backup, LOCKFILES[manager]), lockPath).catch(
      () => undefined,
    );
    await runner(manager, frozenInstallArgs(manager), {
      cwd: projectDir,
    }).catch(() => undefined);
    throw error;
  } finally {
    await rm(backup, { recursive: true, force: true });
  }

  return {
    from,
    to: options.to,
    changed: true,
    migrationsApplied: applied,
    checks,
  };
}

/** Used by the tests: a working copy of a project, for a failure rehearsal. */
export async function copyProject(from: string, to: string): Promise<void> {
  await cp(from, to, { recursive: true });
}
