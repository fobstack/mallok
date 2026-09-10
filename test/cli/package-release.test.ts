import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

/**
 * The package as a user receives it.
 *
 * Everything here runs against a tarball installed into an empty directory and
 * driven through `node_modules/.bin/mallok` — not `dist/cli/index.js`. That
 * distinction has already caught one shipped bug: the entry guard compared
 * `argv[1]` to `cli/index.js`, which is true from the repository and false
 * through npm's symlink, so the published CLI exited 0 and did nothing.
 *
 * Slow, and worth it: this is the only thing in the suite that exercises what
 * `npm install` actually produces.
 */

const REPO = process.cwd();
const MANIFEST = 'dist/cli/package.json';

let sandbox = '';
let mallok = '';
/** The packed tarball, named by `npm pack --json` rather than guessed. */
let tarball = '';

async function manifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(MANIFEST, 'utf8')) as Record<
    string,
    unknown
  >;
}

/**
 * The outer Vitest run's own variables are stripped.
 *
 * The generated project runs its own `vitest`, and inheriting `VITEST`,
 * `VITEST_POOL_ID` and friends makes the inner run believe it is a worker of
 * the outer one. It then fails in ways that have nothing to do with the
 * project being tested.
 */
function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('VITEST')) {
      delete environment[key];
    }
  }
  return environment;
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd,
      env: cleanEnvironment(),
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
  await run('pnpm', ['run', 'build:cli'], REPO);
  const packed = await run('npm', ['pack', '--json'], join(REPO, 'dist/cli'));
  const [entry] = JSON.parse(packed.stdout) as { filename: string }[];
  const filename = entry?.filename ?? '';
  tarball = `dist/cli/${filename}`;

  sandbox = await mkdtemp(join(tmpdir(), 'mallok-installed-'));
  await writeFile(
    join(sandbox, 'package.json'),
    JSON.stringify({ name: 'sandbox', private: true }),
    'utf8',
  );
  await run(
    'npm',
    ['install', resolve(REPO, 'dist/cli', filename), '--no-audit', '--no-fund'],
    sandbox,
  );
  mallok = join(sandbox, 'node_modules/.bin/mallok');
}, 300_000);

afterAll(async () => {
  if (sandbox !== '') {
    await rm(sandbox, { recursive: true, force: true });
  }
});

