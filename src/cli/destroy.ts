/**
 * `mallok destroy` — delete what this project created, and nothing else.
 *
 * It reads **both** records: the registry, which is written when a create
 * finishes, and the ledger, which is written before the first resource is
 * created. A run that died halfway through create never reached the registry,
 * and used to be undeletable by this command — the resources existed, the
 * ledger named them, and nothing could act on it.
 *
 * Three refusals, all deliberate:
 *
 * - it will not run against a different Cloudflare account from the one the
 *   ledger records;
 * - it will not report a bucket as deleted when the bucket still has objects
 *   in it, because Cloudflare refuses that and a cheerful summary is worse
 *   than an error;
 * - it will not delete anything without the slug repeated back.
 */

import { join } from 'node:path';
import {
  bucketHasObjects,
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
} from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { readRegistry, type SiteRecord, writeRegistry } from './registry.js';
import { resourceNames } from './site-config.js';

/** One step of a destroy run. */
export interface DestroyStep {
  readonly label: string;
  readonly args: readonly string[];
  /** A resource that is already gone counts as done. */
  readonly tolerateMissing: boolean;
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
  /** Delete the bucket's objects before the bucket. Off by default. */
  readonly emptyBucket?: boolean;
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
 * Worker first so its bindings release, then the database, then the bucket.
 * Each names its own resource: there is no per-site config file to point `-c`
 * at, because the project's own `wrangler.jsonc` is the config.
 */
export function destroySteps(slug: string): DestroyStep[] {
  const names = resourceNames(slug);
  return [
    {
      label: `Delete the Worker ${names.worker}`,
      args: ['delete', names.worker],
      tolerateMissing: true,
    },
    {
      label: `Delete the database ${names.database}`,
      args: ['d1', 'delete', names.database, '--skip-confirmation'],
      tolerateMissing: true,
    },
    {
      label: `Delete the bucket ${names.bucket}`,
      args: ['r2', 'bucket', 'delete', names.bucket],
      tolerateMissing: true,
    },
  ];
}

/** Steps a person has to do themselves, printed at the end of a destroy. */
export const MANUAL_CLEANUP: readonly string[] = [
  'Delete the R2 custom domain (media.<your domain>) in the dashboard.',
  'Delete the Worker custom domain and the DNS records the wizard wrote.',
  'Delete the Turnstile widget, if one was created.',
  'Delete the CF_API_TOKEN you created for cache purging.',
];

/**
 * Everything this project is known to own, from either record.
 *
 * The ledger is authoritative for a half-finished create; the registry is
 * what a finished one leaves behind. A slug present in neither is refused,
 * because deleting by name alone would mean deleting whatever happens to
 * carry that name on this account.
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
  const { ledger } = await knownSite(projectDir, slug);

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
  const wrangler = wranglerFor(projectDir, runner);

  // The same account check `create` does, for the same reason: `wrangler`
  // follows whichever login is current, and a same-named resource on another
  // account is somebody else's site.
  const accountId = await currentAccountId(wrangler);
  if (ledger !== null) {
    assertSameAccount(ledger, accountId);
  }

  const names = resourceNames(slug);
  if (options.emptyBucket === true) {
    await emptyBucket(wrangler, names.bucket, report, results);
  }

  for (const step of destroySteps(slug)) {
    report.step(`${step.label}…`);

    // A non-empty bucket cannot be deleted, and wrangler's message for it is
    // easy to read as a transient failure. Say what it is.
    if (
      step.args[0] === 'r2' &&
      options.emptyBucket !== true &&
      (await bucketHasObjects(wrangler, names.bucket))
    ) {
      results.push({
        step: step.label,
        ok: false,
        detail: 'the bucket still holds objects',
      });
      report.warn(
        `${names.bucket} is not empty. Cloudflare will not delete a bucket ` +
          'with objects in it. Re-run with --empty-bucket to delete them ' +
          'first — that destroys every uploaded image and file.',
      );
      return finish(results, step.label, slug);
    }

    const run = await wrangler.run(step.args);
    const missing = /not found|does not exist|no such/i.test(
      `${run.stderr}${run.stdout}`,
    );
    const ok = run.code === 0 || (step.tolerateMissing && missing);
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

/**
 * Deletes every object in a bucket, one page at a time.
 *
 * Explicit and opt-in: this is the step that destroys a site's uploaded
 * images, and no amount of "the bucket must be empty to delete it" makes that
 * something to do on the user's behalf without being asked.
 */
async function emptyBucket(
  wrangler: Wrangler,
  bucket: string,
  report: Reporter,
  results: DestroyOutcome[],
): Promise<void> {
  report.step(`Emptying ${bucket}…`);
  const listing = await wrangler.run([
    'r2',
    'object',
    'list',
    bucket,
    '--json',
  ]);
  if (listing.code !== 0) {
    results.push({
      step: `Empty the bucket ${bucket}`,
      ok: false,
      detail: lastLine(listing.stderr, listing.stdout),
    });
    throw new CliError(
      EXIT.remote,
      `Could not list ${bucket}, so it cannot be emptied safely.`,
      lastLine(listing.stderr, listing.stdout),
    );
  }
  const text = listing.stdout.slice(listing.stdout.search(/[[{]/));
  const parsed = JSON.parse(text === '' ? '[]' : text) as
    | { objects?: { key?: string }[] }
    | { key?: string }[];
  const objects = Array.isArray(parsed) ? parsed : (parsed.objects ?? []);
  let deleted = 0;
  for (const object of objects) {
    const key = object.key;
    if (key === undefined) {
      continue;
    }
    const remove = await wrangler.run([
      'r2',
      'object',
      'delete',
      `${bucket}/${key}`,
    ]);
    if (remove.code !== 0) {
      throw new CliError(
        EXIT.remote,
        `Could not delete ${bucket}/${key}.`,
        lastLine(remove.stderr, remove.stdout),
      );
    }
    deleted++;
  }
  results.push({
    step: `Empty the bucket ${bucket}`,
    ok: true,
    detail: `${deleted} object${deleted === 1 ? '' : 's'} deleted`,
  });
}
