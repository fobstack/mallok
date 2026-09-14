import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError, makeReporter } from '../../src/cli/output.js';
import { upgradeProject } from '../../src/cli/upgrade.js';

/**
 * The states an upgrade has to survive, now that it is a small command.
 *
 * Shrinking it was right: the directory-swapping transaction guarded zero
 * migrations and contributed only its own failure modes. But the small
 * version still edits two files a site cannot afford to lose, so the things
 * that protect them have to be real rather than implied.
 *
 * - **The lockfile must exist and be readable.** The rollback restores it; a
 *   rollback that cannot restore what it never read leaves the manifest on
 *   the old version and `node_modules` on the new one.
 * - **Another package manager's lockfile is refused**, including
 *   `bun.lock` (Bun's newer text format, not just `bun.lockb`),
 *   `npm-shrinkwrap.json` — which overrides `package-lock.json` and would
 *   silently pin the *old* version through the install — and a
 *   `packageManager` field naming pnpm, yarn or bun.
 * - **A crash must not leave a half-written state.** A journal records what
 *   is being changed before it changes, and the next run finishes or undoes
 *   it.
 * - **Two upgrades must not run at once.** Both would read the same "before",
 *   and the loser would restore a manifest the winner had already replaced.
 * - **"Already on that version" has to mean it.** A manifest saying 2.0.0
 *   beside a lockfile and a `node_modules` holding 1.0.0 is not "nothing to
 *   do"; it is a project that needs the install it never finished.
 * - **Build metadata is not precedence for ordering, but it is identity.**
 *   `1.0.0+build.2` and `1.0.0+build.1` compare equal under semver, and they
 *   are not the same artefact.
 */

const report = makeReporter(true, true);

let workspace = '';

interface ProjectOptions {
  readonly version?: string;
  readonly lock?: string | null;
  readonly installed?: string | null;
  readonly extra?: Record<string, string>;
  readonly manifestExtra?: Record<string, unknown>;
}

