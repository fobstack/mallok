/**
 * Everything that talks to Cloudflare, in one file.
 *
 * Two reasons it is one file. The first is that the **read-only** calls and
 * the **mutating** calls have to be told apart with certainty — the tests
 * count mutations, and a count is only meaningful if every mutation goes
 * through here. The second is that all of them run the *project's own*
 * Wrangler, at the version its lockfile pinned, rather than `npx wrangler`,
 * which resolves to whatever the registry published today.
 *
 * Nothing here prints a credential. `secret put` takes its value on stdin and
 * the value never appears in an argument, a log line or a returned object.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError, EXIT } from './output.js';
import { parseJsonc } from './site-config.js';
import { projectWrangler } from './template.js';

/** Result of one command invocation. */
export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command, capturing both streams. Injected so tests can observe it. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; input?: string; env?: NodeJS.ProcessEnv },
) => Promise<RunResult>;

/** A Wrangler bound to one project directory. */
export interface Wrangler {
  readonly run: (
    args: readonly string[],
    options?: { input?: string },
  ) => Promise<RunResult>;
}

/**
 * A Wrangler bound to one project directory, and optionally to one account.
 *
 * `accountId` is passed to **every** subprocess through
 * `CLOUDFLARE_ACCOUNT_ID`, which is the variable Wrangler itself reads. The
 * CLI used to tell the user to set that variable and then never read or pass
 * it — advice that did nothing, on the one code path where being on the wrong
 * account deletes somebody else's site.
 */
export function wranglerFor(
  projectDir: string,
  runner: CommandRunner,
  accountId?: string,
): Wrangler {
  const binary = projectWrangler(projectDir);
  const env =
    accountId === undefined
      ? undefined
      : { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
  return {
    run: (args, options = {}) =>
      runner(binary, args, {
        cwd: projectDir,
        ...(options.input === undefined ? {} : { input: options.input }),
        ...(env === undefined ? {} : { env }),
      }),
  };
}

/** The identity-bearing fields in the project's actual Wrangler config. */
export interface ProjectWranglerIdentity {
  readonly accountId?: string;
  readonly worker: string;
  readonly database: {
    readonly binding: string;
    readonly name: string;
    readonly id: string;
  };
  readonly bucket: {
    readonly binding: string;
    readonly name: string;
  };
}

/**
 * Reads the config Wrangler will use for mutations, and refuses an ambiguous
 * target. Checking `whoami` alone is insufficient: Wrangler's `account_id`
 * can select a different reachable account from `CLOUDFLARE_ACCOUNT_ID`.
 */
export async function projectWranglerIdentity(
  projectDir: string,
): Promise<ProjectWranglerIdentity> {
  const path = join(projectDir, 'wrangler.jsonc');
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new CliError(
      EXIT.user,
      `Could not read ${path}.`,
      error instanceof Error ? error.message : String(error),
    );
  }
  const config = parseJsonc(source, path);
  const worker = config.name;
  if (typeof worker !== 'string' || worker.trim() === '') {
    throw new CliError(EXIT.user, `${path} does not name a Worker.`);
  }
  const databases = config.d1_databases;
  const database = Array.isArray(databases)
    ? databases.find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as Record<string, unknown>).binding === 'DB',
      )
    : undefined;
  const binding = database?.binding;
  const name = database?.database_name;
  const id = database?.database_id;
  if (
    binding !== 'DB' ||
    typeof name !== 'string' ||
    name.trim() === '' ||
    typeof id !== 'string' ||
    id.trim() === ''
  ) {
    throw new CliError(
      EXIT.user,
      `${path} does not contain a complete D1 binding named DB.`,
      'Refusing to address a database by a reusable name without the UUID ' +
        'the deployed Worker is bound to.',
    );
  }
  const buckets = config.r2_buckets;
  const bucket = Array.isArray(buckets)
    ? buckets.find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as Record<string, unknown>).binding === 'MEDIA',
      )
    : undefined;
  const bucketBinding = bucket?.binding;
  const bucketName = bucket?.bucket_name;
  if (
    bucketBinding !== 'MEDIA' ||
    typeof bucketName !== 'string' ||
    bucketName.trim() === ''
  ) {
    throw new CliError(
      EXIT.user,
      `${path} does not contain a complete R2 binding named MEDIA.`,
      'Refusing to address an R2 bucket by a derived name when the deployed ' +
        'Worker is bound to something else.',
    );
  }
  const configuredAccount = config.account_id;
  if (
    configuredAccount !== undefined &&
    (typeof configuredAccount !== 'string' || configuredAccount.trim() === '')
  ) {
    throw new CliError(
      EXIT.user,
      `${path} contains an invalid account_id.`,
      'Remove it or set it to the Cloudflare account that owns this site.',
    );
  }
  return {
    ...(typeof configuredAccount === 'string'
      ? { accountId: configuredAccount }
      : {}),
    worker,
    database: { binding, name, id },
    bucket: { binding: bucketBinding, name: bucketName },
  };
}