describe('the published CLI manifest', () => {
  it('carries the repository’s licence, not another one', async () => {
    const cli = await manifest();
    const repo = JSON.parse(await readFile('package.json', 'utf8')) as {
      license: string;
      version: string;
    };
    // This said `MIT` while the project is Apache-2.0 — publishing it would
    // have put the CLI under a licence the project does not use.
    expect(cli.license).toBe('Apache-2.0');
    expect(cli.license).toBe(repo.license);
    // And the version tracks the repository rather than a hard-coded string.
    expect(cli.version).toBe(repo.version);
  });

  it('ships the licence, the notice and a readme', async () => {
    const files = (await manifest()).files as string[];
    for (const file of ['index.js', 'LICENSE', 'NOTICE', 'README.md']) {
      expect(files).toContain(file);
      await expect(readFile(`dist/cli/${file}`, 'utf8')).resolves.toBeTruthy();
    }
  });

  it('declares sharp, which must never be bundled', async () => {
    const cli = await manifest();
    expect(cli.dependencies).toEqual({ sharp: '0.35.4' });
    // Bundling a native module would produce a binary tied to one platform.
    const bundle = await readFile('dist/cli/index.js', 'utf8');
    expect(bundle).toContain('"sharp"');
    expect(bundle.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});

describe('the packed tarball', () => {
  it('names a file that exists and is not empty', async () => {
    const { size } = await stat(tarball);
    expect(size).toBeGreaterThan(100_000);
  });

  it('carries the project template, not just the bundle', async () => {
    const { stdout } = await run('tar', ['-tzf', tarball], REPO);
    const entries = stdout.split('\n');
    for (const required of [
      'package/index.js',
      'package/template/package.json',
      'package/template/wrangler.jsonc',
      'package/template/src/worker/index.ts',
      'package/template/src/runtime/core/index.ts',
      'package/template/src/db/migrations/0001_init.sql',
      // Undotted on purpose: npm strips a file called `.gitignore` out of a
      // tarball, and `mallok create` renames it back.
      'package/template/gitignore',
    ]) {
      expect(entries).toContain(required);
    }
  });

  it('carries no credential, no build output and no repository metadata', async () => {
    const { stdout } = await run('tar', ['-tzf', tarball], REPO);
    const entries = stdout.split('\n').filter((line) => line !== '');
    const forbidden =
      /(^|\/)(\.git|\.dev\.vars|\.env|\.mallok|\.wrangler|node_modules|dist)(\/|$)|\.(pem|key|p12|pfx)$/;
    const offenders = entries.filter((entry) =>
      forbidden.test(entry.replace(/^package\/(template\/)?/, '')),
    );
    expect(offenders).toEqual([]);
  });

  it('pins nothing to this machine or this checkout', async () => {
    // A `file:` or `workspace:` dependency, or an absolute path, makes the
    // package installable only here.
    const { stdout } = await run(
      'tar',
      ['-xzOf', tarball, 'package/template/package.json'],
      REPO,
    );
    expect(stdout).not.toMatch(/"(file|link|workspace):/);
    expect(stdout).not.toContain('@fobstack/runtime');
    expect(stdout).not.toMatch(/\/(Users|home)\//);
  });
});

describe('the built CLI', () => {
  it('exits zero for --help, so a script does not read it as a failure', async () => {
    const { stdout } = await run(
      process.execPath,
      ['dist/cli/index.js', '--help'],
      REPO,
    );
    expect(stdout).toContain('mallok — publish and manage a Mallok site');
  });

  it('runs when invoked through a path that is not its own', async () => {
    // The regression: the entry guard compared `argv[1]` against
    // `cli/index.js`, which npm's `node_modules/.bin/mallok` symlink is not.
    // Invoking through a different path is what that bug survived.
    const { stdout } = await run(
      process.execPath,
      ['dist/cli/index.js', 'export', '--help'],
      REPO,
    );
    expect(stdout).toContain('mallok — publish and manage a Mallok site');
  });

  it('reports an unknown command instead of exiting silently', async () => {
    const result = await run(
      process.execPath,
      ['dist/cli/index.js', 'not-a-command'],
      REPO,
    );
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/unknown command/i);
  });
});

describe('the installed binary', () => {
  it('is linked and executable', async () => {
    await expect(stat(mallok)).resolves.toBeTruthy();
  });

  it('exits 0 for --help and --version, non-zero otherwise', async () => {
    const help = await run(mallok, ['--help'], sandbox);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('mallok — publish and manage a Mallok site');

    const version = await run(mallok, ['--version'], sandbox);
    expect(version.code).toBe(0);
    const manifest = JSON.parse(
      await readFile(join(REPO, 'package.json'), 'utf8'),
    ) as { version: string };
    expect(version.stdout.trim()).toBe(manifest.version);

    // A bare invocation is a usage error, and so is a command that is not one.
    expect((await run(mallok, [], sandbox)).code).not.toBe(0);
    expect((await run(mallok, ['not-a-command'], sandbox)).code).not.toBe(0);
  });

  it('processes a real image through sharp', async () => {
    // Not a manifest check: sharp is a native module, and "declared as a
    // dependency" and "loads and works on this machine" are different claims.
    const script = join(sandbox, 'sharp-check.mjs');
    await writeFile(
      script,
      [
        "import sharp from 'sharp';",
        "const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).png().toBuffer();",
        'const webp = await sharp(png).resize(32).webp().toBuffer();',
        'const meta = await sharp(webp).metadata();',
        'process.stdout.write(`${meta.format} ${meta.width}x${meta.height}`);',
      ].join('\n'),
      'utf8',
    );
    const result = await run(process.execPath, [script], sandbox);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('webp 32x24');
  });
});

describe('mallok create, from an empty directory', () => {
  it('generates a project that passes its own gate', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mallok-create-e2e-'));
    try {
      const created = await run(
        mallok,
        ['create', 'my-site', '--no-deploy'],
        workspace,
      );
      expect(created.code).toBe(0);
      // Progress goes to stderr and the result table to stdout, so the claim
      // is checked against both rather than whichever one it happens to use.
      expect(`${created.stdout}${created.stderr}`).toContain(
        'Nothing was created on Cloudflare',
      );

      const project = join(workspace, 'my-site');

      // The ignore file survived packing, so a first `git add .` is safe.
      await expect(
        readFile(join(project, '.gitignore'), 'utf8'),
      ).resolves.toContain('.dev.vars');

      // No credential, no repository, no leftover state.
      for (const forbidden of ['.git', '.dev.vars', '.env', '.mallok']) {
        await expect(stat(join(project, forbidden))).rejects.toThrow();
      }

      // And it is a working project, not just a directory of files. `create`
      // already installed and built it; this is the rest of the gate.
      for (const [command, args] of [
        ['pnpm', ['run', 'lint']],
        ['pnpm', ['run', 'typecheck']],
        ['pnpm', ['test']],
      ] as const) {
        const result = await run(command, args, project);
        expect(result.code, `${command} ${args.join(' ')}`).toBe(0);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 900_000);
});