async function project(options: ProjectOptions = {}): Promise<string> {
  const version = options.version ?? '1.0.0';
  const dir = join(workspace, 'site');
  await mkdir(join(dir, 'src/worker'), { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'my-site',
        private: true,
        dependencies: { mallok: version },
        ...options.manifestExtra,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  if (options.lock !== null) {
    await writeFile(
      join(dir, 'package-lock.json'),
      options.lock ?? `{"mallok":"${version}"}\n`,
      'utf8',
    );
  }
  await writeFile(join(dir, 'wrangler.jsonc'), '{}\n', 'utf8');
  await writeFile(join(dir, 'src/worker/index.ts'), '// site\n', 'utf8');

  const installed =
    options.installed === undefined ? version : options.installed;
  if (installed !== null) {
    await mkdir(join(dir, 'node_modules/mallok'), { recursive: true });
    await writeFile(
      join(dir, 'node_modules/mallok/package.json'),
      JSON.stringify({ name: 'mallok', version: installed }),
      'utf8',
    );
  }
  for (const [name, body] of Object.entries(options.extra ?? {})) {
    await writeFile(join(dir, name), body, 'utf8');
  }
  return dir;
}

/** A runner that installs by writing what a real npm would leave behind. */
function runner(options: { failCheck?: string; installFails?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    run: async (
      command: string,
      args: readonly string[],
      opts?: { cwd?: string },
    ) => {
      const name = command.split('/').pop() ?? command;
      calls.push(`${name} ${args.join(' ')}`);
      const cwd = opts?.cwd ?? '';
      if (args[0] === 'install' || args[0] === 'ci') {
        if (options.installFails === true) {
          return { code: 1, stdout: '', stderr: 'ENOTFOUND registry' };
        }
        const manifest = JSON.parse(
          await readFile(join(cwd, 'package.json'), 'utf8'),
        ) as { dependencies?: Record<string, string> };
        const pinned = manifest.dependencies?.mallok ?? '';
        await writeFile(
          join(cwd, 'package-lock.json'),
          `{"mallok":"${pinned}"}\n`,
          'utf8',
        );
        await mkdir(join(cwd, 'node_modules/mallok'), { recursive: true });
        await writeFile(
          join(cwd, 'node_modules/mallok/package.json'),
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
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-upgradesafe-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the lockfile has to be there and be readable', () => {
  it('refuses when there is none', async () => {
    // The rollback restores the lockfile. With nothing to restore, a failure
    // leaves the manifest on the old version and the install on the new one.
    const dir = await project({ lock: null });
    const fake = runner();

    await expect(
      upgradeProject({ to: '2.0.0', projectDir: dir, run: fake.run }, report),
    ).rejects.toThrow(/lockfile|package-lock\.json/i);
    expect(fake.calls).toEqual([]);
  });

  it('refuses when it cannot be read', async () => {
    const dir = await project();
    // A directory where the file should be: unreadable in the way that
    // actually happens, without needing to chmod anything.
    await rm(join(dir, 'package-lock.json'));
    await mkdir(join(dir, 'package-lock.json'));
    const fake = runner();

    await expect(
      upgradeProject({ to: '2.0.0', projectDir: dir, run: fake.run }, report),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });
});

describe('other package managers are refused, not worked around', () => {
  for (const [label, files, manifest] of [
    ['a bun.lockb', { 'bun.lockb': 'x' }, {}],
    ['a bun.lock', { 'bun.lock': 'x' }, {}],
    ['a pnpm lockfile', { 'pnpm-lock.yaml': 'lockfileVersion: 9\n' }, {}],
    ['a yarn lockfile', { 'yarn.lock': '# yarn\n' }, {}],
    // Overrides package-lock.json entirely, so an install would pin whatever
    // it says — including the version being upgraded away from.
    ['an npm-shrinkwrap', { 'npm-shrinkwrap.json': '{}' }, {}],
    ['packageManager: pnpm', {}, { packageManager: 'pnpm@10.34.5' }],
    ['packageManager: yarn', {}, { packageManager: 'yarn@4.5.0' }],
    ['packageManager: bun', {}, { packageManager: 'bun@1.1.0' }],
  ] as const) {
    it(`refuses ${label}`, async () => {
      const dir = await project({ extra: files, manifestExtra: manifest });
      const fake = runner();

      await expect(
        upgradeProject({ to: '2.0.0', projectDir: dir, run: fake.run }, report),
      ).rejects.toThrow();
      expect(fake.calls).toEqual([]);
    });
  }

  it('accepts packageManager: npm', async () => {
    const dir = await project({
      manifestExtra: { packageManager: 'npm@10.9.7' },
    });

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: runner().run },
      report,
    );

    expect(result.changed).toBe(true);
  });
});

describe('"already on that version" is checked, not assumed', () => {
  it('finishes the install when node_modules is behind', async () => {
    // The manifest says 2.0.0 and the tree holds 1.0.0: a previous run was
    // interrupted after the manifest was written. Reporting "nothing to do"
    // leaves a site building against a version it does not have.
    const dir = await project({ version: '2.0.0', installed: '1.0.0' });
    const fake = runner();

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(true);
    expect(fake.calls.some((call) => call.includes('install'))).toBe(true);
    const installed = JSON.parse(
      await readFile(join(dir, 'node_modules/mallok/package.json'), 'utf8'),
    ) as { version: string };
    expect(installed.version).toBe('2.0.0');
  });

  it('finishes the install when the lockfile is behind', async () => {
    const dir = await project({
      version: '2.0.0',
      lock: '{"mallok":"1.0.0"}\n',
      installed: '2.0.0',
    });
    const fake = runner();

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(true);
  });

  it('really does nothing when all three agree', async () => {
    const dir = await project({ version: '2.0.0' });
    const fake = runner();

    const result = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('treats a different build metadata as a different artefact', async () => {
    // `semver.compare` says these are equal — build metadata is explicitly
    // not precedence — but they are not the same tarball, so "already on it"
    // would skip an install that has to happen.
    const dir = await project({ version: '1.0.0+build.1' });
    const fake = runner();

    const result = await upgradeProject(
      { to: '1.0.0+build.2', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.changed).toBe(true);
    expect(fake.calls.some((call) => call.includes('install'))).toBe(true);
  });
});

describe('two upgrades cannot run at once', () => {
  it('the second one refuses while the first holds the lock', async () => {
    const dir = await project();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow = {
      run: async (command: string, args: readonly string[]) => {
        if (args[0] === 'run' && args[1] === 'typecheck') {
          await held;
        }
        return await runner().run(command, args, { cwd: dir });
      },
    };

    const first = upgradeProject(
      { to: '2.0.0', projectDir: dir, run: slow.run },
      report,
    );
    // Give the first run time to take the lock and reach the checks.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(
      upgradeProject(
        { to: '3.0.0', projectDir: dir, run: runner().run },
        report,
      ),
    ).rejects.toThrow(/already (in progress|running)|another upgrade/i);

    release?.();
    await first;
  });

  it('releases the lock when it finishes, so the next one can run', async () => {
    const dir = await project();

    await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: runner().run },
      report,
    );
    const second = await upgradeProject(
      { to: '3.0.0', projectDir: dir, run: runner().run },
      report,
    );

    expect(second.changed).toBe(true);
  });

  it('releases it after a failure too', async () => {
    const dir = await project();

    await expect(
      upgradeProject(
        {
          to: '2.0.0',
          projectDir: dir,
          run: runner({ failCheck: 'build' }).run,
        },
        report,
      ),
    ).rejects.toThrow();

    const retry = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: runner().run },
      report,
    );
    expect(retry.changed).toBe(true);
  });
});

describe('a crash mid-upgrade is recovered on the next run', () => {
  it('restores the manifest and lockfile a journal says were being changed', async () => {
    // The state a `kill -9` between writing the manifest and finishing the
    // install leaves behind: manifest on the new version, lockfile and
    // node_modules on the old one, and a journal saying so.
    const dir = await project({ version: '1.0.0' });
    const journalDir = join(dir, '.mallok');
    await mkdir(journalDir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      `${JSON.stringify(
        { name: 'my-site', private: true, dependencies: { mallok: '2.0.0' } },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(
      join(journalDir, 'upgrade-journal.json'),
      JSON.stringify({
        schemaVersion: 1,
        from: '1.0.0',
        to: '2.0.0',
        startedAt: '2026-09-14T00:00:00.000Z',
        manifest: `${JSON.stringify(
          { name: 'my-site', private: true, dependencies: { mallok: '1.0.0' } },
          null,
          2,
        )}\n`,
        lock: '{"mallok":"1.0.0"}\n',
      }),
      'utf8',
    );

    const fake = runner();
    // Any upgrade run recovers first. Asking for the version it was already
    // on makes the recovery the only thing that happens.
    await upgradeProject(
      { to: '1.0.0', projectDir: dir, run: fake.run },
      report,
    ).catch(() => undefined);

    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe('1.0.0');
    const journal = await readFile(
      join(journalDir, 'upgrade-journal.json'),
      'utf8',
    ).catch(() => null);
    expect(journal).toBeNull();
  });

  it('writes no journal behind after a clean run', async () => {
    const dir = await project();

    await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: runner().run },
      report,
    );

    const journal = await readFile(
      join(dir, '.mallok/upgrade-journal.json'),
      'utf8',
    ).catch(() => null);
    expect(journal).toBeNull();
  });
});

describe('the rollback verifies what it restored', () => {
  it('reinstalls with npm ci and checks the version that landed', async () => {
    const dir = await project();
    const fake = runner({ failCheck: 'typecheck' });

    const error = await upgradeProject(
      { to: '2.0.0', projectDir: dir, run: fake.run },
      report,
    ).then(
      () => null,
      (thrown: unknown) => thrown as CliError,
    );

    expect(error).toBeInstanceOf(CliError);
    // `ci`, not `install`: the restored lockfile is the record of what this
    // project was working with, and `install` is free to rewrite it.
    expect(fake.calls.at(-1)).toContain('ci');
    const installed = JSON.parse(
      await readFile(join(dir, 'node_modules/mallok/package.json'), 'utf8'),
    ) as { version: string };
    expect(installed.version).toBe('1.0.0');
  });
});
