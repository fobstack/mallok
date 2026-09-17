import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  currentAccountId,
  findBucket,
  findDatabase,
  findWorker,
  secretNames,
  wranglerFor,
} from '../../src/cli/cloudflare.js';
import { destroySteps } from '../../src/cli/destroy.js';

const execFileAsync = promisify(execFile);

/**
 * Every **flag** this project passes to Wrangler must exist in the Wrangler
 * this project locks.
 *
 * `wrangler-contract.test.ts` checks that each *subcommand* exists, and that
 * is not the same question. `wrangler r2 bucket domain list` exists; the
 * `--json` this code passed it does not, and the subcommand check waved it
 * through. The result was a destroy that could only work against a fake.
 *
 * So this does not read a hand-written list. It drives the **real production
 * functions** with a runner that records what they ask for, and validates
 * those exact argument vectors against the locked binary's own `--help`. A
 * call that is never made is never checked, and a call that changes shape is
 * re-checked automatically.
 */

/** Long flags the locked Wrangler documents for a subcommand path. */
async function realFlags(path: readonly string[]): Promise<Set<string>> {
  const { stdout } = await execFileAsync(
    'node_modules/.bin/wrangler',
    [...path, '--help'],
    { cwd: process.cwd(), maxBuffer: 1 << 22 },
  );
  const flags = new Set<string>();
  for (const line of stdout.split('\n')) {
    // Only a flag in the left-hand column counts. A `--foo` mentioned inside
    // a description is prose, and treating it as support is how a check like
    // this becomes decorative.
    const match = /^\s+(?:-[a-zA-Z], )?(--[a-z0-9-]+)\b/.exec(line);
    if (match?.[1] !== undefined) {
      flags.add(match[1]);
    }
  }
  return flags;
}

/** Whether the locked Wrangler has a subcommand at this path. */
async function exists(path: readonly string[]): Promise<boolean> {
  try {
    await execFileAsync('node_modules/.bin/wrangler', [...path, '--help'], {
      cwd: process.cwd(),
      maxBuffer: 1 << 22,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Splits a recorded argv into the subcommand path and the flags passed to it.
 *
 * The longest leading run of non-flag words that Wrangler answers `--help`
 * for is the subcommand; anything after it is positional. `secret put` is a
 * path, `secret put MALLOK_SECRET` is that path plus a positional, and
 * telling them apart by asking Wrangler is more reliable than counting words.
 */
async function split(
  argv: readonly string[],
): Promise<{ path: string[]; flags: string[] }> {
  const words: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith('-')) {
      break;
    }
    words.push(argument);
  }
  let path = words;
  while (path.length > 1 && !(await exists(path))) {
    path = path.slice(0, -1);
  }
  const flags = argv.filter((argument) => argument.startsWith('--'));
  return { path, flags };
}

/** A runner that records, and answers plausibly enough to keep going. */
function recorder() {
  const seen: string[][] = [];
  return {
    seen,
    run: async (_command: string, args: readonly string[]) => {
      seen.push([...args]);
      // Shapes each caller can parse. Nothing here claims a *field* the real
      // CLI does not emit — these exist only so the caller runs to the end
      // and the next call is recorded too.
      if (args.includes('whoami')) {
        return {
          code: 0,
          stdout: JSON.stringify([{ name: 'Test', id: 'acct-1' }]),
          stderr: '',
        };
      }
      if (args[0] === 'secret' && args[1] === 'list') {
        return { code: 0, stdout: '[]', stderr: '' };
      }
      if (args[0] === 'deployments') {
        return { code: 0, stdout: '[]', stderr: '' };
      }
      if (args[0] === 'd1' && args[1] === 'info') {
        return {
          code: 0,
          stdout: JSON.stringify({ uuid: 'db-1' }),
          stderr: '',
        };
      }
      return { code: 0, stdout: '{}', stderr: '' };
    },
  };
}

let workspace = '';

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-flags-'));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Every argv the read-only probes and the destroy steps really produce. */
async function recordedCalls(): Promise<string[][]> {
  const fake = recorder();
  const wrangler = wranglerFor(workspace, fake.run);

  await currentAccountId(wrangler);
  await findDatabase(wrangler, 'mallok-acme-db');
  await findBucket(wrangler, 'mallok-acme-media');
  await findWorker(wrangler, 'mallok-acme');
  await secretNames(wrangler, 'mallok-acme');

  return [...fake.seen, ...destroySteps('acme').map((step) => [...step.args])];
}

describe('every flag we pass exists in the locked Wrangler', () => {
  it('reports the version this contract is pinned to', async () => {
    const { stdout } = await execFileAsync(
      'node_modules/.bin/wrangler',
      ['--version'],
      { cwd: process.cwd() },
    );
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('accepts every argument vector the CLI actually builds', async () => {
    const calls = await recordedCalls();
    expect(calls.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const argv of calls) {
      const { path, flags } = await split(argv);
      expect(await exists(path), `wrangler ${path.join(' ')}`).toBe(true);
      const supported = await realFlags(path);
      for (const flag of flags) {
        if (!supported.has(flag)) {
          offenders.push(`wrangler ${path.join(' ')} … ${flag}`);
        }
      }
    }

    // Before the fix this listed:
    //   wrangler r2 bucket domain list … --json
    expect(offenders).toEqual([]);
  }, 120_000);
});
