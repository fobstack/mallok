/**
 * The intent ledger: what a run is about to do, and what it has already done.
 *
 * Written **before** the first remote call and updated after every one, so
 * that a run killed at any point leaves a file saying exactly which resources
 * exist. `mallok create` resumes from it and `mallok destroy` cleans up from
 * it — including a half-finished create that never reached the registry.
 *
 * Three rules it exists to keep:
 *
 * - **Names, never secrets.** The ledger is written inside a project someone
 *   may commit. `MALLOK_SECRET` is generated, piped to `wrangler secret put`
 *   and forgotten; what is recorded is *that a secret of that name was set*,
 *   never its value.
 * - **Fail closed.** A ledger that cannot be read or does not parse stops the
 *   run. Treating it as absent is how a resumed run creates a second database
 *   beside the one it cannot see.
 * - **Atomic.** Every write goes to a temporary file and is renamed over the
 *   old one, so an interrupted write cannot leave a truncated ledger — which
 *   the rule above would then refuse to work with.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CliError, EXIT } from './output.js';

/** Incremented when the shape below changes in a way older CLIs misread. */
export const LEDGER_SCHEMA_VERSION = 2;

export const LEDGER_FILE = '.mallok/create-state.json';

/** What is known about one resource this run is responsible for. */
export interface ResourceRecord {
  /** `pending` is written before the call that creates it. */
  readonly status: 'pending' | 'created' | 'adopted';
  readonly name: string;
  readonly id?: string;
  readonly at?: string;
}

/** The ledger's shape on disk. */
export interface Ledger {
  readonly schemaVersion: number;
  /** The Cloudflare account the resources belong to. */
  readonly accountId: string;
  /** Absolute path of the project this ledger belongs to. */
  readonly directory: string;
  readonly slug: string;
  readonly domain: string | null;
  /** Identifies the configuration this run intends to deploy. */
  readonly fingerprint: string;
  /**
   * The rate-limit namespace this site's Worker was deployed with.
   *
   * Recorded rather than re-derived, because `--rate-limit-namespace` can
   * override the derivation: re-deriving it on resume would write a different
   * `wrangler.jsonc` from the one that is deployed, and silently move the
   * site onto a different limiter.
   */
  readonly rateLimitNamespace?: string;
  readonly startedAt: string;
  readonly database?: ResourceRecord;
  readonly bucket?: ResourceRecord;
  readonly worker?: ResourceRecord;
  /** Recorded by name only — never a value. */
  readonly secrets?: readonly string[];
  /**
   * When the setup key's value was handed to the person running the command.
   *
   * Separate from `secrets` containing its name, because the two can differ:
   * a run interrupted between `secret put` and printing leaves a key set on
   * the Worker that nobody has. A resumed run rotates in exactly that case.
   */
  readonly setupKeyDeliveredAt?: string;
  readonly origin?: string;
  readonly completedAt?: string;
  /**
   * Resources a `destroy` has already removed.
   *
   * What makes a repeated destroy idempotent: a run that stopped on the
   * bucket does not ask Cloudflare to delete a Worker it has already deleted.
   */
  readonly deleted?: readonly ('bucket' | 'worker' | 'database')[];
}

export function ledgerPath(projectDir: string): string {
  return join(projectDir, LEDGER_FILE);
}

/**
 * Reads the ledger.
 *
 * Returns null only when the file genuinely is not there. Anything else —
 * unreadable, truncated, not JSON, from a newer CLI — throws.
 */
export async function readLedger(projectDir: string): Promise<Ledger | null> {
  const path = ledgerPath(projectDir);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new CliError(
      EXIT.user,
      `${LEDGER_FILE} could not be read: ${(error as Error).message}`,
      'It records which Cloudflare resources this project owns. Fix the ' +
        'permissions rather than deleting it — deleting it makes the next run ' +
        'create a second set.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError(
      EXIT.user,
      `${LEDGER_FILE} is corrupt.`,
      'It records which Cloudflare resources this project owns, so it cannot ' +
        'be ignored: a run that treats it as absent creates a second database ' +
        'and a second bucket. Check the account in the dashboard, then either ' +
        'repair the file or run `mallok destroy` with the names you find.',
    );
  }

  const ledger = parsed as Partial<Ledger>;
  if (typeof ledger.schemaVersion !== 'number') {
    throw new CliError(
      EXIT.user,
      `${LEDGER_FILE} has no schemaVersion.`,
      'It was not written by this tool, or it has been edited by hand.',
    );
  }
  if (ledger.schemaVersion > LEDGER_SCHEMA_VERSION) {
    throw new CliError(
      EXIT.user,
      `${LEDGER_FILE} was written by a newer Mallok (schema ${ledger.schemaVersion}).`,
      'Upgrade the CLI rather than letting an older one act on it.',
    );
  }
  if (
    typeof ledger.slug !== 'string' ||
    typeof ledger.accountId !== 'string' ||
    typeof ledger.fingerprint !== 'string'
  ) {
    throw new CliError(
      EXIT.user,
      `${LEDGER_FILE} is missing fields this tool needs.`,
      'It records which Cloudflare resources this project owns; repair it ' +
        'rather than removing it.',
    );
  }
  return ledger as Ledger;
}

/**
 * Writes the ledger atomically.
 *
 * Temporary file plus rename: on every platform this project supports, a
 * rename within a directory is atomic, so a reader sees either the old ledger
 * or the new one and never half of either.
 */
export async function writeLedger(
  projectDir: string,
  ledger: Ledger,
): Promise<void> {
  const path = ledgerPath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Removes the ledger, once its resources are gone. */
export async function clearLedger(projectDir: string): Promise<void> {
  await rm(ledgerPath(projectDir), { force: true });
}

/**
 * Refuses to act on a ledger that belongs to another account.
 *
 * `wrangler` follows whichever login is current. Resuming or destroying with
 * a different account selected would, at best, fail; at worst it would delete
 * a same-named resource belonging to someone else.
 */
export function assertSameAccount(ledger: Ledger, accountId: string): void {
  if (ledger.accountId === accountId) {
    return;
  }
  throw new CliError(
    EXIT.user,
    'This project was provisioned on a different Cloudflare account.',
    `The ledger says account ${short(ledger.accountId)}; you are signed in to ` +
      `${short(accountId)}. Switch accounts (\`wrangler login\`) rather than ` +
      'letting this run act on resources it did not create.',
  );
}

/** Enough of an account id to recognise, not enough to be a credential. */
function short(accountId: string): string {
  return accountId.length <= 8 ? accountId : `${accountId.slice(0, 8)}…`;
}

/** Whether every resource the ledger names has been created. */
export function isComplete(ledger: Ledger): boolean {
  return (
    ledger.database?.status !== undefined &&
    ledger.database.status !== 'pending' &&
    ledger.bucket?.status !== undefined &&
    ledger.bucket.status !== 'pending' &&
    ledger.worker?.status !== undefined &&
    ledger.worker.status !== 'pending' &&
    (ledger.secrets ?? []).includes('MALLOK_SECRET') &&
    ledger.completedAt !== undefined
  );
}
