import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ESM script, deliberately dependency-free.
import { startLocalRegistry } from '../../scripts/local-registry.mjs';

const execFileAsync = promisify(execFile);

/**
 * The package as a user receives it.
 *
 * Everything here runs against a tarball installed into an empty directory and
 * driven through `node_modules/.bin/mallok` — not `dist/pkg/cli/index.js`.
 * That distinction has already caught one shipped bug: the entry guard
 * compared `argv[1]` to `cli/index.js`, which is true from the repository and
 * false through npm's symlink, so the published CLI exited 0 and did nothing.
 *
 * The generated project is installed from a **local registry** serving that
 * same tarball, because the version it depends on does not exist on npmjs.com
 * until it is published. That is the only way to resolve `mallok@<version>` by
 * name — and resolving it by name is the whole point: a `file:` dependency is
 * exactly what the shell must never contain.
 *
 * Slow, and worth it: this is the only thing in the suite that exercises what
 * `npm install` actually produces.
 */

const MANIFEST = 'dist/pkg/package.json';

let sandbox = '';
let mallok = '';
let tarball = '';
let registry: { origin: string; close: () => Promise<void> } | null = null;
let version = '';

/**
 * A child process that knows nothing about this repository.
 *
 * Four families of variable have to go, and each one caused a real failure
 * before it was stripped:
 *
 * - `VITEST*` makes an inner test run believe it is a worker of the outer one;
 * - `npm_config_*` carries the outer package manager's configuration, and
 *   `npm_config_user_agent` in particular silently made `create` build the
 *   generated project with pnpm because this suite is run through pnpm;
 * - `npm_package_*` describes **this repository's** package — which is also
 *   called `mallok`, and whose presence stopped npm linking the real
 *   `mallok` binary into the generated project's `node_modules/.bin`;
 * - `NODE_PATH` and `NODE_OPTIONS` point module resolution back at this
 *   checkout, which is exactly the kind of green that means nothing.
 */
function cleanEnvironment(
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    // `VITEST*` makes an inner run believe it is a worker of the outer one.
    // `npm_config_*` is the outer package manager's own configuration, and
    // `npm_config_user_agent` in particular is how this suite — run through
    // pnpm — silently made `create` choose pnpm for the generated project.
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
  // One build, one pack, one install, shared by every test below.
  const built = await run('node', ['scripts/build-package.mjs'], process.cwd());
  expect(built.code, built.stderr).toBe(0);

  const packed = await run('npm', ['pack', '--json'], 'dist/pkg');
  expect(packed.code, packed.stderr).toBe(0);
  const [entry] = JSON.parse(packed.stdout) as { filename: string }[];
  tarball = join(process.cwd(), 'dist/pkg', entry?.filename ?? '');
  version = (
    JSON.parse(await readFile(MANIFEST, 'utf8')) as { version: string }
  ).version;

  sandbox = await mkdtemp(join(tmpdir(), 'mallok-install-'));
  const installed = await run('npm', ['install', tarball], sandbox);
  expect(installed.code, installed.stderr).toBe(0);
  mallok = join(sandbox, 'node_modules/.bin/mallok');

  registry = await startLocalRegistry({
    mallok: { version, path: tarball },
  });
}, 600_000);

afterAll(async () => {
  await registry?.close();
  await rm(sandbox, { recursive: true, force: true });
});

describe('the published manifest', () => {
  it('carries the repository’s licence, not another one', async () => {
    const parsed = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
      license: string;
      version: string;
    };

    expect(parsed.license).toBe('Apache-2.0');
    const repository = JSON.parse(await readFile('package.json', 'utf8')) as {
      version: string;
    };
    expect(parsed.version).toBe(repository.version);
  });

  it('exports the framework entry a site imports', async () => {
    const parsed = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
      exports: Record<string, { types?: string; default?: string }>;
      bin: Record<string, string>;
    };

    expect(parsed.exports['./worker']?.default).toBe('./worker/index.js');
    expect(parsed.exports['./worker']?.types).toMatch(/\.d\.ts$/);
    expect(parsed.bin.mallok).toBe('./cli/index.js');
  });

  it('declares sharp, which must never be bundled', async () => {
    const parsed = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
      dependencies: Record<string, string>;
    };

    // A native module cannot be inlined: it has to be installed for the
    // consumer's platform (docs/TECH_STACK.md §5).
    expect(parsed.dependencies.sharp).toBeDefined();
    const bundle = await readFile('dist/pkg/cli/index.js', 'utf8');
    expect(bundle).not.toContain('sharp-darwin');
  });
});

