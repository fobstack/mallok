import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ESM script, deliberately dependency-free.
import { startLocalRegistry } from '../../scripts/local-registry.mjs';
import { makeReporter } from '../../src/cli/output.js';
import {
  type ProjectMigration,
  upgradeProject,
} from '../../src/cli/upgrade.js';

const execFileAsync = promisify(execFile);

/**
 * Upgrading a site from one real release to another.
 *
 * Two tarballs are built, published to a throwaway registry and installed for
 * real. The site is created on the first, given content and settings of its
 * own, and moved to the second with `mallok upgrade --to`. What is being
 * checked is the promise that makes a thin shell worth having: **the
 * framework changes and the site does not**.
 */

const FIRST = '9.9.0';
const SECOND = '9.9.1';

let registry: { origin: string; close: () => Promise<void> } | null = null;
let sandbox = '';
let project = '';
let mallok = '';

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

/**
 * Packs the built package as `version`.
 *
 * The two releases are the same code under two version numbers, and that is
 * the right fixture: what is under test is the upgrade *mechanism* — the
 * dependency, the install, the migration record, the checks — not whether one
 * particular release changed behaviour.
 */
async function packAs(version: string): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), `mallok-pack-${version}-`));
  await cp('dist/pkg', staging, {
    recursive: true,
    filter: (source) => !source.endsWith('.tgz'),
  });

  for (const [file, patch] of [
    ['package.json', (json: Record<string, unknown>) => ({ ...json, version })],
    [
      'template/package.json',
      (json: Record<string, unknown>) => ({
        ...json,
        dependencies: { ...(json.dependencies as object), mallok: version },
      }),
    ],
  ] as const) {
    const path = join(staging, file);
    const json = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(path, `${JSON.stringify(patch(json), null, 2)}\n`, 'utf8');
  }

  const packed = await run('npm', ['pack', '--json'], staging);
  expect(packed.code, packed.stderr).toBe(0);
  const [entry] = JSON.parse(packed.stdout) as { filename: string }[];
  return join(staging, entry?.filename ?? '');
}

beforeAll(async () => {
  const [first, second] = await Promise.all([packAs(FIRST), packAs(SECOND)]);
  registry = await startLocalRegistry([
    { name: 'mallok', version: FIRST, path: first },
    { name: 'mallok', version: SECOND, path: second },
  ]);

  sandbox = await mkdtemp(join(tmpdir(), 'mallok-upgrade-'));
  const installed = await run('npm', ['install', first], sandbox);
  expect(installed.code, installed.stderr).toBe(0);
  mallok = join(sandbox, 'node_modules/.bin/mallok');

  const created = await run(
    mallok,
    ['create', 'my-site', '--no-deploy'],
    sandbox,
    { npm_config_registry: registry?.origin ?? '' },
  );
  expect(created.code, created.stdout + created.stderr).toBe(0);
  project = join(sandbox, 'my-site');

  // What belongs to the site, and must survive: content, settings, a theme
  // choice, and a plugin of its own.
  await writeFile(
    join(project, 'content/page/hello/index.md'),
    '---\ntitle: Mine\n---\n\nWritten by the site owner.\n',
    'utf8',
  );
  // Written in the formatter's own style: a fixture that fails the project's
  // linter would be testing this test, not the upgrade.
  await writeFile(
    join(project, 'site.json'),
    [
      '{',
      '  "name": "The Owner\u2019s Site",',
      '  "tagline": "Kept across upgrades",',
      '  "defaultLocale": "en",',
      '  "locales": ["en"],',
      '  "kinds": {',
      '    "page": { "base": "" },',
      '    "article": { "base": "news" }',
      '  },',
      '  "nav": { "en": [] },',
      '  "themeOptions": {}',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  const entry = await readFile(join(project, 'src/worker/index.ts'), 'utf8');
  await writeFile(
    join(project, 'src/worker/index.ts'),
    entry
      .replace('theme: atelier', 'theme: gazette')
      .replace(
        "import { atelier, createMallok, inquiry } from 'mallok/worker';",
        "import { createMallok, gazette, inquiry } from 'mallok/worker';",
      ),
    'utf8',
  );
  await writeFile(
    join(project, 'src/plugins/mine.ts'),
    '/** A plugin belonging to the site. */\nexport const mine = 1;\n',
    'utf8',
  );
}, 900_000);

afterAll(async () => {
  await registry?.close();
  await rm(sandbox, { recursive: true, force: true });
});

describe('mallok upgrade, between two real releases', () => {
  it('starts on the first version', async () => {
    const manifest = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe(FIRST);

    const installed = JSON.parse(
      await readFile(join(project, 'node_modules/mallok/package.json'), 'utf8'),
    ) as { version: string };
    expect(installed.version).toBe(FIRST);
  });

  it('moves to the second, and the site is untouched', async () => {
    const before = {
      content: await readFile(
        join(project, 'content/page/hello/index.md'),
        'utf8',
      ),
      settings: await readFile(join(project, 'site.json'), 'utf8'),
      entry: await readFile(join(project, 'src/worker/index.ts'), 'utf8'),
      plugin: await readFile(join(project, 'src/plugins/mine.ts'), 'utf8'),
    };

    const upgraded = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', SECOND],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );
    expect(upgraded.code, upgraded.stdout + upgraded.stderr).toBe(0);

    // The framework moved…
    const manifest = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.mallok).toBe(SECOND);
    const installed = JSON.parse(
      await readFile(join(project, 'node_modules/mallok/package.json'), 'utf8'),
    ) as { version: string };
    expect(installed.version).toBe(SECOND);

    // …and the site did not.
    expect(
      await readFile(join(project, 'content/page/hello/index.md'), 'utf8'),
    ).toBe(before.content);
    expect(await readFile(join(project, 'site.json'), 'utf8')).toBe(
      before.settings,
    );
    expect(await readFile(join(project, 'src/worker/index.ts'), 'utf8')).toBe(
      before.entry,
    );
    expect(await readFile(join(project, 'src/plugins/mine.ts'), 'utf8')).toBe(
      before.plugin,
    );
    expect(before.entry).toContain('gazette');
  }, 600_000);

  it('passes the whole gate afterwards', async () => {
    // `upgrade` runs these itself and fails if any of them does; running them
    // again is the independent check that it was telling the truth.
    for (const args of [
      ['run', 'lint'],
      ['run', 'typecheck'],
      ['test'],
      ['run', 'build'],
    ]) {
      const result = await run('npm', args, project);
      expect(
        result.code,
        `${args.join(' ')}: ${result.stdout}${result.stderr}`,
      ).toBe(0);
    }
  }, 600_000);

  it('changes nothing when run again', async () => {
    const before = await readFile(join(project, 'package.json'), 'utf8');
    const lock = await readFile(join(project, 'package-lock.json'), 'utf8');

    const again = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', SECOND, '--json'],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );

    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).changed).toBe(false);
    expect(await readFile(join(project, 'package.json'), 'utf8')).toBe(before);
    expect(await readFile(join(project, 'package-lock.json'), 'utf8')).toBe(
      lock,
    );
  }, 300_000);

  it('leaves the project on its working version when an upgrade fails', async () => {
    const before = await readFile(join(project, 'package.json'), 'utf8');

    // A version the registry does not have: the install fails, and the
    // question is what the project is left pinned to.
    const failed = await run(
      join(project, 'node_modules/.bin/mallok'),
      ['upgrade', '--to', '9.9.99'],
      project,
      { npm_config_registry: registry?.origin ?? '' },
    );

    expect(failed.code).not.toBe(0);
    expect(await readFile(join(project, 'package.json'), 'utf8')).toBe(before);
    const installed = JSON.parse(
      await readFile(join(project, 'node_modules/mallok/package.json'), 'utf8'),
    ) as { version: string };
    expect(installed.version).toBe(SECOND);
  }, 600_000);

  it('refuses a range instead of a version', async () => {
    for (const version of ['^9.9.1', 'latest', '9.9', '']) {
      const refused = await run(
        join(project, 'node_modules/.bin/mallok'),
        ['upgrade', '--to', version],
        project,
      );
      expect(refused.code, version).not.toBe(0);
    }
  }, 120_000);
});

