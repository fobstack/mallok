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

export function wranglerFor(
  projectDir: string,
  runner: CommandRunner,
): Wrangler {
  const binary = projectWrangler(projectDir);
  return {
    run: (args, options = {}) =>
      runner(binary, args, {
        cwd: projectDir,
        ...(options.input === undefined ? {} : { input: options.input }),
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

/** The account this login acts on. */
export async function currentAccountId(wrangler: Wrangler): Promise<string> {
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
  if (accounts.length > 1 && direct === undefined) {
    throw new CliError(
      EXIT.user,
      `This login can reach ${accounts.length} accounts.`,
      'Set CLOUDFLARE_ACCOUNT_ID to the one this site belongs to. Choosing ' +
        'for you is how a site ends up on the wrong account.',
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

/** Whether a D1 database of this name already exists. */
export async function findDatabase(
  wrangler: Wrangler,
  name: string,
): Promise<Existing> {
  const result = await wrangler.run(['d1', 'info', name, '--json']);
  if (result.code !== 0) {
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
  return { exists: result.code === 0 };
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
    return { exists: false };
  }
  const deployments = asJson<unknown[]>(result, "the Worker's deployments");
  return { exists: Array.isArray(deployments) && deployments.length > 0 };
}

/**
 * The names of the secrets a Worker holds.
 *
 * Names only — Cloudflare does not return values, and this is what makes
 * reconciliation after an interrupted `secret put` safe: the run can see
 * *that* `MALLOK_SECRET` is set without ever seeing it, and therefore without
 * needing to overwrite it with a new one.
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
    return [];
  }
  const secrets = asJson<{ name?: string }[]>(result, "the Worker's secrets");
  return secrets
    .map((secret) => secret.name ?? '')
    .filter((name) => name !== '');
}

/** How many objects a bucket holds, as far as one listing can tell. */
export async function bucketHasObjects(
  wrangler: Wrangler,
  bucket: string,
): Promise<boolean> {
  const result = await wrangler.run(['r2', 'object', 'list', bucket, '--json']);
  if (result.code !== 0) {
    // Older Wranglers have no `r2 object list`. Unknown is not "empty".
    return true;
  }
  const listing = asJson<{ objects?: unknown[] } | unknown[]>(
    result,
    "the bucket's contents",
  );
  const objects = Array.isArray(listing) ? listing : (listing.objects ?? []);
  return objects.length > 0;
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
