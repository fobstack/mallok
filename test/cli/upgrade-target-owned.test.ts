import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ESM script, deliberately dependency-free.
import { startLocalRegistry } from '../../scripts/local-registry.mjs';
import { buildVariant, type Variant } from './helpers/build-variant.js';

const execFileAsync = promisify(execFile);

/**
 * Whose migrations run during an upgrade.
 *
 * The answer has to be **the target version's**, and the previous
 * implementation could not give it: the old CLI read its own compiled-in
 * `PROJECT_MIGRATIONS`, then installed the new package, then applied that old
 * list. A migration introduced by the release being upgraded *to* would never
 * run — not on the upgrade that introduced it, not ever.
 *
 * These two packages are built from two real source trees. `A` is this
 * repository's code; `B` is the same code plus a migration declared in
 * `src/cli/upgrade.ts`, which is exactly where a real release would declare
 * one. The upgrade is driven by **A's** published binary.
 */

const A = '9.8.0';
const B = '9.8.1';

let first: Variant;
let second: Variant;
let registry: { origin: string; close: () => Promise<void> } | null = null;
let sandbox = '';
let project = '';

function cleanEnvironment(
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith('VITEST') ||
      key.startsWith('npm_') ||
      key === 'NODE_PATH' ||
      key === 'NODE_OPTIONS'
    ) {
      delete environment[key];
    }
  }
  return { ...environment, ...extra };
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  extra: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env: cleanEnvironment(extra),
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
}

beforeAll(async () => {
  [first, second] = await Promise.all([
    buildVariant(A, { withMigration: false }),
    buildVariant(B, { withMigration: true }),
  ]);
  registry = await startLocalRegistry([
    { name: 'mallok', version: A, path: first.tarball },
    { name: 'mallok', version: B, path: second.tarball },
  ]);

  sandbox = await mkdtemp(join(tmpdir(), 'mallok-target-'));
  const installed = await run('npm', ['install', first.tarball], sandbox);
  expect(installed.code, installed.stderr).toBe(0);

  const created = await run(
    join(sandbox, 'node_modules/.bin/mallok'),
    ['create', 'my-site', '--no-deploy'],
    sandbox,
    { npm_config_registry: registry?.origin ?? '' },
  );
  expect(created.code, created.stdout + created.stderr).toBe(0);
  project = join(sandbox, 'my-site');
}, 1_800_000);

afterAll(async () => {
  await registry?.close();
  for (const path of [sandbox, first?.root, second?.root]) {
    if (path !== undefined && path !== '') {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe('the two packages are genuinely different', () => {
  it('only the newer one declares the migration', async () => {
    const [older, newer] = await Promise.all([
      run('tar', ['-xzOf', first.tarball, 'package/cli/index.js'], sandbox),
      run('tar', ['-xzOf', second.tarball, 'package/cli/index.js'], sandbox),
    ]);

    expect(older.stdout).not.toContain('2026-09-12-target-owned');
    expect(newer.stdout).toContain('2026-09-12-target-owned');
    // And their bundles differ, so this is not one build wearing two labels.
    expect(older.stdout).not.toBe(newer.stdout);
  });
});

describe('upgrading from A to B with A’s binary', () => {
  it('runs the migration B introduced, on the upgrade that introduces it', async () => {
    const upgraded = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', B],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );
    expect(upgraded.code, upgraded.stdout + upgraded.stderr).toBe(0);

    // The migration wrote this. Nothing in A knows the file's name.
    await expect(
      stat(join(project, 'migrated-by-target.txt')),
    ).resolves.toBeDefined();

    const manifest = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe(B);
  }, 900_000);

  it('records it where a clone can see it', async () => {
    // `.mallok/` is git-ignored, so a record kept there is a record the next
    // person to clone this project does not have — and "exactly once" across
    // machines then means nothing.
    const state = JSON.parse(
      await readFile(join(project, 'mallok.json'), 'utf8'),
    ) as { appliedMigrations: string[] };

    expect(state.appliedMigrations).toContain('2026-09-12-target-owned');

    const ignored = await readFile(join(project, '.gitignore'), 'utf8');
    expect(ignored).not.toMatch(/^mallok\.json$/m);
  });

  it('does not run it again', async () => {
    const before = await readFile(
      join(project, 'migrated-by-target.txt'),
      'utf8',
    );
    await writeFile(
      join(project, 'migrated-by-target.txt'),
      `${before}edited by the site owner\n`,
      'utf8',
    );

    const again = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', B, '--json'],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );

    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).changed).toBe(false);
    // The edit survives, which it would not if the migration had re-run.
    expect(
      await readFile(join(project, 'migrated-by-target.txt'), 'utf8'),
    ).toContain('edited by the site owner');
  }, 600_000);

  it('refuses to go backwards', async () => {
    const downgrade = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', A],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );

    expect(downgrade.code).not.toBe(0);
    expect(downgrade.stderr).toMatch(/older|downgrade/i);
    // Still on B.
    const manifest = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe(B);
  }, 300_000);
});

/**
 * What is left behind when an upgrade fails.
 *
 * A project migration edits the site's own files. If a check then fails, the
 * previous design left those edits in place: a site pinned to a new version
 * whose type-check fails, with files half-converted and no record of which
 * ones. Everything now happens in a copy that is thrown away, so the answer
 * is "nothing" — and "nothing" is checked byte for byte.
 */
describe('a failed upgrade leaves the project exactly as it was', () => {
  it('restores every file, including the ones a migration would have changed', async () => {
    const before = await snapshot(project);

    // A version the registry does not have: the install fails after the copy
    // has been made and the manifest in it rewritten.
    const failed = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', '9.8.99'],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );
    expect(failed.code).not.toBe(0);

    const after = await snapshot(project);
    expect(after).toEqual(before);
  }, 900_000);

  it('keeps the migration history it had', async () => {
    const state = JSON.parse(
      await readFile(join(project, 'mallok.json'), 'utf8'),
    ) as { appliedMigrations: string[] };

    expect(state.appliedMigrations).toContain('2026-09-12-target-owned');
  });

  it('can still be upgraded afterwards', async () => {
    // The retry is the point: a failure that poisons the project is worse
    // than the failure.
    const again = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', B, '--json'],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );

    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).changed).toBe(false);
  }, 600_000);
});

/** Every tracked file in a project, with its bytes, for comparison. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const { readdir } = await import('node:fs/promises');
  const out: Record<string, string> = {};
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      // `node_modules` is reinstalled rather than preserved, and `dist` and
      // `.wrangler` are build output: none of the three is the site.
      if (['node_modules', 'dist', '.wrangler'].includes(entry.name)) {
        continue;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path, `${prefix}${entry.name}/`);
      } else {
        out[`${prefix}${entry.name}`] = await readFile(path, 'utf8');
      }
    }
  };
  await walk(dir, '');
  return out;
}
