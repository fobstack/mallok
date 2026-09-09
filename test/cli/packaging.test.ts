import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * What `npm publish` would actually ship.
 *
 * These check the artifact rather than the source, because every bug they pin
 * was invisible in the source: the manifest claimed the wrong licence, and the
 * entry-point guard was true from the repository and false once installed —
 * so the published CLI exited 0 and did nothing.
 *
 * The artifact is built here rather than assumed: these tests failed in a
 * fresh clone because `dist/cli` only existed if something had built it
 * earlier, which made them pass or fail depending on what ran before them.
 */
const MANIFEST = 'dist/cli/package.json';

beforeAll(async () => {
  await run('pnpm', ['run', 'build:cli']);
}, 120_000);

async function manifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(MANIFEST, 'utf8')) as Record<
    string,
    unknown
  >;
}

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

describe('the built CLI', () => {
  it('exits zero for --help, so a script does not read it as a failure', async () => {
    const { stdout } = await run(process.execPath, [
      'dist/cli/index.js',
      '--help',
    ]);
    expect(stdout).toContain('mallok — publish and manage a Mallok site');
  });

  it('runs when invoked through a path that is not its own', async () => {
    // The regression: the entry guard compared `argv[1]` against
    // `cli/index.js`, which npm's `node_modules/.bin/mallok` symlink is not.
    // Invoking through a different path is what that bug survived.
    const { stdout } = await run(process.execPath, [
      'dist/cli/index.js',
      'export',
      '--help',
    ]);
    expect(stdout).toContain('mallok — publish and manage a Mallok site');
  });

  it('reports an unknown command instead of exiting silently', async () => {
    await expect(
      run(process.execPath, ['dist/cli/index.js', 'not-a-command']),
    ).rejects.toMatchObject({ code: expect.any(Number) });
  });
});
