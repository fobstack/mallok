import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandRunner, RunResult } from '../../../src/cli/cloudflare.js';

/**
 * A Cloudflare account that remembers what was done to it, and a Wrangler
 * that talks to it.
 *
 * The point is the **counting**: `mutations()` returns the mutating calls, in
 * order, so a test can assert that a failed preflight produced none at all and
 * that a finished run produced exactly five. A fake that only returned canned
 * output would let an ordering bug pass.
 *
 * It also models enough state to make resumption real: a database created in
 * one run is found by the next run's `d1 info`, and a secret set before an
 * interruption is listed by the next run's `secret list`.
 */

/** The account's contents, shared between runs in a test. */
export interface FakeAccount {
  /** Accounts `whoami --json` reports. */
  accounts?: { id: string; name?: string }[];
  /** Database name → id. */
  databases?: Record<string, string>;
  buckets?: string[];
  workers?: string[];
  /** Worker name → secret names. */
  secrets?: Record<string, string[]>;
  /** Bucket name → object keys. */
  objects?: Record<string, string[]>;
}

/** Every wrangler subcommand that changes something on the account. */
const MUTATIONS = [
  ['d1', 'create'],
  ['d1', 'delete'],
  ['r2', 'bucket', 'create'],
  ['r2', 'bucket', 'delete'],
  ['r2', 'object', 'delete'],
  ['deploy'],
  ['delete'],
  ['secret', 'put'],
] as const;

/**
 * Whether a call changes the account.
 *
 * `deploy --dry-run` is the preflight check and changes nothing; only a real
 * deploy counts. Getting this wrong in the other direction would make the
 * tests pass while resources were being created.
 */
export function isMutation(args: readonly string[]): boolean {
  if (args.includes('--dry-run')) {
    return false;
  }
  return MUTATIONS.some((mutation) =>
    mutation.every((token, index) => args[index] === token),
  );
}

export interface FakeOptions {
  readonly account?: FakeAccount;
  /** Calls matching this fail. */
  readonly failWhen?: (args: readonly string[]) => boolean;
  /**
   * Apply the call's effect *before* failing it.
   *
   * The interruption that matters for secrets: Cloudflare accepted the value
   * and the process died before the ledger recorded it.
   */
  readonly failAfterEffect?: boolean;
}

export interface Fake {
  readonly account: Required<FakeAccount>;
  readonly calls: { command: string; args: string[] }[];
  readonly run: CommandRunner;
  /** The mutating calls, in order, as readable strings. */
  readonly mutations: () => string[];
  /** Index of the first mutating call, or the length when there is none. */
  readonly firstMutationIndex: () => number;
  /** Secret name → the value that was piped in. */
  readonly secretsSent: () => Record<string, string>;
}

const DATABASE_ID = '11111111-2222-4333-8444-555555555555';

