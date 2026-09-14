import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deliverSecret } from '../../src/cli/deliver.js';
import { readLedger } from '../../src/cli/ledger.js';
import { makeReporter } from '../../src/cli/output.js';
import { rotateSetupKey } from '../../src/cli/setup-key.js';
import { fakeCloudflare } from './helpers/fake-wrangler.js';

const execFileAsync = promisify(execFile);

/** The repository root, so the built CLI is found from any working directory. */
const REPO = process.cwd();

/**
 * Where a setup key is allowed to go, and when it counts as delivered.
 *
 * Three things had to be true and only one of them was.
 *
 * **One delivery path.** `create` awaited a hand-over before recording it;
 * `mallok setup-key` returned the key to its caller, which printed it
 * afterwards and then — separately — wrote `setupKeyDeliveredAt`. Same bug,
 * second copy: an interruption between the two leaves a key that exists on
 * the Worker and is known to nobody, on a site the ledger believes is
 * finished.
 *
 * **Never in the JSON.** `--json` output is what gets piped into a file or a
 * CI log. A credential that lands there outlives its one use by however long
 * that log is kept.
 *
 * **Never mixed.** stdout is either a machine-readable document or a
 * human-readable one. A key printed beside JSON corrupts the JSON *and*
 * leaks the key.
 */

const report = makeReporter(true, true);

let workspace = '';

const LEDGER = {
  schemaVersion: 2,
  accountId: 'acct-1',
  directory: '/anywhere',
  slug: 'acme',
  domain: null,
  fingerprint: 'f',
  startedAt: '2026-09-14T00:00:00.000Z',
  origin: 'https://acme.example.workers.dev',
  secrets: ['MALLOK_SECRET', 'MALLOK_SETUP_KEY'],
};

async function project(): Promise<string> {
  const dir = join(workspace, 'site');
  await mkdir(join(dir, '.mallok'), { recursive: true });
  await mkdir(join(dir, 'node_modules/.bin'), { recursive: true });
  await writeFile(join(dir, 'node_modules/.bin/wrangler'), '#!/bin/sh\n', {
    mode: 0o755,
  });
  await writeFile(
    join(dir, '.mallok/create-state.json'),
    JSON.stringify(LEDGER),
    'utf8',
  );
  await writeFile(
    join(dir, '.mallok/sites.json'),
    JSON.stringify({ schemaVersion: 1, sites: [] }),
    'utf8',
  );
  return dir;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-key-output-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('mallok setup-key records delivery only after the hand-over', () => {
  it('leaves the ledger undelivered when the write fails', async () => {
    // `mallok setup-key | head -1` is enough to produce this.
    const dir = await project();
    const fake = fakeCloudflare();

    await expect(
      rotateSetupKey(
        {
          projectDir: dir,
          run: fake.run,
          hasAdministrator: async () => false,
          deliver: () => {
            throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
          },
        },
        report,
      ),
    ).rejects.toThrow();

    const ledger = await readLedger(dir);
    expect(ledger?.setupKeyDeliveredAt).toBeUndefined();
  });

  it('rotates and shows a new one on the retry', async () => {
    const dir = await project();
    const first = fakeCloudflare();
    await rotateSetupKey(
      {
        projectDir: dir,
        run: first.run,
        hasAdministrator: async () => false,
        deliver: () => {
          throw new Error('write EPIPE');
        },
      },
      report,
    ).catch(() => undefined);

    const delivered: string[] = [];
    const second = fakeCloudflare({ account: first.account });
    const result = await rotateSetupKey(
      {
        projectDir: dir,
        run: second.run,
        hasAdministrator: async () => false,
        deliver: (key) => {
          delivered.push(key);
        },
      },
      report,
    );

    expect(delivered).toEqual([result.setupKey]);
    expect((await readLedger(dir))?.setupKeyDeliveredAt).toBeDefined();
  });

  it('records the delivery only once the hand-over has returned', async () => {
    const dir = await project();
    const fake = fakeCloudflare();
    let duringDelivery: string | undefined = 'not read';

    await rotateSetupKey(
      {
        projectDir: dir,
        run: fake.run,
        hasAdministrator: async () => false,
        deliver: async () => {
          duringDelivery = (await readLedger(dir))?.setupKeyDeliveredAt;
        },
      },
      report,
    );

    expect(duringDelivery).toBeUndefined();
    expect((await readLedger(dir))?.setupKeyDeliveredAt).toBeDefined();
  });

  it('never returns the key in a field a JSON summary could carry', async () => {
    // The value is handed to `deliver` and nowhere else.
    const dir = await project();
    const fake = fakeCloudflare();
    const delivered: string[] = [];

    const result = await rotateSetupKey(
      {
        projectDir: dir,
        run: fake.run,
        hasAdministrator: async () => false,
        deliver: (key) => {
          delivered.push(key);
        },
      },
      report,
    );

    const onDisk = await readFile(
      join(dir, '.mallok/create-state.json'),
      'utf8',
    );
    expect(onDisk).not.toContain(result.setupKey);
    expect(delivered).toEqual([result.setupKey]);
  });
});

describe('the shared delivery function', () => {
  it('resolves only when the stream accepted the write', async () => {
    const written: string[] = [];
    const stream = {
      write(chunk: string, callback: (error?: Error | null) => void) {
        written.push(chunk);
        setTimeout(() => {
          callback(null);
        }, 1);
        return true;
      },
    };

    await deliverSecret(stream, 'MALLOK_SETUP_KEY', 'the-key');

    expect(written.join('')).toContain('the-key');
    expect(written.join('')).toContain('MALLOK_SETUP_KEY');
  });

  it('rejects when the stream reports a failed write', async () => {
    const stream = {
      write(_chunk: string, callback: (error?: Error | null) => void) {
        callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
        return false;
      },
    };

    await expect(
      deliverSecret(stream, 'MALLOK_SETUP_KEY', 'the-key'),
    ).rejects.toThrow(/EPIPE/);
  });
});

/** The real binary, so what reaches stdout is what a user would see. */
async function cli(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('VITEST') || key.startsWith('npm_')) {
      delete environment[key];
    }
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [join(REPO, 'dist/pkg/cli/index.js'), ...args],
      { cwd, env: environment, maxBuffer: 1 << 24 },
    );
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

