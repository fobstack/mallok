/**
 * `mallok destroy` — delete what this project created, and nothing else.
 *
 * It reads **both** records: the registry, written when a create finishes,
 * and the ledger, written before the first resource is created. A run that
 * died halfway through create never reached the registry, and used to be
 * undeletable by this command — the resources existed, the ledger named them,
 * and nothing could act on it.
 *
 * The order is the bucket first, and that is the opposite of what it was.
 * Cloudflare refuses to delete an R2 bucket that still holds objects, so
 * deleting the Worker and the database first produced the worst possible
 * outcome: the site is gone, its content is gone, and the bucket full of
 * images is still there with nothing left to explain it. Now the step that
 * can refuse runs while everything else is still intact.
 *
 * There is no automatic emptying. Wrangler 4.124.0 has `r2 object get`, `put`
 * and `delete`, and **no** `r2 object list` — a previous version of this file
 * built `--empty-bucket` on a listing command that does not exist, tested it
 * against a fake that invented it, and would have failed on the first real
 * account it met. `test/cli/wrangler-contract.test.ts` now checks every
 * subcommand against the locked binary's own help.
 */

import { join } from 'node:path';
import {
  type CommandRunner,
  currentAccountId,
  isDefiniteAbsence,
  type ResourceKind,
  lastLine,
  type Wrangler,
  wranglerFor,
} from './cloudflare.js';
import {
  assertSameAccount,
  clearLedger,
  type Ledger,
  readLedger,
  writeLedger,
} from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { readRegistry, type SiteRecord, writeRegistry } from './registry.js';
import { resourceNames } from './site-config.js';

/** One step of a destroy run. */
export interface DestroyStep {
  /** Also the {@link ResourceKind} used to judge what a refusal meant. */
  readonly id: Extract<ResourceKind, 'bucket' | 'worker' | 'database'>;
  readonly label: string;
  readonly args: readonly string[];
}

