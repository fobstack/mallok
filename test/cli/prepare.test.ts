import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, join as joinPath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError, makeReporter } from '../../src/cli/output.js';
import {
  assertNpmProject,
  installArgs,
  LOCKFILE,
} from '../../src/cli/package-manager.js';
import { prepareAssets } from '../../src/cli/prepare.js';

/**
 * `mallok prepare`, and the choice of package manager.
 *
 * Between them these two decide whether a generated project can build at all
 * on a machine that has only what the documentation asks for.
 */

// Quiet: the second argument silences the step-by-step progress the CLI
// writes to stderr. Without it a passing run buries any real warning under a
// few hundred lines of "Creating database…", and "is stderr clean?" stops
// being a question anybody can answer by looking.
const report = makeReporter(true, true);

/**
 * The assets the built package carries.
 *
 * `dist/pkg` is built once for this project by the `globalSetup` in
 * vitest.config.ts, so this is the real directory a user would install —
 * not a fixture standing in for it.
 */
const PACKAGE_ASSETS = joinPath(process.cwd(), 'dist/pkg/assets');

describe('which package manager', () => {
  it('is npm, and only npm', () => {
    // 0.1.0-rc.3 offered a choice of npm or pnpm. npm was tested end to end;
    // pnpm was not, and when it finally was, it could not install the
    // candidate package from the local registry the release test serves it
    // from. A flag for an unexercised path is a claim, so the flag is gone.
    expect(LOCKFILE).toBe('package-lock.json');
    expect(installArgs()).toEqual(['install']);
  });

  it('refuses a project another manager owns', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mallok-foreign-'));
    try {
      await writeFile(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const error = await assertNpmProject(project).catch(
        (cause: unknown) => cause,
      );

      // Running `npm ci` here would resolve a different tree from the one its
      // owner tested and write a second lockfile beside the first.
      expect(error).toBeInstanceOf(CliError);
      expect(String(error)).toContain('pnpm-lock.yaml');
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it('accepts a project with only an npm lockfile', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mallok-npm-'));
    try {
      await writeFile(join(project, 'package-lock.json'), '{}\n');
      await expect(assertNpmProject(project)).resolves.toBeUndefined();
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

describe('mallok prepare', () => {
  let project = '';

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'mallok-prepare-'));
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it('stages the admin application the package carries', async () => {
    const result = await prepareAssets(project, report, PACKAGE_ASSETS);

    // A site cannot build the admin itself — it has no React, no Vite and no
    // admin source. This is how the compiled application reaches its
    // `dist/assets`, which is what Wrangler uploads.
    expect(result.assets).toBeGreaterThan(0);
    await expect(
      stat(join(project, 'dist/assets/_mallok/app/index.html')),
    ).resolves.toBeDefined();
    expect(result.projectTheme).toBeNull();
  });

  it('rebuilds the directory rather than merging into it', async () => {
    await mkdir(join(project, 'dist/assets'), { recursive: true });
    await writeFile(
      join(project, 'dist/assets/left-over.js'),
      'from an older version',
      'utf8',
    );

    await prepareAssets(project, report, PACKAGE_ASSETS);

    // An asset left behind by an older Mallok is a file the site still serves
    // and nobody can explain.
    await expect(
      stat(join(project, 'dist/assets/left-over.js')),
    ).rejects.toThrow();
  });

  it('validates and stages a theme the project owns', async () => {
    const theme = join(project, 'src/theme');
    await mkdir(join(theme, 'layouts'), { recursive: true });
    await mkdir(join(theme, 'assets'), { recursive: true });
    await writeFile(
      join(theme, 'theme.json'),
      JSON.stringify({
        themeApi: 1,
        id: 'mine',
        name: 'Mine',
        description: 'A theme belonging to this project.',
        version: '1.0.0',
        home: 'layouts/page.liquid',
        kinds: { page: { layout: 'layouts/page.liquid', label: 'Page' } },
        options: {},
        locales: ['en'],
        defaultLocale: 'en',
        imageWidths: [480, 960],
        clientScripts: [],
      }),
      'utf8',
    );
    await writeFile(
      join(theme, 'layouts/page.liquid'),
      '<!doctype html><html><body>{{ content.body }}</body></html>',
      'utf8',
    );
    await mkdir(join(theme, 'locales'), { recursive: true });
    await writeFile(
      join(theme, 'locales/en.json'),
      JSON.stringify({ 'nav.home': 'Home' }),
      'utf8',
    );
    await writeFile(join(theme, 'assets/style.css'), 'body{margin:0}', 'utf8');

    const result = await prepareAssets(project, report, PACKAGE_ASSETS);

    expect(result.projectTheme).toBe('mine@1.0.0');
    // Staged under the theme's version, so its URLs are immutable.
    await expect(
      stat(join(project, 'dist/assets/theme/mine/1.0.0/style.css')),
    ).resolves.toBeDefined();
    const headers = await readFile(
      join(project, 'dist/assets/_headers'),
      'utf8',
    );
    expect(headers).toContain('immutable');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
  });

  it('fails in the author’s terminal, not at first render', async () => {
    const theme = join(project, 'src/theme');
    await mkdir(theme, { recursive: true });
    await writeFile(join(theme, 'theme.json'), '{ "id": "broken" }', 'utf8');

    const error = await prepareAssets(project, report, PACKAGE_ASSETS).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(CliError);
    expect(String(error)).toContain('src/theme is not a valid theme');
  });
});
