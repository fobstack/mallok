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
  bucketDomains,
  type CommandRunner,
  currentAccountId,
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
  readonly id: 'bucket' | 'worker' | 'database';
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

/** What a bucket has to be before Cloudflare will delete it. */
const NOT_EMPTY = /not empty|contains objects|bucket is not empty/i;

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
  if (record?.accountId != null && record.accountId !== accountId) {
    throw new CliError(
      EXIT.user,
      `"${slug}" was provisioned on a different Cloudflare account.`,
      'Switch accounts, or pass --account-id for the one that owns it. ' +
        'Deleting by name on the wrong account deletes somebody else’s site.',
    );
  }

  const names = resourceNames(slug);

  // An attached R2 custom domain keeps the hostname claimed after the bucket
  // is gone. It is read here, reported, and removed by the operator — there
  // is no need to guess whether one exists.
  const domains = await bucketDomains(wrangler, names.bucket);
  for (const domain of domains as { domain: string }[]) {
    report.warn(
      `${names.bucket} still has the custom domain ${domain.domain}. Remove ` +
        `it first: wrangler r2 bucket domain remove ${names.bucket} --domain ${domain.domain}`,
    );
  }
  if (domains.length > 0) {
    results.push({
      step: `Detach the custom domains on ${names.bucket}`,
      ok: false,
      detail: domains.map((entry) => entry.domain).join(', '),
    });
    return finish(
      results,
      `Detach the custom domains on ${names.bucket}`,
      slug,
    );
  }

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
    const missing = /not found|does not exist|no such|couldn'?t find/i.test(
      output,
    );
    const ok = run.code === 0 || missing;

    if (!ok && step.id === 'bucket' && NOT_EMPTY.test(output)) {
      // The one refusal worth explaining, and the reason the bucket goes
      // first: everything else is still intact, so the site still works while
      // its owner decides what to do with the objects.
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

    results.push({
      step: step.label,
      ok,
      detail: ok
        ? missing
          ? 'already gone'
          : 'deleted'
        : lastLine(run.stderr, run.stdout),
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
