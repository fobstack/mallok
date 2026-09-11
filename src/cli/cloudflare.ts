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

import { CliError, EXIT } from './output.js';
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
 * Whether a failure means "no such resource" or something else entirely.
 *
 * This is the distinction the file turns on. A non-zero exit from `d1 info`
 * can mean the database is not there — or that the token expired, the network
 * is down, or the account lacks a permission. Reading the second kind as
 * absence is how a resumed run creates a second database beside the one it
 * could not see.
 *
 * Wrangler has no machine-readable answer for this, so the message is matched
 * against the shapes it uses for "not found" and **everything else fails
 * closed**. A new wording on Cloudflare's side therefore makes this stricter,
 * not looser, which is the right direction for a mistake to lean.
 */
const ABSENT =
  /couldn'?t find|not found|does not exist|no such|unknown (?:database|bucket|script)/i;

function isAbsence(result: RunResult): boolean {
  return ABSENT.test(`${result.stderr}\n${result.stdout}`);
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
    if (!isAbsence(result)) {
      probeFailed(`the database ${name}`, result);
    }
    return { exists: false };
  }
  const info = asJson<{ uuid?: string; database_id?: string }>(
    result,
    'the database',
  );
  const id = info.uuid ?? info.database_id;
  return id === undefined ? { exists: true } : { exists: true, id };
}

/** Whether an R2 bucket of this name already exists. */
export async function findBucket(
  wrangler: Wrangler,
  name: string,
): Promise<Existing> {
  const result = await wrangler.run(['r2', 'bucket', 'info', name, '--json']);
  if (result.code !== 0) {
    if (!isAbsence(result)) {
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
    if (!isAbsence(result)) {
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
    if (isAbsence(result)) {
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

/** A custom domain attached to an R2 bucket. */
export interface BucketDomain {
  readonly domain: string;
  readonly enabled: boolean;
}

/**
 * The custom domains attached to a bucket.
 *
 * A real Cloudflare API (`wrangler r2 bucket domain list`) rather than a DNS
 * probe: whether `media.<domain>` is attached is a fact about the account,
 * and asking the account is both faster and correct.
 */
export async function bucketDomains(
  wrangler: Wrangler,
  bucket: string,
): Promise<BucketDomain[]> {
  const result = await wrangler.run([
    'r2',
    'bucket',
    'domain',
    'list',
    bucket,
    '--json',
  ]);
  if (result.code !== 0) {
    if (isAbsence(result)) {
      return [];
    }
    throw new CliError(
      EXIT.remote,
      `Could not list the custom domains on ${bucket}.`,
      lastLine(result.stderr, result.stdout),
    );
  }
  const payload = asJson<{ domains?: BucketDomain[] } | BucketDomain[]>(
    result,
    "the bucket's custom domains",
  );
  return Array.isArray(payload) ? payload : (payload.domains ?? []);
}

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
