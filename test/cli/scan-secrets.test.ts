import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * The history scanner, run against real repositories.
 *
 * A scanner is only worth having if it fails on the thing it exists for, so
 * every case here plants a credential in a real Git history and checks the
 * exit code — rather than testing the regular expressions in isolation, which
 * would pass even if the scanner never read a single blob.
 */

const SCANNER = join(process.cwd(), 'scripts/scan-secrets.mjs');

let repo = '';

async function git(...args: string[]): Promise<void> {
  await run('git', args, { cwd: repo });
}

async function commit(files: Record<string, string>): Promise<void> {
  for (const [path, body] of Object.entries(files)) {
    const full = join(repo, path);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body, 'utf8');
  }
  await git('add', '-A');
  await git('commit', '-m', 'change', '--no-gpg-sign');
}

async function scan(): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run('node', [SCANNER], {
      cwd: repo,
      maxBuffer: 1 << 24,
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      out: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'mallok-scan-'));
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'test@example.test');
  await git('config', 'user.name', 'Test');
  await commit({ 'README.md': '# Nothing to see here\n' });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('what the scanner catches', () => {
  for (const [label, body] of [
    [
      'a private key block',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n',
    ],
    ['an AWS access key id', 'const key = "AKIAIOSFODNN7EXAMPLE";\n'],
    ['a GitHub token', 'GITHUB=ghp_0123456789abcdefghijklmnopqrstuvwxyzAB\n'],
    [
      'a Mallok API token',
      'export const token = "mlk_live_abcdef0123456789xyz";\n',
    ],
    [
      'a Cloudflare token in an assignment',
      'CF_API_TOKEN=0123456789abcdef0123456789abcdef01234567\n',
    ],
    [
      'a secret assigned a long literal',
      'MALLOK_SECRET = "aGVsbG8gdGhpcyBpcyBhIHNlY3JldCB2YWx1ZQ=="\n',
    ],
  ] as const) {
    it(`fails on ${label}`, async () => {
      await commit({ 'src/leak.ts': body });

      const result = await scan();

      expect(result.code).toBe(1);
      expect(result.out).toContain('src/leak.ts');
    });
  }

  it('fails on a file that must never have been committed', async () => {
    await commit({ '.dev.vars': 'MALLOK_SECRET=anything\n' });

    const result = await scan();

    expect(result.code).toBe(1);
    expect(result.out).toContain('.dev.vars');
  });

  it('finds a secret in history after it is deleted from the tree', async () => {
    await commit({ 'src/leak.ts': 'const k = "AKIAIOSFODNN7EXAMPLE";\n' });
    await commit({ 'src/leak.ts': 'const k = process.env.KEY;\n' });

    // The whole reason this reads blobs rather than the working tree.
    const result = await scan();

    expect(result.code).toBe(1);
  });

  it('examines long lines, where a bundled credential ends up', async () => {
    // This used to skip any line over 4096 characters, which is every line of
    // every minified bundle.
    const padding = 'a'.repeat(8000);
    await commit({
      'dist/app.js': `const x="${padding}";const k="AKIAIOSFODNN7EXAMPLE";\n`,
    });

    const result = await scan();

    expect(result.code).toBe(1);
  });

  it('never prints the value it found', async () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    await commit({ 'src/leak.ts': `const k = "${secret}";\n` });

    const result = await scan();

    expect(result.code).toBe(1);
    expect(result.out).not.toContain(secret);
    // It says enough to go and look, and no more.
    expect(result.out).toContain('src/leak.ts');
    expect(result.out).toContain('rule:');
    expect(result.out).toContain('fingerprint:');
  });
});

describe('what the scanner lets past', () => {
  it('passes a repository with no credentials', async () => {
    await commit({
      'docs/SECURITY.md': 'Set MALLOK_SECRET with wrangler secret put.\n',
      'src/app.ts': 'const token = process.env.MALLOK_TOKEN;\n',
    });

    const result = await scan();

    expect(result.code).toBe(0);
    expect(result.out).toContain('No unreviewed credentials found.');
  });

  it('ignores lockfiles, whose hashes match nothing meaningful', async () => {
    await commit({
      'package-lock.json': `{"integrity":"sha512-${'a'.repeat(60)}"}\n`,
    });

    expect((await scan()).code).toBe(0);
  });
});

describe('acknowledgements are tied to a value, not a file', () => {
  it('fails when an acknowledged file gains a different secret', async () => {
    // The bug this is here for: an entry keyed by path and rule silences
    // every future match of that rule in that file, including the real
    // credential somebody adds next year.
    await commit({
      'test/worker/secret-check.test.ts': [
        "const KEY = 're_live_supersecret_value';",
        "const REAL = 're_live_this_one_is_actually_real_abc';",
      ].join('\n'),
    });

    const result = await scan();

    expect(result.code).toBe(1);
    expect(result.out).toContain('secret-check.test.ts');
    // The reviewed one is acknowledged; the new one is not.
    expect(result.out).toContain('Acknowledged');
    expect(result.out).toContain('finding(s)');
  });

  it('accepts the exact value that was reviewed', async () => {
    await commit({
      'test/worker/secret-check.test.ts':
        "const KEY = 're_live_supersecret_value';\n",
    });

    const result = await scan();

    expect(result.code).toBe(0);
    expect(result.out).toContain('Acknowledged');
  });
});

describe('a scan that cannot run is a failure', () => {
  it('exits non-zero outside a Git repository', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mallok-not-a-repo-'));
    try {
      const result = await run('node', [SCANNER], { cwd: empty }).then(
        () => ({ code: 0, out: '' }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          code: error.code ?? 1,
          out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      );

      // "The scan crashed" and "the scan found nothing" must never look the
      // same to whoever reads the gate.
      expect(result.code).toBe(1);
      expect(result.out).toContain('could not complete');
      expect(result.out).toContain('nothing was ruled out');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