/**
 * Selects one account for every later Wrangler call and proves the project
 * config cannot silently override that selection.
 */
export async function verifiedWrangler(
  projectDir: string,
  runner: CommandRunner,
  expected?: string,
): Promise<{
  readonly accountId: string;
  readonly wrangler: Wrangler;
  readonly identity: ProjectWranglerIdentity;
}> {
  const identity = await projectWranglerIdentity(projectDir);
  if (
    expected !== undefined &&
    identity.accountId !== undefined &&
    identity.accountId !== expected
  ) {
    throw new CliError(
      EXIT.user,
      'wrangler.jsonc selects a different Cloudflare account.',
      `The command selected ${expected}, but wrangler.jsonc selects ` +
        `${identity.accountId}. Refusing before any resource is changed.`,
    );
  }
  // A config account is an explicit selection, not an ambiguity. Feed it
  // into `whoami` so a login that can reach several accounts proves this
  // particular one is reachable instead of failing before reading the
  // config that Wrangler itself will use.
  const selected = expected ?? identity.accountId;
  const initial = wranglerFor(projectDir, runner, selected);
  const accountId = await currentAccountId(initial, selected);
  return {
    accountId,
    // Bind even the single-account case explicitly. This prevents a later
    // subprocess from selecting a different reachable account by accident.
    wrangler: wranglerFor(projectDir, runner, accountId),
    identity,
  };
}