/** What a destroy run did, step by step. */
export interface DestroyOutcome {
  readonly step: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DestroyOptions {
  readonly slug: string;
  readonly confirm: string | undefined;
  readonly dryRun?: boolean;
  /** The account this is expected to act on; checked against `whoami`. */
  readonly accountId?: string;
  readonly projectDir?: string;
  readonly run?: CommandRunner;
}

export interface DestroyResult {
  readonly slug: string;
  readonly results: readonly DestroyOutcome[];
  readonly stoppedAt: string | null;
  readonly manual: readonly string[];
}

/**
 * The delete order (docs/CLOUDFLARE_RESOURCES.md §10).
 *
 * Bucket, then Worker, then database. The bucket is first because it is the
 * only step Cloudflare can refuse on a condition this command cannot fix, and
 * a refusal is worth far more before the site is gone than after it.
 */
export function destroySteps(slug: string): DestroyStep[] {
  const names = resourceNames(slug);
  return [
    {
      id: 'bucket',
      label: `Delete the bucket ${names.bucket}`,
      args: ['r2', 'bucket', 'delete', names.bucket],
    },
    {
      id: 'worker',
      label: `Delete the Worker ${names.worker}`,
      args: ['delete', names.worker],
    },
    {
      id: 'database',
      label: `Delete the database ${names.database}`,
      args: ['d1', 'delete', names.database, '--skip-confirmation'],
    },
  ];
}

/** Steps a person has to do themselves, printed at the end of a destroy. */
export const MANUAL_CLEANUP: readonly string[] = [
  'Delete the Worker custom domain and the DNS records the wizard wrote.',
  'Delete the Turnstile widget, if one was created.',
  'Delete the CF_API_TOKEN you created for cache purging.',
];

/** Why a delete was refused, as far as the message can be trusted. */
export type DeleteFailure =
  | 'absent'
  | 'not-empty'
  | 'domain-attached'
  | 'unknown';

const NOT_EMPTY = /not empty|contains objects|bucket is not empty/i;
const DOMAIN_ATTACHED = /custom domain|domain attached|attached domain/i;

/**
 * Classifies a failed delete.
 *
 * Only `absent` lets a run continue, and the default is `unknown`, which
 * stops it. That asymmetry is the whole design: a recogniser that misses a
 * case costs an operator one confusing message, while a recogniser that is
 * too generous deletes a Worker and a database because a token expired.
 *
 * `absent` is decided by {@link isDefiniteAbsence}, which rules out
 * authentication, permission, transport and API-routing failures **before**
 * looking for "not found" — every one of those can contain the phrase.
 */
export function classifyDeleteFailure(
  text: string,
  kind: ResourceKind,
): DeleteFailure {
  if (isDefiniteAbsence(text, kind)) {
    return 'absent';
  }
  // Checked before "not empty": a bucket can be both, and the domain is the
  // one the operator has to deal with first.
  if (DOMAIN_ATTACHED.test(text)) {
    return 'domain-attached';
  }
  if (NOT_EMPTY.test(text)) {
    return 'not-empty';
  }
  return 'unknown';
}

/**
 * Everything this project is known to own, from either record.
 *
 * A slug present in neither is refused: deleting by name alone would mean
 * deleting whatever happens to carry that name on this account.
 */
async function knownSite(
  projectDir: string,
  slug: string,
): Promise<{ ledger: Ledger | null; record: SiteRecord | undefined }> {
  const ledger = await readLedger(projectDir);
  const sites = await readRegistry(join(projectDir, '.mallok/sites.json'));
  const record = sites.find((site) => site.slug === slug);
  if (ledger === null && record === undefined) {
    throw new CliError(
      EXIT.user,
      `This project has no record of a site called "${slug}".`,
      sites.length === 0
        ? 'Run this from the project directory that created it.'
        : `Known sites here: ${sites.map((site) => site.slug).join(', ')}.`,
    );
  }
  if (ledger !== null && ledger.slug !== slug) {
    throw new CliError(
      EXIT.user,
      `This project was provisioned for "${ledger.slug}", not "${slug}".`,
      `Run \`mallok destroy ${ledger.slug} --confirm ${ledger.slug}\`.`,
    );
  }
  return { ledger, record };
}

/** Deletes a site's resources. */
export async function destroySite(
  options: DestroyOptions,
  report: Reporter,
): Promise<DestroyResult> {
  const projectDir = options.projectDir ?? process.cwd();
  const { slug } = options;
  const { ledger, record } = await knownSite(projectDir, slug);

  if (options.confirm !== slug) {
    // Deleting a site destroys its content, its media and its inquiries.
    throw new CliError(
      EXIT.user,
      'This permanently deletes the Worker, the database and the bucket.',
      `Export a backup first, then run: mallok destroy ${slug} --confirm ${slug}`,
    );
  }

  const results: DestroyOutcome[] = [];
  if (options.dryRun === true) {
    for (const step of destroySteps(slug)) {
      report.step(`${step.label}…`);
      results.push({ step: step.label, ok: true, detail: 'dry run' });
    }
    return { slug, results, stoppedAt: null, manual: MANUAL_CLEANUP };
  }

  const runner = options.run;
  if (runner === undefined) {
    throw new CliError(EXIT.user, 'No command runner was provided.');
  }
  const wrangler = wranglerFor(projectDir, runner, options.accountId);

  // Every read-only check first, before anything is deleted.
  //
  // `wrangler` follows whichever login is current, so a same-named resource
  // on another account is somebody else's site. The account is checked
  // against **both** records: a completed create leaves a registry entry
  // carrying it, and an interrupted one leaves a ledger.
  const accountId = await currentAccountId(wrangler, options.accountId);
  if (ledger !== null) {
    assertSameAccount(ledger, accountId);
  }
  if (record !== undefined) {
    // A record with **no** account id used to skip this comparison entirely,
    // because it was guarded on the value being set. That is the wrong way
    // round: an unproven record is exactly the one not to delete by name.
    if (
      typeof record.accountId !== 'string' ||
      record.accountId.trim() === ''
    ) {
      throw new CliError(
        EXIT.user,
        `The registry entry for "${slug}" does not record which Cloudflare account it belongs to.`,
        'Deleting by name alone would delete whatever carries that name on ' +
          `the account you happen to be signed in to (${accountId}). Record ` +
          `it first: \`mallok repair ${slug}\` checks the signed-in account ` +
          'and writes it down.',
      );
    }
    if (record.accountId !== accountId) {
      throw new CliError(
        EXIT.user,
        `"${slug}" was provisioned on a different Cloudflare account.`,
        `The registry records ${record.accountId}; you are signed in to ` +
          `${accountId}. Switch accounts, or pass --account-id for the one ` +
          'that owns it. Deleting by name on the wrong account deletes ' +
          'somebody else’s site.',
      );
    }
  }

  const names = resourceNames(slug);

  // No pre-flight probe for an attached R2 custom domain.
  //
  // There used to be one, and it asked `wrangler r2 bucket domain list
  // <bucket> --json`. The subcommand is real; **`--json` is not** — the
  // locked Wrangler 4.124.0 documents only `-J, --jurisdiction` for it. The
  // probe could therefore only ever have worked against the fake that
  // answered it. `test/cli/wrangler-flags.test.ts` drives these functions
  // with a recording runner and checks the argument vectors they really build
  // against the binary's own `--help`, so a flag that does not exist fails
  // the suite rather than the operator's account.
  //
  // The delete itself is the probe. It is attempted first, while the Worker
  // and the database are still intact, and whatever it refuses with is
  // classified below.

  let progress: Ledger | null = ledger;
  for (const step of destroySteps(slug)) {
    if (progress?.deleted?.includes(step.id) === true) {
      // A repeated run: this one is already gone, and saying so is cheaper
      // and safer than asking Cloudflare again.
      results.push({ step: step.label, ok: true, detail: 'already deleted' });
      continue;
    }
    report.step(`${step.label}…`);

    const run = await wrangler.run(step.args);
    const output = `${run.stderr}${run.stdout}`;
    const failure =
      run.code === 0 ? null : classifyDeleteFailure(output, step.id);
    const ok = failure === null || failure === 'absent';

    if (failure === 'not-empty') {
      // The refusal the bucket-first order exists for: everything else is
      // still intact, so the site keeps serving while its owner decides what
      // to do with the objects.
      results.push({
        step: step.label,
        ok: false,
        detail: 'the bucket still holds objects',
      });
      report.warn(
        `${names.bucket} is not empty, and Cloudflare will not delete a ` +
          'bucket with objects in it. Nothing else has been deleted: the ' +
          'site is still running. Export your media, remove the objects ' +
          '(the dashboard can empty a bucket), then run this again.',
      );
      return finish(results, step.label, slug);
    }

    if (failure === 'domain-attached') {
      // Both commands below exist in the locked Wrangler with exactly these
      // flags, which is the point: a message that tells somebody to run
      // something that does not exist is worse than no message.
      results.push({
        step: step.label,
        ok: false,
        detail: 'a custom domain is still attached to the bucket',
      });
      report.warn(
        `${names.bucket} still has a custom domain attached, and Cloudflare ` +
          'will not delete a bucket while one is. Nothing else has been ' +
          'deleted: the site is still running. See which domains are ' +
          `attached with:\n    wrangler r2 bucket domain list ${names.bucket}` +
          '\nthen detach each one with:\n    wrangler r2 bucket domain ' +
          `remove ${names.bucket} --domain <domain>\nand run this again.`,
      );
      return finish(results, step.label, slug);
    }

    if (failure === 'unknown') {
      // Not "already gone". Wrangler failed for a reason this cannot read —
      // an expired token, a network that is down, a permission the account
      // lacks — and none of those says anything about the resource. Stopping
      // here is what keeps a dead token from deleting a live site.
      results.push({
        step: step.label,
        ok: false,
        detail: lastLine(run.stderr, run.stdout),
      });
      report.warn(
        `${step.label} failed, and the reason is not "it is already gone". ` +
          'Nothing further has been deleted. Check the account and the ' +
          'network, then run this again — it resumes from here.',
      );
      return finish(results, step.label, slug);
    }

    results.push({
      step: step.label,
      ok,
      detail: failure === 'absent' ? 'already gone' : 'deleted',
    });
    if (!ok) {
      // Stop rather than continue past a failure: a half-deleted site with no
      // report is worse than one that says where it stopped.
      return finish(results, step.label, slug);
    }

    // Recorded as it happens, so a repeated run picks up exactly here.
    if (progress !== null) {
      progress = {
        ...progress,
        deleted: [...(progress.deleted ?? []), step.id],
      };
      await writeLedger(projectDir, progress);
    }
  }

  // Only now: both records are cleared, because both described resources that
  // no longer exist.
  const registryPath = join(projectDir, '.mallok/sites.json');
  const sites = await readRegistry(registryPath);
  await writeRegistry(
    sites.filter((site) => site.slug !== slug),
    registryPath,
  );
  await clearLedger(projectDir);

  return finish(results, null, slug);
}

function finish(
  results: readonly DestroyOutcome[],
  stoppedAt: string | null,
  slug: string,
): DestroyResult {
  return { slug, results: [...results], stoppedAt, manual: MANUAL_CLEANUP };
}

/** Re-exported for the gate documentation and tests. */
export type { Wrangler };
