/**
 * `mallok upgrade --to <exact-version>` — the supported way to move a site
 * onto a new Mallok.
 *
 * Two things make this more than "edit a version and install".
 *
 * **The target version runs its own migrations.** The previous design read
 * the migration list the *old* CLI was compiled with, installed the new
 * package, and then applied that old list — so a migration introduced by the
 * release being upgraded to would never run, on that upgrade or any later
 * one. The old CLI now prepares an isolated copy, installs the target there,
 * and hands control to the target's own binary through a documented internal
 * command (`upgrade-finalize`). Whatever that release knows about, it applies.
 *
 * **Nothing touches the real project until everything has passed.** The
 * install, the migrations and the checks all happen in a copy. On success the
 * copy is moved into place; on failure it is deleted and the project is
 * exactly as it was, byte for byte. A migration that half-rewrites a file and
 * then fails a type check cannot leave a site in that state.
 *
 * Database schema migrations are deliberately elsewhere: the Worker applies
 * those on its first request after a deploy, which is the only place that can
 * do it safely for a database it is already serving.
 */

import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type CommandRunner, lastLine } from './cloudflare.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { assertNpmProject, installArgs, runArgs } from './package-manager.js';
import { isMallokProject, projectWrangler } from './template.js';

const execFileAsync = promisify(execFile);

/**
 * Where the record of applied project migrations lives.
 *
 * **Tracked by Git**, unlike `.mallok/`, which is ignored because it holds
 * resource names and an account id. A migration record kept there is a record
 * the next person to clone the project does not have, and "exactly once" then
 * means "once per working copy" — which is not what anybody means by it.
 */
const STATE_FILE = 'mallok.json';

/** The shape of that file. */
interface ProjectState {
  readonly schemaVersion: number;
  /** Ids of project migrations already applied, oldest first. */
  readonly appliedMigrations: readonly string[];
  readonly history: readonly { from: string; to: string; at: string }[];
}

const EMPTY_STATE: ProjectState = {
  schemaVersion: 1,
  appliedMigrations: [],
  history: [],
};

/**
 * A change to a **project's own files** that a release needs.
 *
 * Not a database migration and not a code change: those live in the package.
 * This is for the handful of things that live in the site's repository — a
 * renamed configuration key, a script that has to change.
 *
 * Two rules for writing one:
 *
 * - it must be **idempotent**, deciding from the project's current state
 *   rather than assuming it has never run. The recorded id is the first line
 *   of defence and a checkout without the record is the reason it is not the
 *   only one;
 * - it must not depend on anything outside the project directory it is given.
 */
export interface ProjectMigration {
  readonly id: string;
  readonly description: string;
  /** Applied to a working copy; returns true when it changed something. */
  readonly apply: (projectDir: string) => Promise<boolean>;
}

/**
 * Project migrations this release carries, oldest first.
 *
 * Empty in 0.1.0-rc.4: the project shell is new, and inventing a migration to
 * demonstrate the mechanism would be a lie in the shape of a feature. The
 * mechanism is exercised by `test/cli/upgrade-target-owned.test.ts`, which
 * builds a second package that declares one here.
 */
export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = [];

export interface UpgradeOptions {
  readonly to: string;
  readonly projectDir?: string;
  /** Report what would change; write nothing. */
  readonly dryRun?: boolean;
  /** Skip typecheck, test, build and the deploy dry-run. */
  readonly skipChecks?: boolean;
  readonly run?: CommandRunner;
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
        '--to 0.1.0-rc.4. A range would let an install change the framework ' +
        'under a site that was working.',
    );
  }
}

