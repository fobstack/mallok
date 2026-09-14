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
  /**
   * Which mutating steps actually took effect on this account.
   *
   * What makes an "after the effect" interruption testable: the CLI was told
   * the call failed, and the account changed anyway.
   */
  applied?: string[];
  /** Bucket name → custom domains attached to it. */
  domains?: Record<string, { domain: string; enabled: boolean }[]>;
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
  /** What the failure says. Defaults to a generic message. */
  readonly failureMessage?: string;
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
    applied: [...(options.account?.applied ?? [])],
    domains: { ...(options.account?.domains ?? {}) },
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
      // The wording is Wrangler 4.124.0's own, quoted rather than paraphrased.
      // `isDefiniteAbsence` now requires a resource-specific message — a bare
      // "not found" is refused — so a fake that invents its own phrasing would
      // exercise a path the real CLI never reaches.
      return id === undefined
        ? fail(`✘ [ERROR] Couldn't find a D1 DB named "${third ?? ''}"`)
        : ok(JSON.stringify({ uuid: id }));
    }
    if (first === 'r2' && second === 'bucket' && third === 'info') {
      return account.buckets.includes(args[3] ?? '')
        ? ok(JSON.stringify({ name: args[3] }))
        : fail('✘ [ERROR] The specified bucket does not exist.');
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
    // No `r2 bucket domain list` here, deliberately.
    //
    // This fake used to answer it with JSON, which is how a call passing
    // `--json` — a flag the real Wrangler 4.124.0 does not have for that
    // subcommand — survived review and a test suite. A fake that answers a
    // shape the real CLI cannot produce is not a test double; it is a second,
    // friendlier CLI. `destroy` no longer lists domains, and nothing else
    // should start: it learns about an attached domain from the delete it
    // attempts (`classifyDeleteFailure`).
    if (
      first === 'r2' &&
      second === 'bucket' &&
      third === 'domain' &&
      args[3] === 'remove'
    ) {
      const bucket = args[4] ?? '';
      const domain = args[args.indexOf('--domain') + 1] ?? '';
      account.domains[bucket] = (account.domains[bucket] ?? []).filter(
        (entry) => entry.domain !== domain,
      );
      account.applied.push('domain-remove');
      return ok('Removed');
    }
    if (first === 'deploy' && args.includes('--dry-run')) {
      return ok('Total Upload: 100 KiB / gzip: 30 KiB');
    }

    // ---- mutating ---------------------------------------------------------
    if (first === 'd1' && second === 'create') {
      account.databases[third ?? ''] = DATABASE_ID;
      account.applied.push('database');
      return ok(`✅ Created DB\n"database_id": "${DATABASE_ID}"`);
    }
    if (first === 'r2' && second === 'bucket' && third === 'create') {
      account.buckets.push(args[3] ?? '');
      account.applied.push('bucket');
      return ok('Created bucket');
    }
    if (first === 'deploy') {
      account.workers.push(currentWorker(args, account));
      account.applied.push('deploy');
      return ok('Deployed\nhttps://mallok-my-site.tests.workers.dev');
    }
    if (first === 'secret' && second === 'put') {
      const name = third ?? '';
      const worker = 'mallok-my-site';
      sent[name] = input ?? '';
      account.secrets[worker] = [...(account.secrets[worker] ?? []), name];
      account.applied.push(name === 'MALLOK_SETUP_KEY' ? 'setupKey' : 'secret');
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
      const bucket = args[3] ?? '';
      // Cloudflare refuses both of these, and refusing them *here* — at the
      // delete — is the only place a real account would. There is no command
      // that reports them in advance (`r2 bucket domain list` has no `--json`
      // in 4.124.0), so `destroy` has to learn from the refusal.
      if ((account.domains[bucket] ?? []).length > 0) {
        return fail(
          'A request to the Cloudflare API failed. The bucket you tried to ' +
            'delete has a custom domain attached to it. [code: 10041]',
        );
      }
      if ((account.objects[bucket] ?? []).length > 0) {
        return fail(
          'A request to the Cloudflare API failed. The bucket you tried to ' +
            'delete is not empty. [code: 10011]',
        );
      }
      account.buckets = account.buckets.filter((name) => name !== bucket);
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
    const message = options.failureMessage ?? `boom: ${args.join(' ')} failed`;
    if (failing && options.failAfterEffect !== true) {
      return fail(message);
    }
    const result = await handle(args, runOptions.input, runOptions.cwd);
    if (failing) {
      return fail(message);
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

/**
 * Every subcommand this fake answers.
 *
 * `test/cli/wrangler-contract.test.ts` checks this list against the real
 * Wrangler's own `--help`, because a fake that answers a command Wrangler
 * does not have is a fake that proves a feature nobody can use. That is not
 * hypothetical: this file implemented `r2 object list`, which Wrangler
 * 4.124.0 does not provide, and a `destroy --empty-bucket` was built on it.
 */
export const FAKE_SUBCOMMANDS: readonly string[] = [
  'whoami',
  'deploy',
  'delete',
  'd1 create',
  'd1 delete',
  'd1 info',
  'r2 bucket create',
  'r2 bucket delete',
  'r2 bucket info',
  'r2 bucket domain remove',
  'r2 object delete',
  'secret put',
  'secret list',
  'deployments list',
];

/** The Worker a deploy in this project would create. */
function currentWorker(
  _args: readonly string[],
  _account: FakeAccount,
): string {
  // The fake does not read wrangler.jsonc; every test uses one project, and
  // the name it deploys is the one derived from that project's slug.
  return 'mallok-my-site';
}