/** Parses JSON from a wrangler command, or explains what came back instead. */
function asJson<T>(result: RunResult, what: string): T {
  // Wrangler prints a banner before the JSON on some commands.
  const text = result.stdout.trim();
  const start = text.search(/[[{]/);
  if (start === -1) {
    throw new CliError(
      EXIT.remote,
      `Could not read ${what} from wrangler.`,
      lastLine(result.stderr, result.stdout),
    );
  }
  try {
    return JSON.parse(text.slice(start)) as T;
  } catch {
    throw new CliError(
      EXIT.remote,
      `wrangler returned something that is not ${what}.`,
      lastLine(result.stderr, result.stdout),
    );
  }
}

/**
 * The account this login acts on.
 *
 * When `expected` is given it must be one of the accounts this login can
 * reach; the check is what makes `--account-id` a safety feature rather than
 * a label. Without it, a login with several accounts is an error rather than
 * a guess.
 */
export async function currentAccountId(
  wrangler: Wrangler,
  expected?: string,
): Promise<string> {
  const result = await wrangler.run(['whoami', '--json']);
  if (result.code !== 0) {
    throw new CliError(
      EXIT.auth,
      'Not signed in to Cloudflare.',
      'Run `npx wrangler login` and try again.',
    );
  }
  const payload = asJson<
    | { account_id?: string; accounts?: { id?: string; name?: string }[] }
    | { id?: string }[]
  >(result, 'your account information');
  const accounts = Array.isArray(payload) ? payload : (payload.accounts ?? []);
  const direct = Array.isArray(payload) ? undefined : payload.account_id;
  const first = accounts[0]?.id;
  const accountId = direct ?? first;
  if (typeof accountId !== 'string' || accountId === '') {
    throw new CliError(
      EXIT.auth,
      'Cloudflare did not report an account for this login.',
      'If this login can reach more than one account, select one with ' +
        'CLOUDFLARE_ACCOUNT_ID before running this again.',
    );
  }
  if (expected !== undefined) {
    const reachable = accounts.map((account) => account.id);
    if (direct !== expected && !reachable.includes(expected)) {
      throw new CliError(
        EXIT.user,
        `This login cannot reach the account ${expected}.`,
        reachable.length === 0
          ? 'Sign in with `npx wrangler login` to an account that can.'
          : `It can reach: ${reachable.join(', ')}.`,
      );
    }
    return expected;
  }
  if (accounts.length > 1 && direct === undefined) {
    throw new CliError(
      EXIT.user,
      `This login can reach ${accounts.length} accounts.`,
      'Pass --account-id with the one this site belongs to. Choosing for you ' +
        'is how a site ends up on the wrong account.',
    );
  }
  return accountId;
}

/** What a read-only existence check found. */
export interface Existing {
  readonly exists: boolean;
  /** Set when the resource exists and reports an id. */
  readonly id?: string;
}

/**
 * Whether a failure means "this resource is not there" or something else.
 *
 * This is the distinction the file turns on. A non-zero exit from `d1 info`
 * can mean the database is absent — or that the token expired, the network is
 * down, the account lacks a permission, or a proxy returned an error page.
 * Reading any of those as absence makes a resumed `create` build a second
 * database beside the one it could not see, and makes `destroy` record the
 * bucket as "already gone" and go on to delete the Worker and the database.
 *
 * Two rules, and the second one is the one that was missing.
 *
 * **Nothing that could be a failure to *ask* is absence.** Authentication,
 * authorisation, transport and API-routing failures are recognised first and
 * are never absence, whatever else their text contains — all of these are
 * real messages that used to pass as "not found":
 *
 *     Authentication error [code: 10000]: token not found
 *     getaddrinfo ENOTFOUND api.cloudflare.com: no such host
 *     A request to the Cloudflare API failed. Route not found [code: 7003]
 *
 * **Absence must be claimed by the resource's own error.** Matching a bare
 * `not found` anywhere in the output was far too generous: Wrangler 4.124.0's
 * own bundle contains `Not Found`, `Not found.`, `Page not found.`,
 * `Application not found` and `Deployment not found`, and an HTML error page
 * from a corporate proxy contains one too. None of them says anything about
 * whether *this* database, bucket or Worker exists.
 *
 * So each resource kind has its own patterns, and each pattern is a
 * **quotation** from the locked Wrangler — `test/cli/absence.test.ts` reads
 * the binary's bundle and fails if any `quote` below is not in it. A guess
 * here either strands an operator or deletes a live site, so a guess is not
 * allowed to be indistinguishable from a fact.
 *
 * The list is deliberately incomplete rather than speculative. If Cloudflare
 * words an absence some way not written here, this stops and asks a person —
 * which is the direction a mistake in this file has to lean.
 */
const CANNOT_TELL =
  /\bauthenticat\w*|\bunauthori[sz]ed\b|\bforbidden\b|\bpermission\b|\bcredential\w*|\btoken\b|\[code: (?:10000|10001|7003)\]|\bENOTFOUND\b|\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|\bEPROTO\b|\bsocket hang up\b|\bfetch failed\b|\bgetaddrinfo\b|\bno such host\b|\bnetwork\b|\btimed? ?out\b|\brate limit\w*\b|\btoo many requests\b|\b(?:429|5\d\d) \b/i;

/** The kinds of resource this file can be asked about. */
export type ResourceKind = 'database' | 'bucket' | 'worker' | 'secrets';

/**
 * One way the locked Wrangler says a specific resource is absent.
 *
 * `quote` is the literal substring that must exist in `wrangler-dist/cli.js`;
 * `pattern` is how it is recognised in output that has been formatted,
 * interpolated and prefixed with `✘ [ERROR]`.
 */
export interface AbsenceQuote {
  readonly quote: string;
  readonly pattern: RegExp;
}

export const ABSENCE_PATTERNS: Readonly<
  Record<ResourceKind, readonly AbsenceQuote[]>
> = {
  database: [
    {
      quote: "Couldn't find a D1 DB named ",
      pattern: /couldn'?t find a D1 DB named/i,
    },
    {
      quote: "Couldn't find a D1 DB with name or binding ",
      pattern: /couldn'?t find a D1 DB with name or binding/i,
    },
    {
      quote: "Couldn't find a D1 DB with the name or binding ",
      pattern: /couldn'?t find a D1 DB with the name or binding/i,
    },
  ],
  bucket: [
    {
      quote: 'The specified bucket does not exist.',
      pattern: /the specified bucket does not exist/i,
    },
    { quote: 'NoSuchBucket', pattern: /\bNoSuchBucket\b/ },
  ],
  worker: [
    // The Cloudflare API code for `workers.api.error.script_not_found`.
    { quote: '10007', pattern: /\[code: 10007\]|script_not_found/i },
    {
      quote: 'This Worker does not exist yet, so secrets cannot be set',
      pattern: /this Worker does not exist yet/i,
    },
  ],
  secrets: [
    {
      quote: 'This Worker does not exist yet, so secrets cannot be set',
      pattern: /this Worker does not exist yet/i,
    },
    { quote: '10007', pattern: /\[code: 10007\]|script_not_found/i },
  ],
};

/**
 * Whether a failure is a *definite* "this resource is not there".
 *
 * Exported because `destroy` has to make the same judgement about a delete
 * that failed, and two copies of this reasoning is one copy too many.
 */
export function isDefiniteAbsence(text: string, kind: ResourceKind): boolean {
  if (CANNOT_TELL.test(text)) {
    return false;
  }
  return ABSENCE_PATTERNS[kind].some((entry) => entry.pattern.test(text));
}

function isAbsence(result: RunResult, kind: ResourceKind): boolean {
  return isDefiniteAbsence(`${result.stderr}\n${result.stdout}`, kind);
}

/** Turns anything that is not a clean "absent" into a stop. */
function probeFailed(what: string, result: RunResult): never {
  throw new CliError(
    EXIT.remote,
    `Could not check whether ${what} exists.`,
    `${lastLine(result.stderr, result.stdout)} — this is not the same answer ` +
      'as "it does not exist", so nothing has been created or changed. Fix ' +
      'the connection or the credentials and run the same command again.',
  );
}

/** Whether a D1 database of this name already exists. */
export async function findDatabase(
  wrangler: Wrangler,
  name: string,
): Promise<Existing> {
  const result = await wrangler.run(['d1', 'info', name, '--json']);
  if (result.code !== 0) {
    if (!isAbsence(result, 'database')) {
      probeFailed(`the database ${name}`, result);
    }
    return { exists: false };
  }
  const info = asJson<{ uuid?: string; database_id?: string }>(
    result,
    'the database',
  );
  const id = info.uuid ?? info.database_id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new CliError(
      EXIT.remote,
      `Cloudflare reported that the database ${name} exists without its UUID.`,
      'Refusing to identify a D1 database by name alone. No resource has been changed.',
    );
  }
  return { exists: true, id };
}

/** Whether an R2 bucket of this name already exists. */
export async function findBucket(
  wrangler: Wrangler,
  name: string,
): Promise<Existing> {
  const result = await wrangler.run(['r2', 'bucket', 'info', name, '--json']);
  if (result.code !== 0) {
    if (!isAbsence(result, 'bucket')) {
      probeFailed(`the bucket ${name}`, result);
    }
    return { exists: false };
  }
  return { exists: true };
}

/** Whether a Worker of this name is already deployed. */
export async function findWorker(
  wrangler: Wrangler,
  name: string,
): Promise<Existing> {
  const result = await wrangler.run([
    'deployments',
    'list',
    '--name',
    name,
    '--json',
  ]);
  if (result.code !== 0) {
    if (!isAbsence(result, 'worker')) {
      probeFailed(`the Worker ${name}`, result);
    }
    return { exists: false };
  }
  const deployments = asJson<unknown[]>(result, "the Worker's deployments");
  return { exists: Array.isArray(deployments) && deployments.length > 0 };
}

/**
 * The names of the secrets a Worker holds.
 *
 * Names only — Cloudflare does not return values, and that is what makes
 * reconciliation after an interrupted `secret put` safe: a run can see *that*
 * `MALLOK_SECRET` is set without ever seeing it, and therefore without
 * needing to overwrite it.
 *
 * **It throws rather than returning an empty list when it cannot read.** An
 * empty list means "this Worker has no secrets", and acting on that when the
 * truth is "the API did not answer" sets a new `MALLOK_SECRET` — which signs
 * every user out and makes every stored plugin key unreadable. There is no
 * safe default here, so there is no default.
 */
export async function secretNames(
  wrangler: Wrangler,
  worker: string,
): Promise<string[]> {
  const result = await wrangler.run([
    'secret',
    'list',
    '--name',
    worker,
    '--format',
    'json',
  ]);
  if (result.code !== 0) {
    if (isAbsence(result, 'secrets')) {
      // The Worker is not deployed yet, so it genuinely holds no secrets.
      return [];
    }
    throw new CliError(
      EXIT.remote,
      `Could not read the secrets set on ${worker}.`,
      `${lastLine(result.stderr, result.stdout)} — stopping rather than ` +
        'guessing: assuming there are none would set a new MALLOK_SECRET, ' +
        'which signs every user out and makes stored plugin keys unreadable.',
    );
  }
  const secrets = asJson<{ name?: string }[]>(result, "the Worker's secrets");
  return secrets
    .map((secret) => secret.name ?? '')
    .filter((name) => name !== '');
}

/*
 * There is no `bucketDomains` here any more, and there must not be one.
 *
 * It called `wrangler r2 bucket domain list <bucket> --json`. The subcommand
 * is real; the flag is not — Wrangler 4.124.0 documents only
 * `-J, --jurisdiction` for it, so the call could only ever have worked
 * against a fake that answered it. `destroy` now learns about an attached
 * domain the only way that is true on a real account: by attempting the
 * delete, with the Worker and the database still intact, and classifying
 * what Cloudflare refuses with (`classifyDeleteFailure`).
 */

/**
 * The line most likely to explain a failure.
 *
 * Not simply the last line: build tools end with warnings and summaries, so
 * the last line of a failed build was "Adjust chunk size limit for this
 * warning" while the actual cause sat further up.
 */
export function lastLine(...streams: string[]): string {
  const looksLikeError =
    /\b(error|ERR_[A-Z_]+|failed|not found|cannot|missing|denied)\b/i;
  for (const stream of streams) {
    const lines = stream
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const matched = [...lines]
      .reverse()
      .find((line) => looksLikeError.test(line));
    if (matched !== undefined) {
      return matched;
    }
  }
  for (const stream of streams) {
    const line = stream.trim().split('\n').at(-1);
    if (line !== undefined && line !== '') {
      return line;
    }
  }
  return '';
}