/** Compares two semver-ish versions; negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = '', pre = ''] = version.split('-', 2);
    return {
      numbers: core.split('.').map((part) => Number(part) || 0),
      pre,
    };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index++) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  // A release is newer than any of its pre-releases; otherwise compare them
  // as strings, which orders rc.2 before rc.3 and is enough here.
  if (left.pre === right.pre) {
    return 0;
  }
  if (left.pre === '') {
    return 1;
  }
  if (right.pre === '') {
    return -1;
  }
  return left.pre < right.pre ? -1 : 1;
}

export async function readProjectState(
  projectDir: string,
): Promise<ProjectState> {
  try {
    const parsed = JSON.parse(
      await readFile(join(projectDir, STATE_FILE), 'utf8'),
    ) as ProjectState;
    if (!Array.isArray(parsed.appliedMigrations)) {
      throw new Error('no appliedMigrations');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_STATE;
    }
    // Fail closed, for the same reason the create ledger does: a migration
    // record that cannot be read is not an empty one, and re-applying a
    // migration is how a project gets converted twice.
    throw new CliError(
      EXIT.user,
      `${STATE_FILE} could not be read.`,
      'It records which project migrations have already run. Repair it ' +
        'rather than deleting it.',
    );
  }
}

async function writeProjectState(
  projectDir: string,
  state: ProjectState,
): Promise<void> {
  await writeFile(
    join(projectDir, STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
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
 * What `upgrade-finalize` prints, and the only thing the old CLI reads from
 * it.
 *
 * This is the protocol between two versions of Mallok, so it is small,
 * explicit and versioned: the old CLI must be able to understand a newer
 * release's answer, and a newer release must be able to tell an old CLI that
 * it cannot.
 */
export interface FinalizeReport {
  readonly protocol: 1;
  readonly ok: boolean;
  readonly version: string;
  readonly migrationsApplied: readonly string[];
  readonly checks: readonly string[];
  readonly error?: string;
}

/**
 * Upgrades a project.
 *
 * Everything happens in a copy; the real project is replaced only after the
 * target version has applied its own migrations and the whole gate has
 * passed.
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

  const from = await currentVersion(projectDir);
  const direction = compareVersions(options.to, from);
  if (direction < 0) {
    throw new CliError(
      EXIT.user,
      `${options.to} is older than the ${from} this project is on.`,
      'Downgrading is refused: a release can migrate a project or a database ' +
        'forward, and there is no general way back. If you need an older ' +
        'version, restore the project from version control.',
    );
  }
  if (direction === 0) {
    // Idempotent by design. The target still gets to decide whether it has
    // migrations outstanding, but there is nothing to install.
    const state = await readProjectState(projectDir);
    const pending = await pendingFor(projectDir, state);
    if (pending.length === 0) {
      report.step(`Already on ${options.to}; nothing to do.`);
      return {
        from,
        to: options.to,
        changed: false,
        migrationsApplied: [],
        checks: [],
      };
    }
  }

  if (options.dryRun === true) {
    report.step(`Would set mallok to ${options.to} (currently ${from}).`);
    report.step(
      "  and hand over to that version's own `upgrade-finalize`, which " +
        'applies whatever migrations it carries.',
    );
    return {
      from,
      to: options.to,
      changed: false,
      migrationsApplied: [],
      checks: [],
    };
  }

  const runner = options.run;
  if (runner === undefined) {
    throw new CliError(EXIT.user, 'No command runner was provided.');
  }

  // ---- An isolated copy ---------------------------------------------------
  const staging = await mkdtemp(join(tmpdir(), 'mallok-upgrade-'));
  const copy = join(staging, 'project');
  report.step('Preparing an isolated copy of the project…');
  await cp(projectDir, copy, {
    recursive: true,
    // `node_modules` is reinstalled from the manifest, and copying it would
    // be both slow and misleading.
    filter: (source) => !source.includes(`${projectDir}/node_modules`),
  });

  try {
    report.step(`Setting mallok to ${options.to}…`);
    await setVersion(copy, options.to);

    report.step('Installing…');
    const install = await runner('npm', installArgs(), { cwd: copy });
    if (install.code !== 0) {
      throw new CliError(
        EXIT.user,
        `Installing mallok ${options.to} failed.`,
        lastLine(install.stderr, install.stdout),
      );
    }

    // ---- The target version takes over ------------------------------------
    report.step(`Handing over to mallok ${options.to}…`);
    const finalize = await runner(
      join(copy, 'node_modules/.bin/mallok'),
      [
        'upgrade-finalize',
        '--from',
        from,
        '--to',
        options.to,
        ...(options.skipChecks === true ? ['--skip-checks'] : []),
        '--json',
      ],
      { cwd: copy },
    );
    const parsed = parseFinalize(finalize.stdout);
    if (finalize.code !== 0 || parsed === null || !parsed.ok) {
      throw new CliError(
        EXIT.user,
        `mallok ${options.to} could not finish the upgrade.`,
        parsed?.error ?? lastLine(finalize.stderr, finalize.stdout),
      );
    }

    // ---- Commit -------------------------------------------------------------
    //
    // The copy replaces the project only now. Its `node_modules` is the one
    // the checks ran against, so it comes along.
    report.step('Applying the upgrade…');
    const previous = join(staging, 'previous');
    await rename(projectDir, previous);
    try {
      await rename(copy, projectDir);
    } catch (error) {
      // Put the project back before giving up: a failed rename here would
      // otherwise leave no project at all.
      await rename(previous, projectDir);
      throw error;
    }

    return {
      from,
      to: options.to,
      changed: true,
      migrationsApplied: parsed.migrationsApplied,
      checks: parsed.checks,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function parseFinalize(stdout: string): FinalizeReport | null {
  const start = stdout.indexOf('{');
  if (start === -1) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout.slice(start)) as FinalizeReport;
    return parsed.protocol === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/** Migrations this version carries that the project has not recorded. */