describe('the real CLI, on stdout', () => {
  it('refuses --json for setup-key before touching anything remote', async () => {
    // There is no safe place for a credential in machine-readable output, so
    // the command refuses the combination rather than choosing one. It
    // refuses **first**: a refusal after `secret put` would have rotated a
    // key nobody then received.
    const dir = await project();

    const result = await cli(['setup-key', '--json'], dir);

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/--json|terminal/i);
    // Nothing was written to the Worker, so the ledger is untouched.
    expect((await readLedger(dir))?.setupKeyDeliveredAt).toBeUndefined();
  }, 60_000);

  it('refuses --json for create before touching anything remote', async () => {
    const dir = join(workspace, 'fresh');
    await mkdir(dir, { recursive: true });

    const result = await cli(['create', 'a-site', '--json'], dir);

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/--json|terminal/i);
  }, 60_000);

  it('writes nothing at all to stdout when it refuses', async () => {
    // The refusal has to leave stdout empty, not merely free of the key: a
    // caller that parses this output must see either one document or none,
    // never a document with an explanation stuck to it.
    const dir = await project();

    const result = await cli(['setup-key', '--json'], dir);

    expect(result.stdout.trim()).toBe('');
  }, 60_000);

  it('prints a single JSON document for a command that does support it', async () => {
    // The contract the refusal protects: where `--json` is accepted, stdout
    // is exactly one document and nothing else.
    const bundle = join(workspace, 'bundle', 'a');
    await mkdir(bundle, { recursive: true });
    await writeFile(
      join(bundle, 'index.md'),
      '---\ntitle: Hi\n---\n\nBody\n',
      'utf8',
    );

    const result = await cli(
      [
        'preview',
        join(workspace, 'bundle'),
        '--out',
        join(workspace, 'out'),
        '--theme',
        join(REPO, 'src/themes/atelier'),
        '--kind',
        'article',
        '--json',
      ],
      workspace,
    );

    expect(result.code, result.stderr).toBe(0);
    const documents = result.stdout.trim().split('\n').filter(Boolean);
    expect(documents).toHaveLength(1);
    expect(() => JSON.parse(documents[0] as string)).not.toThrow();
  }, 60_000);
});