describe('the packed tarball', () => {
  async function entries(): Promise<string[]> {
    const listing = await run('tar', ['tzf', tarball], process.cwd());
    return listing.stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.replace(/^package\//, ''));
  }

  it('carries the framework, the types, the assets and the shell', async () => {
    const files = await entries();

    expect(files).toContain('cli/index.js');
    expect(files).toContain('worker/index.js');
    expect(files).toContain('types/src/worker/framework.d.ts');
    expect(files.some((file) => file.startsWith('assets/_mallok/app/'))).toBe(
      true,
    );
    expect(files).toContain('template/wrangler.jsonc');
    expect(files).toContain('template/src/worker/index.ts');
    // Undotted on purpose: npm strips a file called `.gitignore`.
    expect(files).toContain('template/gitignore');
  });

  it('carries none of Mallok’s own source', async () => {
    const files = await entries();

    // The shell is a site, not a copy of this repository. Shipping the
    // runtime, the admin source or Mallok's tests is what made "upgrade" mean
    // "merge with a fork".
    for (const forbidden of [
      'template/src/runtime/',
      'template/src/admin/',
      'template/src/core/',
      'template/src/db/',
      'template/src/cli/',
      'template/src/themes/',
      'template/scripts/build-package.mjs',
      'template/test/cli/',
    ]) {
      expect(
        files.filter((file) => file.startsWith(forbidden)),
        forbidden,
      ).toEqual([]);
    }
  });

  it('carries no credential and no build output', async () => {
    const files = await entries();

    for (const forbidden of [
      '.git',
      '.dev.vars',
      '.env',
      'template/.dev.vars',
      'template/.mallok',
      'template/dist',
      'template/node_modules',
    ]) {
      expect(
        files.filter(
          (file) => file === forbidden || file.startsWith(`${forbidden}/`),
        ),
        forbidden,
      ).toEqual([]);
    }
  });

  it('pins nothing to this machine or this checkout', async () => {
    const shell = JSON.parse(
      await readFile('dist/pkg/template/package.json', 'utf8'),
    ) as { dependencies: Record<string, string> };

    // The one dependency that matters, and the four ways of writing it that
    // would make a project unupgradeable or unbuildable elsewhere.
    expect(shell.dependencies.mallok).toBe(version);
    expect(shell.dependencies.mallok).not.toMatch(/^[\^~]/);
    for (const prefix of ['file:', 'link:', 'workspace:', '/Users/']) {
      expect(JSON.stringify(shell), prefix).not.toContain(prefix);
    }
  });
});

describe('the installed binary', () => {
  it('is linked and executable', async () => {
    await expect(stat(mallok)).resolves.toBeDefined();
  });

  it('exits 0 for --help and --version, non-zero otherwise', async () => {
    const help = await run(mallok, ['--help'], sandbox);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('mallok create');

    const reported = await run(mallok, ['--version'], sandbox);
    expect(reported.code).toBe(0);
    expect(reported.stdout.trim()).toBe(version);

    // A bare invocation is a usage error, and an unknown command is an error
    // rather than a silent success.
    expect((await run(mallok, [], sandbox)).code).not.toBe(0);
    expect((await run(mallok, ['frobnicate'], sandbox)).code).not.toBe(0);
  });

  it('refuses a misspelled switch instead of provisioning', async () => {
    const result = await run(mallok, ['create', 'x', '--no-deply'], sandbox);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('no option "--no-deply"');
  });

  it('processes a real image through sharp', async () => {
    // sharp is external to the bundle and installed as a dependency; this is
    // the only check that the published package can actually use it.
    const script = join(sandbox, 'sharp-check.mjs');
    await writeFile(
      script,
      [
        "import sharp from 'sharp';",
        'const out = await sharp({',
        '  create: { width: 8, height: 8, channels: 3, background: "#fff" },',
        '}).webp().toBuffer();',
        'process.stdout.write(String(out.length));',
      ].join('\n'),
      'utf8',
    );

    const result = await run('node', [script], sandbox);
    expect(result.code, result.stderr).toBe(0);
    expect(Number(result.stdout)).toBeGreaterThan(0);
  });
});

describe('mallok create, from an empty directory', () => {
  let project = '';
  let workspace = '';

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'mallok-project-'));
    project = join(workspace, 'my-site');

    // The install inside `create` resolves `mallok` by name and version from
    // the local registry. Nothing about that reaches the project's files.
    const created = await run(
      mallok,
      // The manager is named rather than inherited: which one runs this
      // suite must not decide what a user's project is built with.
      ['create', 'my-site', '--no-deploy', '--package-manager', 'npm'],
      workspace,
      { npm_config_registry: registry?.origin ?? '' },
    );
    expect(created.code, created.stdout + created.stderr).toBe(0);
  }, 900_000);

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('writes a project that holds the site and nothing else', async () => {
    const top = (await readdir(project)).sort();

    expect(top).toContain('package.json');
    expect(top).toContain('package-lock.json');
    expect(top).toContain('wrangler.jsonc');
    expect(top).toContain('site.json');
    expect(top).toContain('content');
    expect(top).toContain('.gitignore');

    // Its source is four lines of composition and a place for plugins.
    const worker = await readFile(join(project, 'src/worker/index.ts'), 'utf8');
    expect(worker).toContain("from 'mallok/worker'");
    expect(worker).toContain('createMallok(');
    const source = (await readdir(join(project, 'src'))).sort();
    expect(source).toEqual(['plugins', 'worker']);
  });

  it('depends on the exact version, by name', async () => {
    const manifest = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };

    expect(manifest.dependencies.mallok).toBe(version);
    for (const prefix of ['file:', 'link:', 'workspace:', '^', '~']) {
      expect(manifest.dependencies.mallok, prefix).not.toContain(prefix);
    }
  });

  it('leaves no trace of how the candidate was served', async () => {
    // The local registry is a testing device. A project that carried it would
    // be a project nobody else could install.
    for (const file of ['package.json', 'wrangler.jsonc', '.npmrc']) {
      const text = await readFile(join(project, file), 'utf8').catch(() => '');
      expect(text, file).not.toContain('127.0.0.1');
    }
    expect(await readdir(project)).not.toContain('.npmrc');
  });

  it('passes its own gate', async () => {
    for (const [command, args] of [
      ['npm', ['run', 'lint']],
      ['npm', ['run', 'typecheck']],
      ['npm', ['test']],
      ['npm', ['run', 'build']],
    ] as const) {
      const result = await run(command, args, project);
      expect(
        result.code,
        `${command} ${args.join(' ')}: ${result.stdout}${result.stderr}`,
      ).toBe(0);
    }
  }, 600_000);

  it('produces a deployable bundle and the admin assets', async () => {
    // `npm run build` above staged the assets and ran the dry-run; this is
    // what it left behind.
    await expect(
      stat(join(project, 'dist/assets/_mallok/app/index.html')),
    ).resolves.toBeDefined();
    await expect(
      stat(join(project, 'dist/worker/index.js')),
    ).resolves.toBeDefined();
  });

  it('answers a real request', async () => {
    // The smoke script starts `wrangler dev` with local D1 and R2 and asks
    // for the setup endpoint, the public site and the admin shell.
    const result = await run('npm', ['run', 'smoke'], project);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('smoke: ok');
  }, 300_000);
});
