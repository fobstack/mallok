import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError, makeReporter } from '../../src/cli/output.js';
import { compareVersions, upgradeProject } from '../../src/cli/upgrade.js';

/**
 * What an upgrade is, now that it is only what it needs to be.
 *
 * A site's project holds its own files and depends on `mallok` at an exact
 * version, so moving between releases is: change the number, install, run the
 * project's own checks against what was installed, and put everything back if
 * any of that fails.
 *
 * The previous implementation copied the whole project into a temporary
 * directory, installed there, handed control to the target's binary over an
 * inter-version protocol so that release could apply its own project
 * migrations, and swapped the copy in with a rename. It guarded **zero**
 * migrations — the list was empty — and a directory-swapping transaction that
 * protects nothing contributes only its own failure modes: a failure between
 * the two renames leaves no project at all.
 *
 * The runner here is a fake. `npm install` and the project's own scripts are
 * what this code has to drive correctly; driving them for real is
 * `upgrade.test.ts`'s job.
 */

const report = makeReporter(true, true);

let workspace = '';

/** A project shell with just enough for `upgradeProject` to accept it. */
async function project(version = '1.0.0'): Promise<string> {
  const dir = join(workspace, 'site');
  await mkdir(join(dir, 'src/worker'), { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      { name: 'my-site', private: true, dependencies: { mallok: version } },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    join(dir, 'package-lock.json'),
    `{"mallok":"${version}"}\n`,
    'utf8',
  );
  await writeFile(join(dir, 'wrangler.jsonc'), '{}\n', 'utf8');
  await writeFile(join(dir, 'src/worker/index.ts'), '// site\n', 'utf8');
  // The installed tree, because "already on that version" is now checked in
  // all three places rather than read off the manifest
  // (`upgrade-safety.test.ts`).
  await mkdir(join(dir, 'node_modules/mallok'), { recursive: true });
  await writeFile(
    join(dir, 'node_modules/mallok/package.json'),
    JSON.stringify({ name: 'mallok', version }),
    'utf8',
  );
  return dir;
}

/**
 * A runner standing in for `npm` and the project's Wrangler.
 *
 * Its `install` rewrites the lockfile, as a real one does — which is what
 * makes "the lockfile was restored" a claim worth asserting.
 */
function runner(
  options: {
    installFails?: boolean;
    failCheck?: string;
    dryRunFails?: boolean;
    restoreFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let installs = 0;
  return {
    calls,
    run: async (
      command: string,
      args: readonly string[],
      opts?: { cwd?: string },
    ) => {
      const name = command.split('/').pop() ?? command;
      calls.push(`${name} ${args.join(' ')}`);
      if (args[0] === 'install' || args[0] === 'ci') {
        installs += 1;
        if (installs > 1 && options.restoreFails === true) {
          return { code: 1, stdout: '', stderr: 'ENOTFOUND registry' };
        }
        if (installs === 1 && options.installFails === true) {
          return {
            code: 1,
            stdout: '',
            stderr: 'ENOTFOUND registry.npmjs.org',
          };
        }
        // A real install regenerates the lockfile *from the manifest*, so
        // restoring the manifest and installing again reproduces the original
        // lockfile. A fake that merely bumped a counter would make the
        // rollback assertion below unfalsifiable in the wrong direction.
        const manifest = JSON.parse(
          await readFile(join(opts?.cwd ?? '', 'package.json'), 'utf8'),
        ) as { dependencies?: Record<string, string> };
        const pinned = manifest.dependencies?.mallok ?? '';
        await writeFile(
          join(opts?.cwd ?? '', 'package-lock.json'),
          `{"mallok":"${pinned}"}\n`,
          'utf8',
        );
        await mkdir(join(opts?.cwd ?? '', 'node_modules/mallok'), {
          recursive: true,
        });
        await writeFile(
          join(opts?.cwd ?? '', 'node_modules/mallok/package.json'),
          JSON.stringify({ name: 'mallok', version: pinned }),
          'utf8',
        );
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'run') {
        return args[1] === options.failCheck
          ? { code: 1, stdout: '', stderr: `${args[1]} failed` }
          : { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'deploy') {
        return options.dryRunFails === true
          ? { code: 1, stdout: '', stderr: 'binding missing' }
          : { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-upgradetest-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('comparing versions', () => {
  it('orders releases, and a release above its own pre-releases', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0-rc.4', '0.1.0-rc.3')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.1.0-rc.4')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-rc.4', '0.1.0')).toBeLessThan(0);
  });

  it('orders rc.10 after rc.2, not before it', () => {
    // The hand-rolled comparison this replaced compared pre-release tags as
    // **strings**, so '10' sorted before '2' and rc.10 looked older than
    // rc.2. Upgrading from rc.2 to rc.10 was refused as a downgrade — a bug
    // that appears on a release train's tenth candidate and not one earlier.
    expect(compareVersions('0.1.0-rc.10', '0.1.0-rc.2')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0-rc.2', '0.1.0-rc.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha.9', '1.0.0-alpha.11')).toBeLessThan(0);
  });

  it('ignores build metadata, which semver says is not precedence', () => {
    expect(compareVersions('1.0.0+build.2', '1.0.0+build.1')).toBe(0);
    expect(compareVersions('1.0.0+abc', '1.0.0')).toBe(0);
  });

  it('orders the pre-release identifier kinds the way semver does', () => {
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(
      0,
    );
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0);
  });
});

describe('what is refused before anything is installed', () => {
  it('a range, rather than a version', async () => {
    const dir = await project();
    const fake = runner();

    for (const version of ['^2.0.0', 'latest', '2.0', 'next', '']) {
      await expect(
        upgradeProject({ to: version, projectDir: dir, run: fake.run }, report),
        version,
      ).rejects.toThrow(/exact version/);
    }
    expect(fake.calls).toEqual([]);
  });

  it('going backwards, including across pre-releases', async () => {
    const dir = await project('0.1.0-rc.10');
    const fake = runner();

    await expect(
      upgradeProject(
        { to: '0.1.0-rc.2', projectDir: dir, run: fake.run },
        report,
      ),
    ).rejects.toThrow(/older than/);
    expect(fake.calls).toEqual([]);
  });

  it('a project pinned to something that is not a version', async () => {
    const dir = await project('^1.0.0');

    await expect(
      upgradeProject(
        { to: '2.0.0', projectDir: dir, run: runner().run },
        report,
      ),
    ).rejects.toThrow(/not an exact version/);
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
        { to: '2.0.0', projectDir: dir, run: runner().run },
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
        { to: '2.0.0', projectDir: dir, run: runner().run },
        report,
      ),
    ).rejects.toThrow(/does not depend on mallok/);
  });

  it('a project holding another package manager’s lockfile', async () => {
    const dir = await project();
    await writeFile(
      join(dir, 'pnpm-lock.yaml'),
      'lockfileVersion: 9\n',
      'utf8',
    );

    await expect(
      upgradeProject(
        { to: '2.0.0', projectDir: dir, run: runner().run },
        report,
      ),
    ).rejects.toThrow();
  });
});

describe('upgrading to the version already installed', () => {
  it('changes nothing and says so', async () => {
    const dir = await project('2.0.0');
    const fake = runner();

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe('a dry run', () => {
  it('reports the move and writes nothing', async () => {
    const dir = await project('1.0.0');
    const fake = runner();

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

describe('a successful upgrade', () => {
  it('installs the target and runs the project’s own checks against it', async () => {
    const dir = await project('1.0.0');
    const fake = runner();

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(true);
    expect(result.checks).toEqual([
      'typecheck',
      'test',
      'build',
      'deploy --dry-run',
    ]);
    // The checks ran **after** the install, which is what makes them the
    // target version's checks rather than the previous version's.
    const installAt = fake.calls.findIndex((call) => call.includes('install'));
    const firstCheck = fake.calls.findIndex((call) =>
      call.includes('run typecheck'),
    );
    expect(installAt).toBeGreaterThanOrEqual(0);
    expect(firstCheck).toBeGreaterThan(installAt);

    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe('2.0.0');
  });

  it('skips the checks when asked', async () => {
    const dir = await project('1.0.0');
    const fake = runner();

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, skipChecks: true, run: fake.run },
      report,
    );

    expect(result.checks).toEqual([]);
    expect(fake.calls.some((call) => call.includes('run typecheck'))).toBe(
      false,
    );
  });

  it('needs a command runner', async () => {
    const dir = await project('1.0.0');

    await expect(
      upgradeProject({ to: '2.0.0', projectDir: dir }, report),
    ).rejects.toThrow(/command runner/);
  });
});

describe('when it fails, the project goes back to the version that worked', () => {
  /** The manifest's pinned version and the lockfile's bytes. */
  async function state(dir: string): Promise<{ pinned: string; lock: string }> {
    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    return {
      pinned: manifest.dependencies.mallok ?? '',
      lock: await readFile(join(dir, 'package-lock.json'), 'utf8'),
    };
  }

  for (const [label, options] of [
    ['the install fails', { installFails: true }],
    ['the first check fails', { failCheck: 'typecheck' }],
    ['a later check fails', { failCheck: 'build' }],
    ['the deploy dry-run fails', { dryRunFails: true }],
  ] as const) {
    it(`when ${label}`, async () => {
      const dir = await project('1.0.0');
      const before = await state(dir);
      const fake = runner(options);

      await expect(
        upgradeProject({ to: '2.0.0', projectDir: dir, run: fake.run }, report),
      ).rejects.toThrow();

      // Both files back, **and** the previous version reinstalled: a project
      // whose manifest says one version while `node_modules` holds another
      // fails in a way nobody can read.
      expect(await state(dir)).toEqual(before);
      // `ci`, not `install`: the restored lockfile is the record of what
      // this project was working with, and `install` is free to rewrite it.
      expect(fake.calls.at(-1)).toContain('ci');
    });
  }

  it('says so plainly when even the rollback install fails', async () => {
    // The one case that leaves a project needing a hand: the files are back
    // and `node_modules` is not. Saying so is the only honest option.
    const dir = await project('1.0.0');
    const fake = runner({ failCheck: 'typecheck', restoreFails: true });

    const error = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    ).then(
      () => null,
      (thrown: unknown) => thrown as CliError,
    );

    expect(error).toBeInstanceOf(CliError);
    expect(error?.message).toMatch(/rolled back/i);
    expect(error?.hint).toContain('npm ci');
    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe('1.0.0');
  });
});

describe('what was removed, and stays removed', () => {
  it('makes no staging copy, so a failure cannot strand one', async () => {
    // The previous design copied the whole project into `os.tmpdir()` and
    // swapped it in with two renames. A failure between them left no project
    // at all — a failure mode invented entirely by the machinery meant to
    // prevent one, and guarding an empty list of migrations.
    const staging = (entry: string) => entry.startsWith('mallok-upgrade-');
    const before = (await readdir(tmpdir())).filter(staging);

    const dir = await project('1.0.0');
    const fake = runner({ failCheck: 'test' });

    await expect(
      upgradeProject({ to: '2.0.0', projectDir: dir, run: fake.run }, report),
    ).rejects.toThrow();

    // Compared before and after rather than asserted empty: the temporary
    // directory is shared, and what matters is that this run added nothing to
    // it. `mallok-upgrade-` was the staging prefix.
    expect((await readdir(tmpdir())).filter(staging)).toEqual(before);
  });

  it('writes no project-migration state file', async () => {
    const dir = await project('1.0.0');
    await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: runner().run },
      report,
    );

    expect(await readdir(dir)).not.toContain('mallok.json');
  });
});