/**
 * The migration record, exercised with a fixture.
 *
 * `PROJECT_MIGRATIONS` is empty in this release — inventing one to
 * demonstrate the mechanism would be a lie in the shape of a feature — so the
 * mechanism is tested with a migration injected here.
 */
describe('project migrations run exactly once', () => {
  const report = makeReporter(true);

  function counting(): { migration: ProjectMigration; runs: () => number } {
    let runs = 0;
    return {
      migration: {
        id: '2026-09-11-fixture',
        description: 'a fixture migration',
        apply: async (dir) => {
          runs++;
          await writeFile(join(dir, 'migrated.txt'), String(runs), 'utf8');
          return true;
        },
      },
      runs: () => runs,
    };
  }

  it('applies a pending migration, then never again', async () => {
    const { migration, runs } = counting();
    const options = {
      projectDir: project,
      migrations: [migration],
      skipChecks: true,
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
    };

    const first = await upgradeProject({ ...options, to: '9.9.2' }, report);
    expect(first.migrationsApplied).toEqual(['2026-09-11-fixture']);
    expect(runs()).toBe(1);

    // Same version again: nothing pending, nothing done.
    const second = await upgradeProject({ ...options, to: '9.9.2' }, report);
    expect(second.changed).toBe(false);
    expect(runs()).toBe(1);

    // A *later* version: the framework moves, but a migration that has
    // already been applied is not applied a second time.
    const third = await upgradeProject({ ...options, to: '9.9.3' }, report);
    expect(third.migrationsApplied).toEqual([]);
    expect(runs()).toBe(1);

    const history = JSON.parse(
      await readFile(join(project, '.mallok/upgrades.json'), 'utf8'),
    ) as { applied: string[]; versions: { to: string }[] };
    expect(history.applied).toEqual(['2026-09-11-fixture']);
    // The earlier real upgrade to 9.9.1 is in this history too: it is the
    // same project, and the record is cumulative on purpose.
    expect(history.versions.map((entry) => entry.to)).toEqual([
      SECOND,
      '9.9.2',
      '9.9.3',
    ]);
  }, 120_000);
});
