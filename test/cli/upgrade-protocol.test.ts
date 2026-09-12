import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError, makeReporter } from '../../src/cli/output.js';
import {
  compareVersions,
  type FinalizeReport,
  readProjectState,
  upgradeProject,
} from '../../src/cli/upgrade.js';

/**
 * The half of an upgrade the **old** CLI runs.
 *
 * `test/cli/upgrade-target-owned.test.ts` proves the whole thing with two
 * packages built from two source trees, and it takes a quarter of an hour —
 * so it lives in its own project and is not what runs on every change. What
 * is here instead is the orchestration: the refusals that happen before
 * anything is copied, the handover protocol, and what is left behind when the
 * target version says no.
 *
 * The runner is a fake. That is the point: `npm install` and the target's own
 * binary are the two things this code must drive correctly, and driving them
 * for real is the other file's job.
 */

const report = makeReporter(true, true);

let workspace = '';

/** A project shell with just enough for `upgradeProject` to accept it. */
async function project(version = '1.0.0'): Promise<string> {
  const dir = join(workspace, 'site');
  await mkdir(join(dir, 'src/worker'), { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'my-site',
      private: true,
      dependencies: { mallok: version },
    }),
    'utf8',
  );
  await writeFile(join(dir, 'package-lock.json'), '{}', 'utf8');
  await writeFile(join(dir, 'wrangler.jsonc'), '{}', 'utf8');
  await writeFile(join(dir, 'src/worker/index.ts'), '// site\n', 'utf8');
  await writeFile(join(dir, 'content.md'), 'the site’s own words\n', 'utf8');
  return dir;
}

/**
 * A runner standing in for `npm install` and the target's `upgrade-finalize`.
 *
 * `finalize` is what the newer Mallok would print. Returning `null` models a
 * version too old to understand the protocol at all — it prints nothing a
 * caller can parse, which must be a failure and not a silent success.
 */
function runner(options: {
  installFails?: boolean;
  finalize?: Partial<FinalizeReport> | null;
  noise?: string;
}) {
  const calls: string[] = [];
  return {
    calls,
    run: async (command: string, args: readonly string[]) => {
      calls.push(`${command.split('/').pop()} ${args.join(' ')}`);
      if (args[0] === 'install' || args[0] === 'ci') {
        return options.installFails === true
          ? { code: 1, stdout: '', stderr: 'ENOTFOUND registry.npmjs.org' }
          : { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'upgrade-finalize') {
        if (options.finalize === null) {
          return { code: 1, stdout: 'usage: mallok <command>', stderr: '' };
        }
        const body: FinalizeReport = {
          protocol: 1,
          ok: true,
          version: '2.0.0',
          migrationsApplied: [],
          checks: ['typecheck', 'test', 'build'],
          ...options.finalize,
        };
        return {
          code: body.ok ? 0 : 1,
          // Real output has progress before the JSON; the parser has to find
          // it rather than assume the whole stream is the report.
          stdout: `${options.noise ?? ''}${JSON.stringify(body)}\n`,
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-upgrade-protocol-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('comparing versions', () => {
  it('orders releases, and a release above its own pre-releases', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    // The one that matters for a release train: rc.3 → rc.4 → the release.
    expect(compareVersions('0.1.0-rc.4', '0.1.0-rc.3')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0-rc.4')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-rc.4', '0.1.0')).toBeLessThan(0);
  });
});

describe('what is refused before anything is copied', () => {
  it('a range, rather than a version', async () => {
    const dir = await project();
    const fake = runner({});

    for (const version of ['^2.0.0', 'latest', '2.0', 'next', '']) {
      await expect(
        upgradeProject({ to: version, projectDir: dir, run: fake.run }, report),
        version,
      ).rejects.toThrow(/exact version/);
    }
    expect(fake.calls).toEqual([]);
  });

  it('going backwards', async () => {
    // A release can migrate a project forward; there is no general way back,
    // so this refuses rather than leaving a half-converted project on an old
    // version that no longer understands it.
    const dir = await project('2.0.0');
    const fake = runner({});

    await expect(
      upgradeProject({ to: '1.0.0', projectDir: dir, run: fake.run }, report),
    ).rejects.toThrow(/older than/);
    expect(fake.calls).toEqual([]);
  });

  it('a directory that is not a Mallok project', async () => {
    const dir = join(workspace, 'elsewhere');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { mallok: '1.0.0' } }),
      'utf8',
    );
    await writeFile(join(dir, 'package-lock.json'), '{}', 'utf8');

    await expect(
      upgradeProject(
        { to: '2.0.0', projectDir: dir, run: runner({}).run },
        report,
      ),
    ).rejects.toThrow(/not a Mallok project/);
  });

  it('a project that does not depend on mallok at all', async () => {
    const dir = await project();
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'my-site', dependencies: {} }),
      'utf8',
    );

    await expect(
      upgradeProject(
        { to: '2.0.0', projectDir: dir, run: runner({}).run },
        report,
      ),
    ).rejects.toThrow(/does not depend on mallok/);
  });

  it('a project holding another package manager’s lockfile', async () => {
    // Installing npm's tree beside a pnpm lockfile leaves a project whose
    // lockfile no longer describes what is installed.
    const dir = await project();
    await writeFile(
      join(dir, 'pnpm-lock.yaml'),
      'lockfileVersion: 9\n',
      'utf8',
    );

    await expect(
      upgradeProject(
        { to: '2.0.0', projectDir: dir, run: runner({}).run },
        report,
      ),
    ).rejects.toThrow();
  });
});