export function fakeCloudflare(options: FakeOptions = {}): Fake {
  const account: Required<FakeAccount> = {
    accounts: options.account?.accounts ?? [{ id: 'acct-1', name: 'Test' }],
    databases: { ...(options.account?.databases ?? {}) },
    buckets: [...(options.account?.buckets ?? [])],
    workers: [...(options.account?.workers ?? [])],
    secrets: { ...(options.account?.secrets ?? {}) },
    objects: { ...(options.account?.objects ?? {}) },
  };
  const calls: { command: string; args: string[] }[] = [];
  const sent: Record<string, string> = {};

  const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
  const fail = (stderr: string): RunResult => ({ code: 1, stdout: '', stderr });

  const handle = async (
    args: readonly string[],
    input: string | undefined,
    cwd: string,
  ): Promise<RunResult> => {
    const [first, second, third] = args;

    // ---- the package manager ---------------------------------------------
    if (first === 'install' || first === 'ci') {
      // A real install puts wrangler in the project and writes a lockfile;
      // the steps after it refuse to run without either.
      await mkdir(join(cwd, 'node_modules/.bin'), { recursive: true });
      await writeFile(
        join(cwd, 'node_modules/.bin/wrangler'),
        '#!/bin/sh\nexit 0\n',
        { mode: 0o755 },
      );
      await writeFile(
        join(cwd, 'package-lock.json'),
        '{"lockfileVersion":3}\n',
        'utf8',
      );
      return ok();
    }
    if (first === 'run') {
      return ok();
    }

    // ---- read-only --------------------------------------------------------
    if (first === 'whoami') {
      return ok(JSON.stringify({ accounts: account.accounts }));
    }
    if (first === 'd1' && second === 'info') {
      const id = account.databases[third ?? ''];
      return id === undefined
        ? fail("Couldn't find DB")
        : ok(JSON.stringify({ uuid: id }));
    }
    if (first === 'r2' && second === 'bucket' && third === 'info') {
      return account.buckets.includes(args[3] ?? '')
        ? ok(JSON.stringify({ name: args[3] }))
        : fail('The specified bucket does not exist');
    }
    if (first === 'deployments' && second === 'list') {
      const name = args[args.indexOf('--name') + 1] ?? '';
      return account.workers.includes(name)
        ? ok(JSON.stringify([{ id: 'dep-1' }]))
        : ok(JSON.stringify([]));
    }
    if (first === 'secret' && second === 'list') {
      const name = args[args.indexOf('--name') + 1] ?? '';
      return ok(
        JSON.stringify(
          (account.secrets[name] ?? []).map((secret) => ({ name: secret })),
        ),
      );
    }
    if (first === 'r2' && second === 'object' && third === 'list') {
      const bucket = args[3] ?? '';
      return ok(
        JSON.stringify({
          objects: (account.objects[bucket] ?? []).map((key) => ({ key })),
        }),
      );
    }
    if (first === 'deploy' && args.includes('--dry-run')) {
      return ok('Total Upload: 100 KiB / gzip: 30 KiB');
    }

    // ---- mutating ---------------------------------------------------------
    if (first === 'd1' && second === 'create') {
      account.databases[third ?? ''] = DATABASE_ID;
      return ok(`✅ Created DB\n"database_id": "${DATABASE_ID}"`);
    }
    if (first === 'r2' && second === 'bucket' && third === 'create') {
      account.buckets.push(args[3] ?? '');
      return ok('Created bucket');
    }
    if (first === 'deploy') {
      account.workers.push(currentWorker(args, account));
      return ok('Deployed\nhttps://mallok-my-site.tests.workers.dev');
    }
    if (first === 'secret' && second === 'put') {
      const name = third ?? '';
      const worker = 'mallok-my-site';
      sent[name] = input ?? '';
      account.secrets[worker] = [...(account.secrets[worker] ?? []), name];
      return ok(`Success! Uploaded secret ${name}`);
    }
    if (first === 'delete') {
      account.workers = account.workers.filter((name) => name !== second);
      return ok('Deleted');
    }
    if (first === 'd1' && second === 'delete') {
      delete account.databases[third ?? ''];
      return ok('Deleted');
    }
    if (first === 'r2' && second === 'bucket' && third === 'delete') {
      account.buckets = account.buckets.filter((name) => name !== args[3]);
      return ok('Deleted');
    }
    if (first === 'r2' && second === 'object' && third === 'delete') {
      const [bucket, ...rest] = (args[3] ?? '').split('/');
      const key = rest.join('/');
      account.objects[bucket ?? ''] = (
        account.objects[bucket ?? ''] ?? []
      ).filter((entry) => entry !== key);
      return ok('Deleted');
    }
    return fail(`the fake wrangler has no answer for: ${args.join(' ')}`);
  };

  const run: CommandRunner = async (command, args, runOptions) => {
    calls.push({ command, args: [...args] });
    const failing = options.failWhen?.(args) ?? false;
    if (failing && options.failAfterEffect !== true) {
      return fail(`boom: ${args[0]} failed`);
    }
    const result = await handle(args, runOptions.input, runOptions.cwd);
    if (failing) {
      return fail(`boom: ${args[0]} failed after taking effect`);
    }
    return result;
  };

  const mutating = () => calls.filter((call) => isMutation(call.args));

  return {
    account,
    calls,
    run,
    mutations: () => mutating().map((call) => call.args.join(' ')),
    firstMutationIndex: () => {
      const index = calls.findIndex((call) => isMutation(call.args));
      return index === -1 ? calls.length : index;
    },
    secretsSent: () => ({ ...sent }),
  };
}

/** The Worker a deploy in this project would create. */
function currentWorker(
  _args: readonly string[],
  _account: FakeAccount,
): string {
  // The fake does not read wrangler.jsonc; every test uses one project, and
  // the name it deploys is the one derived from that project's slug.
  return 'mallok-my-site';
}