async function pendingFor(
  projectDir: string,
  state: ProjectState,
  migrations: readonly ProjectMigration[] = PROJECT_MIGRATIONS,
): Promise<ProjectMigration[]> {
  void projectDir;
  return migrations.filter(
    (migration) => !state.appliedMigrations.includes(migration.id),
  );
}

export interface FinalizeOptions {
  readonly from: string;
  readonly to: string;
  readonly projectDir?: string;
  readonly skipChecks?: boolean;
  readonly run?: CommandRunner;
  /** Injected in tests; defaults to this version's own list. */
  readonly migrations?: readonly ProjectMigration[];
}

/**
 * `mallok upgrade-finalize` — the target version's half of an upgrade.
 *
 * Run **by the newly installed package**, inside a copy of the project, by
 * the older CLI that started the upgrade. It applies the migrations this
 * release carries and runs the project's own gate, then reports both as JSON
 * on stdout.
 *
 * It is not a command anybody types. It is documented because a protocol
 * between two versions has to be, and because the alternative — an old binary
 * guessing what a new release needs — is what this replaces.
 */
export async function finalizeUpgrade(
  options: FinalizeOptions,
  report: Reporter,
): Promise<FinalizeReport> {
  const projectDir = options.projectDir ?? process.cwd();
  const migrations = options.migrations ?? PROJECT_MIGRATIONS;
  const runner = options.run;
  if (runner === undefined) {
    throw new CliError(EXIT.user, 'No command runner was provided.');
  }

  const state = await readProjectState(projectDir);
  const pending = await pendingFor(projectDir, state, migrations);
  const applied: string[] = [];
  const checks: string[] = [];

  for (const migration of pending) {
    report.step(`Applying ${migration.id}: ${migration.description}…`);
    await migration.apply(projectDir);
    applied.push(migration.id);
  }

  await writeProjectState(projectDir, {
    schemaVersion: 1,
    appliedMigrations: [...state.appliedMigrations, ...applied],
    history: [
      ...state.history,
      { from: options.from, to: options.to, at: new Date().toISOString() },
    ],
  });

  if (options.skipChecks !== true) {
    // Lint is deliberately absent: it examines the site's own formatting,
    // which the site owns, and failing an upgrade over indentation is
    // hostile. These four are about whether the site still works.
    for (const [label, command, args] of [
      ['typecheck', 'npm', runArgs('typecheck')],
      ['test', 'npm', runArgs('test')],
      ['build', 'npm', runArgs('build')],
      [
        'deploy --dry-run',
        projectWrangler(projectDir),
        ['deploy', '--dry-run', '--outdir', 'dist/worker-upgrade'],
      ],
    ] as const) {
      report.step(`Checking ${label}…`);
      const result = await runner(command, args, { cwd: projectDir });
      if (result.code !== 0) {
        return {
          protocol: 1,
          ok: false,
          version: options.to,
          migrationsApplied: applied,
          checks,
          error: `${label} failed after the upgrade: ${lastLine(result.stderr, result.stdout)}`,
        };
      }
      checks.push(label);
    }
  }

  return {
    protocol: 1,
    ok: true,
    version: options.to,
    migrationsApplied: applied,
    checks,
  };
}

/** Used by the tests: a working copy of a project, for a failure rehearsal. */
export async function copyProject(from: string, to: string): Promise<void> {
  await cp(from, to, { recursive: true });
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