describe('upgrading to the version already installed', () => {
  it('changes nothing and says so', async () => {
    const dir = await project('2.0.0');
    const fake = runner({});

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(false);
    expect(result.migrationsApplied).toEqual([]);
    // Nothing was installed and nothing was handed over: there is nothing to
    // install, and this release carries no outstanding project migrations.
    expect(fake.calls).toEqual([]);
  });
});

describe('a dry run', () => {
  it('reports the move and writes nothing', async () => {
    const dir = await project('1.0.0');
    const fake = runner({});

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, dryRun: true, run: fake.run },
      report,
    );

    expect(result).toMatchObject({
      from: '1.0.0',
      to: '2.0.0',
      changed: false,
    });
    expect(fake.calls).toEqual([]);
    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe('1.0.0');
  });
});

describe('the handover to the target version', () => {
  it('asks the installed target to finish, and takes its answer', async () => {
    const dir = await project('1.0.0');
    const fake = runner({
      finalize: { migrationsApplied: ['2026-09-12-example'] },
      // Progress lines before the JSON, as a real run has.
      noise: 'Applying 2026-09-12-example…\nChecking typecheck…\n',
    });

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(true);
    expect(result.migrationsApplied).toEqual(['2026-09-12-example']);
    expect(result.checks).toEqual(['typecheck', 'test', 'build']);

    // The binary that ran is the **target's**, from the copy's own
    // node_modules — not this CLI, which knows nothing about 2.0.0's
    // migrations.
    const handover = fake.calls.find((call) =>
      call.includes('upgrade-finalize'),
    );
    expect(handover).toContain(
      'mallok upgrade-finalize --from 1.0.0 --to 2.0.0',
    );

    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe('2.0.0');
  });

  it('passes --skip-checks through when asked', async () => {
    const dir = await project('1.0.0');
    const fake = runner({});

    await upgradeProject(
      { to: '2.0.0', projectDir: dir, skipChecks: true, run: fake.run },
      report,
    );

    expect(
      fake.calls.find((call) => call.includes('upgrade-finalize')),
    ).toContain('--skip-checks');
  });

  it('needs a command runner', async () => {
    const dir = await project('1.0.0');

    await expect(
      upgradeProject({ to: '2.0.0', projectDir: dir }, report),
    ).rejects.toThrow(/command runner/);
  });
});

