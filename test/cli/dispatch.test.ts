import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, VERSION } from '../../src/cli/index.js';
import { EXIT } from '../../src/cli/output.js';

/**
 * The command dispatcher, driven in process.
 *
 * `test/cli/package-release.test.ts` runs the installed binary as a real
 * subprocess, which is the only way to prove the published package works —
 * but a subprocess proves one path per spawn and is far too slow to cover the
 * argument and error handling. This covers the routing table itself: which
 * exit code each shape of invocation produces, and that the site commands
 * refuse to run without an address or a token instead of failing later
 * against a real site (docs/CLI.md §11, §12).
 */

interface Captured {
  readonly out: string;
  readonly err: string;
  readonly code: number;
}

/** Runs one invocation with both streams captured. */
async function run(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
  const errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    });
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    const code = await main(argv);
    return { out: out.join(''), err: err.join(''), code };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the mallok command line', () => {
  it('prints a version and succeeds', async () => {
    const result = await run(['--version']);

    expect(result.code).toBe(EXIT.ok);
    expect(result.out.trim()).toBe(VERSION);
    expect(result.out.trim()).not.toBe('');
  });

  it('treats --help as a success and a bare invocation as a usage error', async () => {
    const help = await run(['--help']);
    const bare = await run([]);
    const commandHelp = await run(['publish', '--help']);

    expect(help.code).toBe(EXIT.ok);
    expect(help.out).toContain('mallok — publish and manage a Mallok site');
    // A working install must not report failure for `--help`; scripts read
    // that as a broken binary.
    expect(commandHelp.code).toBe(EXIT.ok);
    expect(bare.code).toBe(EXIT.user);
    expect(bare.out).toContain('mallok publish <dir>');
  });

  it('rejects an unknown command and an unknown media subcommand', async () => {
    const unknown = await run(['frobnicate']);
    const media = await run(['media', 'list']);

    expect(unknown.code).toBe(EXIT.user);
    expect(unknown.err).toContain('Unknown command "frobnicate"');
    expect(media.code).toBe(EXIT.user);
    expect(media.err).toContain('The only media command is "push"');
  });

  it('reports a malformed flag as a usage error', async () => {
    const result = await run(['publish', '--kind']);

    expect(result.code).toBe(EXIT.user);
    expect(result.err).toContain('Error:');
  });

  it('asks for a directory before it asks for anything else', async () => {
    for (const command of ['publish', 'import', 'export']) {
      const result = await run([command], { MALLOK_TOKEN: 'token' });
      expect(result.code, command).toBe(EXIT.user);
      expect(result.err, command).toContain('needs a');
    }
  });

  it('refuses a site command with no address and no token', async () => {
    const cwd = process.cwd();
    const empty = await mkdtemp(join(tmpdir(), 'mallok-cli-'));
    process.chdir(empty);
    try {
      const noSite = await run(['publish', 'content'], {
        MALLOK_TOKEN: 'token',
      });
      expect(noSite.code).toBe(EXIT.user);
      expect(noSite.err).toContain('No site specified.');

      const noToken = await run(
        ['publish', 'content', '--url', 'https://example.com'],
        { MALLOK_TOKEN: undefined },
      );
      expect(noToken.code).toBe(EXIT.auth);
      expect(noToken.err).toContain('No API token.');
      // The hint must say where a token comes from, not print one.
      expect(noToken.err).toContain('MALLOK_TOKEN');
    } finally {
      process.chdir(cwd);
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('names an unknown --site and lists the ones it knows', async () => {
    const cwd = process.cwd();
    const dir = await mkdtemp(join(tmpdir(), 'mallok-cli-'));
    await mkdir(join(dir, '.mallok'), { recursive: true });
    await writeFile(
      join(dir, '.mallok/sites.json'),
      JSON.stringify({ sites: { live: { origin: 'https://live.example' } } }),
    );
    process.chdir(dir);
    try {
      const result = await run(['publish', 'content', '--site', 'staging'], {
        MALLOK_TOKEN: 'token',
      });

      expect(result.code).toBe(EXIT.user);
      expect(result.err).toContain('No site named "staging"');
      expect(result.err).toContain('Known sites: live.');
    } finally {
      process.chdir(cwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * One end-to-end run of `mallok publish` and `mallok export` over a stubbed
 * site: real files on disk, the real scan, the real publish loop, and the
 * dispatcher's own JSON and exit-code handling.
 */
describe('a publish and export round trip', () => {
  let dir = '';
  let saved: Record<string, unknown>[] = [];

  /** Answers the handful of endpoints these two commands call. */
  function stubSite(options: { readonly failSave?: boolean } = {}): void {
    saved = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = url.replace('https://example.com/_mallok/api', '');
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (path === '/settings') {
        return json({
          defaultLocale: 'en',
          kinds: { article: { base: 'articles' }, page: { base: '' } },
          maxImageEdge: null,
        });
      }
      if (path === '/theme') {
        return json({ imageWidths: [320], kinds: { article: {} } });
      }
      if (path === '/media/check') {
        return json({ existing: [] });
      }
      if (path === '/content') {
        if (options.failSave === true) {
          return json({ error: 'The site is unwell.' }, 500);
        }
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        saved.push(body);
        return json({ id: '1', path: `/articles/${String(body.slug)}` });
      }
      if (path === '/export') {
        return json({
          files: [
            {
              path: 'articles/hello/index.md',
              text: '---\ntitle: H\n---\n\nB',
            },
          ],
          counts: { content: 1, files: 1, media: 0 },
        });
      }
      return json({ error: `unexpected ${path}` }, 404);
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mallok-roundtrip-'));
    await mkdir(join(dir, 'content/article/hello'), { recursive: true });
    await writeFile(
      join(dir, 'content/article/hello/index.md'),
      '---\ntitle: Hello\n---\n\nBody text.\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('publishes what it scanned and prints a machine-readable summary', async () => {
    stubSite();

    const result = await run(
      [
        'publish',
        join(dir, 'content'),
        '--url',
        'https://example.com',
        '--json',
      ],
      { MALLOK_TOKEN: 'token' },
    );

    expect(result.code).toBe(EXIT.ok);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.slug).toBe('hello');
    const summary = JSON.parse(result.out) as {
      command: string;
      counts: { total: number; failed: number };
    };
    expect(summary.command).toBe('publish');
    expect(summary.counts).toEqual({ total: 1, unchanged: 0, failed: 0 });
  });

  it('returns the remote exit code when every item fails', async () => {
    stubSite({ failSave: true });

    const result = await run(
      ['publish', join(dir, 'content'), '--url', 'https://example.com'],
      { MALLOK_TOKEN: 'token' },
    );

    expect(result.code).toBe(EXIT.remote);
    expect(result.out).toContain('failed');
  });

  it('writes an export to the directory it was given', async () => {
    stubSite();
    const target = join(dir, 'exported');

    const result = await run(
      ['export', target, '--url', 'https://example.com', '--json'],
      { MALLOK_TOKEN: 'token' },
    );

    expect(result.code).toBe(EXIT.ok);
    expect(
      await readFile(join(target, 'articles/hello/index.md'), 'utf8'),
    ).toBe('---\ntitle: H\n---\n\nB');
  });
});

/**
 * `mallok destroy` deletes a Worker, a database and a bucket, so what is
 * worth pinning is everything that has to be true *before* the first delete
 * runs: the slug is known, the confirmation matches, and a dry run reaches no
 * further than the report.
 */
describe('mallok destroy', () => {
  let dir = '';
  const cwd = process.cwd();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mallok-destroy-'));
    await mkdir(join(dir, '.mallok'), { recursive: true });
    await writeFile(
      join(dir, '.mallok/sites.json'),
      JSON.stringify({
        sites: [
          {
            slug: 'acme',
            origin: 'https://acme.example',
            domain: null,
            accountId: null,
            databaseId: null,
            bucket: 'mallok-acme-media',
            ratelimitNs: 1001,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  });

  it('needs the slug repeated before it deletes anything', async () => {
    const result = await run(['destroy', 'acme']);

    expect(result.code).toBe(EXIT.user);
    expect(result.err).toContain('permanently deletes');
    expect(result.err).toContain('mallok destroy acme --confirm acme');
    // The registry is untouched, so nothing has been given up on yet.
    expect(await readFile(join(dir, '.mallok/sites.json'), 'utf8')).toContain(
      'acme',
    );
  });

  it('refuses a slug it has no record of', async () => {
    const result = await run(['destroy', 'ghost', '--confirm', 'ghost']);

    expect(result.code).toBe(EXIT.user);
    expect(result.err).toContain('no record of a site called "ghost"');
    expect(result.err).toContain('Known sites here: acme.');
  });

  it('asks for a slug at all', async () => {
    const result = await run(['destroy']);

    expect(result.code).toBe(EXIT.user);
    expect(result.err).toContain('needs a site slug');
  });

  it('runs no wrangler at all for a dry run, and keeps the registry', async () => {
    const result = await run([
      'destroy',
      'acme',
      '--confirm',
      'acme',
      '--dry-run',
      '--json',
    ]);

    expect(result.code).toBe(EXIT.ok);
    const summary = JSON.parse(result.out) as {
      results: { step: string; detail: string }[];
    };
    expect(summary.results.map((row) => row.detail)).toEqual([
      'dry run',
      'dry run',
      'dry run',
    ]);
    // There is no wrangler binary in this directory; a dry run that reached
    // one would have failed here rather than reporting three steps.
    expect(await readFile(join(dir, '.mallok/sites.json'), 'utf8')).toContain(
      'acme',
    );
  });

  it('stops rather than guessing when the project has no Wrangler', async () => {
    const result = await run(['destroy', 'acme', '--confirm', 'acme']);

    // Deleting with `npx wrangler` would mean whatever version the registry
    // publishes today deleting this account's resources. Without the
    // project's own binary there is nothing to run, and the run stops before
    // any delete rather than falling back.
    expect(result.code).not.toBe(EXIT.ok);
    expect(result.err.toLowerCase()).toMatch(/wrangler|sign(ed)? in/);
  });
});