describe('when the upgrade fails, the project is untouched', () => {
  /** Every file in the project, with its bytes. */
  async function snapshot(dir: string): Promise<Record<string, string>> {
    const { readdir } = await import('node:fs/promises');
    const out: Record<string, string> = {};
    const walk = async (current: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
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

  it('when the install fails', async () => {
    const dir = await project('1.0.0');
    const before = await snapshot(dir);

    await expect(
      upgradeProject(
        {
          to: '2.0.0',
          projectDir: dir,
          run: runner({ installFails: true }).run,
        },
        report,
      ),
    ).rejects.toThrow(/Installing mallok 2.0.0 failed/);

    expect(await snapshot(dir)).toEqual(before);
  });

  it('when the target reports a failed check', async () => {
    // The manifest in the copy was already rewritten and the migrations may
    // already have edited files there. None of that reaches the project,
    // because all of it happened somewhere that is now deleted.
    const dir = await project('1.0.0');
    const before = await snapshot(dir);

    const error = await upgradeProject(
      {
        to: '2.0.0',
        projectDir: dir,
        run: runner({
          finalize: { ok: false, error: 'typecheck failed' },
        }).run,
      },
      report,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/could not finish the upgrade/);
    // The target's own reason, carried back to the person who ran the old
    // CLI. Without it they would be told only that "something" failed inside
    // a directory that has since been deleted.
    expect((error as CliError).hint).toBe('typecheck failed');

    expect(await snapshot(dir)).toEqual(before);
  });

  it('when the target is too old to understand the protocol', async () => {
    // An older binary prints usage, not a report. "Could not parse an answer"
    // has to be a failure: treating it as success would commit a copy nobody
    // migrated or checked.
    const dir = await project('1.0.0');
    const before = await snapshot(dir);

    await expect(
      upgradeProject(
        { to: '2.0.0', projectDir: dir, run: runner({ finalize: null }).run },
        report,
      ),
    ).rejects.toThrow(/could not finish the upgrade/);

    expect(await snapshot(dir)).toEqual(before);
  });
});

describe('the migration record a clone can see', () => {
  it('is absent before any upgrade, and is not an error', async () => {
    const dir = await project();

    expect(await readProjectState(dir)).toEqual({
      schemaVersion: 1,
      appliedMigrations: [],
      history: [],
    });
  });

  it('refuses to read a corrupt one rather than treating it as empty', async () => {
    // Fail closed, like the create ledger: a record that cannot be read is
    // not an empty record, and reading it as empty is how a project gets
    // migrated twice.
    const dir = await project();
    await writeFile(join(dir, 'mallok.json'), '{ not json', 'utf8');

    await expect(readProjectState(dir)).rejects.toThrow(/could not be read/);
  });

  it('refuses one that has lost its migration list', async () => {
    const dir = await project();
    await writeFile(
      join(dir, 'mallok.json'),
      JSON.stringify({ schemaVersion: 1 }),
      'utf8',
    );

    await expect(readProjectState(dir)).rejects.toThrow(/could not be read/);
  });

  it('survives the upgrade that carried it', async () => {
    const dir = await project('1.0.0');
    await writeFile(
      join(dir, 'mallok.json'),
      JSON.stringify({
        schemaVersion: 1,
        appliedMigrations: ['2026-01-01-earlier'],
        history: [],
      }),
      'utf8',
    );

    await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: runner({}).run },
      report,
    );

    // The copy carried it across; the finalize step in the target is what
    // appends to it, and that is `upgrade.test.ts`'s subject.
    expect((await readProjectState(dir)).appliedMigrations).toEqual([
      '2026-01-01-earlier',
    ]);
  });
});

describe('what is copied into the staging directory', () => {
  it('the site’s own files, and not its node_modules', async () => {
    // `node_modules` is reinstalled from the manifest. Copying it would be
    // slow, and worse, would carry the *old* framework into the tree the
    // target version is about to check itself against.
    const dir = await project('1.0.0');
    await mkdir(join(dir, 'node_modules/mallok'), { recursive: true });
    await writeFile(
      join(dir, 'node_modules/mallok/marker.txt'),
      'the old framework\n',
      'utf8',
    );

    const seen: string[] = [];
    const fake = {
      run: async (
        _command: string,
        args: readonly string[],
        opts?: unknown,
      ) => {
        const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? '';
        if (args[0] === 'install') {
          const { readdir } = await import('node:fs/promises');
          seen.push(...(await readdir(cwd)));
          // The install is what creates the target's binary in the copy.
          await mkdir(join(cwd, 'node_modules/.bin'), { recursive: true });
        }
        if (args[0] === 'upgrade-finalize') {
          return {
            code: 0,
            stdout: `${JSON.stringify({
              protocol: 1,
              ok: true,
              version: '2.0.0',
              migrationsApplied: [],
              checks: [],
            })}\n`,
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    };

    await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(seen).toContain('content.md');
    expect(seen).toContain('wrangler.jsonc');
    expect(seen).not.toContain('node_modules');
  });
});
