/**
 * `mallok repair` — put an account id back into a project's records, and
 * adopt a resource only when somebody says so out loud.
 *
 * Every other command in this file's neighbourhood refuses to touch a
 * Cloudflare resource it cannot prove belongs to this project, and the proof
 * is the account id written when the resource was created. That is the right
 * default, and it leaves a gap: a project whose records lost their account id
 * — an old registry, a hand-edited file, a half-finished create — becomes
 * undeletable and unrecoverable by the very checks meant to protect it.
 *
 * This is the deliberate, explicit way out. It does two things, and neither
 * of them happens by accident:
 *
 * 1. **Record the account.** It asks `wrangler whoami`, shows what it found,
 *    and writes that id into the ledger and the registry. When `--account-id`
 *    is given it must match what Wrangler reports, so this cannot be used to
 *    *assert* an account the current login cannot reach.
 *
 * 2. **Adopt a pending resource, by name.** A `create` interrupted between
 *    "about to make the database" and "made it" leaves a `pending` record and
 *    possibly a real resource. `create` used to reconcile that pair by
 *    itself, which is a guess: on a shared account a same-named database
 *    belongs to whoever made it, and pointing a site at it means running
 *    migrations against somebody else's data. So `create` now stops and
 *    prints what it saw, and `--adopt database` here is how a person says
 *    "yes, that one is mine" — after reading the remote id it prints.
 *
 * It never creates or deletes anything on Cloudflare.
 */

import { join } from 'node:path';
import {
  type CommandRunner,
  findBucket,
  findDatabase,
  findWorker,
  verifiedWrangler,
  type Wrangler,
} from './cloudflare.js';
import {
  assertLedgerResourceNames,
  type Ledger,
  type ResourceRecord,
  readLedger,
  writeLedger,
} from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { readRegistry, upsertSite, writeRegistry } from './registry.js';
import { PLACEHOLDER_DATABASE_ID, resourceNames } from './site-config.js';

/** The resources a pending record can name. */
export const ADOPTABLE = ['database', 'bucket', 'worker'] as const;
export type Adoptable = (typeof ADOPTABLE)[number];

export interface RepairOptions {
  readonly slug: string;
  readonly projectDir?: string;
  /** Checked against `whoami`; never used to assert an unreachable account. */
  readonly accountId?: string | undefined;
  /** Resources to adopt, named one at a time and never inferred. */
  readonly adopt?: readonly Adoptable[];
  /**
   * The id the operator read, repeated back.
   *
   * Required to adopt a D1 database. `create` prints the id it found, and
   * between that and somebody running this command the resource can be
   * replaced — a name is reusable, and the second thing under it is not the
   * thing that was looked at. Repeating the id is what ties the decision to
   * the resource it was made about.
   *
   * R2 buckets and Workers have no comparable id that Wrangler will report,
   * so this does not apply to them and is not pretended to (`unverifiable`).
   */
  readonly expectId?: string | undefined;
  readonly run?: CommandRunner;
}

export interface RepairResult {
  readonly slug: string;
  readonly accountId: string;
  readonly adopted: readonly Adoptable[];
  /**
   * Adopted resources whose identity could only be checked by name.
   *
   * Cloudflare gives a D1 database a UUID that Wrangler reports, so adopting
   * one can be tied to a specific database. R2 buckets and Workers are
   * addressed by name and nothing else, so "this is ours" rests on the
   * account plus the name — which is weaker, and is reported rather than
   * quietly treated as the same thing.
   */
  readonly unverifiable: readonly Adoptable[];
  /** What changed on disk, for the report. */
  readonly changed: readonly string[];
}

/** Asks Cloudflare what exists under this name, for one kind. */
async function lookup(
  wrangler: Wrangler,
  kind: Adoptable,
  name: string,
): Promise<{ exists: boolean; id?: string }> {
  if (kind === 'database') {
    return await findDatabase(wrangler, name);
  }
  if (kind === 'bucket') {
    return await findBucket(wrangler, name);
  }
  return await findWorker(wrangler, name);
}

export async function repairSite(
  options: RepairOptions,
  report: Reporter,
): Promise<RepairResult> {
  const projectDir = options.projectDir ?? process.cwd();
  const runner = options.run;
  if (runner === undefined) {
    throw new CliError(EXIT.user, 'No command runner was provided.');
  }

  const ledger = await readLedger(projectDir);
  const registryPath = join(projectDir, '.mallok/sites.json');
  const sites = await readRegistry(registryPath);
  const record = sites.find((site) => site.slug === options.slug);

  if (ledger === null && record === undefined) {
    throw new CliError(
      EXIT.user,
      `This project has no record of a site called "${options.slug}".`,
      'Run this from the project directory that created it.',
    );
  }
  if (ledger !== null && ledger.slug !== options.slug) {
    throw new CliError(
      EXIT.user,
      `This project was provisioned for "${ledger.slug}", not "${options.slug}".`,
      `Run \`mallok repair ${ledger.slug}\`.`,
    );
  }

  const names = resourceNames(options.slug);
  const { wrangler, accountId, identity } = await verifiedWrangler(
    projectDir,
    runner,
    options.accountId,
  );
  if (
    identity.worker !== names.worker ||
    identity.database.name !== names.database ||
    identity.bucket.name !== names.bucket
  ) {
    throw new CliError(
      EXIT.user,
      'wrangler.jsonc targets different resources from this site record.',
      `Expected Worker ${names.worker}, database ${names.database} and bucket ` +
        `${names.bucket}; found ${identity.worker}, ${identity.database.name} ` +
        `and ${identity.bucket.name}. Nothing has been changed.`,
    );
  }
  if (ledger !== null) {
    assertLedgerResourceNames(ledger, names);
  }
  if (record !== undefined && record.bucket !== names.bucket) {
    throw new CliError(
      EXIT.user,
      'The registry identifies a different R2 bucket.',
      `Expected ${names.bucket}; the registry records ${record.bucket}. ` +
        'Nothing has been changed.',
    );
  }

  // A record that already names a *different* account is never repaired, and
  // **`--adopt` does not change that**. The guard used to read "refuse a
  // mismatch unless we are adopting", which is exactly backwards: adopting is
  // the operation that points a site at a resource, so it is the last one
  // that should skip the check.
  for (const [what, known] of [
    ['ledger', ledger?.accountId],
    ['registry', record?.accountId],
  ] as const) {
    if (typeof known === 'string' && known !== '' && known !== accountId) {
      throw new CliError(
        EXIT.user,
        `The ${what} says this site belongs to another Cloudflare account.`,
        `It records ${known}; you are signed in to ${accountId}. Sign in to ` +
          'that account instead. If the record is genuinely wrong, delete ' +
          'the file and provision again — this command will not overwrite ' +
          'one account id with another.',
      );
    }
  }

  const changed: string[] = [];
  const adopted: Adoptable[] = [];
  const unverifiable: Adoptable[] = [];

  // Filling in a missing account id from `whoami` alone records "whoever is
  // signed in" as the owner. When the records already name a D1 UUID, that is
  // a second, stronger piece of evidence and it is checked: if the database
  // of that name on this account reports a different id, these records
  // describe some other site and must not be stamped with this account.
  const ledgerDatabaseId =
    ledger?.database?.status === 'created' ||
    ledger?.database?.status === 'adopted'
      ? ledger.database.id
      : undefined;
  const registryDatabaseId = record?.databaseId ?? undefined;
  if (
    typeof ledgerDatabaseId === 'string' &&
    ledgerDatabaseId !== '' &&
    typeof registryDatabaseId === 'string' &&
    registryDatabaseId !== '' &&
    ledgerDatabaseId !== registryDatabaseId
  ) {
    throw new CliError(
      EXIT.user,
      'The ledger and registry identify different D1 databases.',
      `Ledger: ${ledgerDatabaseId}; registry: ${registryDatabaseId}. ` +
        'Nothing has been changed.',
    );
  }
  const knownDatabaseId = ledgerDatabaseId ?? registryDatabaseId;
  if (typeof knownDatabaseId === 'string' && knownDatabaseId !== '') {
    if (
      identity.database.id !== knownDatabaseId &&
      identity.database.id !== PLACEHOLDER_DATABASE_ID
    ) {
      throw new CliError(
        EXIT.user,
        'wrangler.jsonc is bound to a different D1 database.',
        `The records name ${knownDatabaseId}; the DB binding names ` +
          `${identity.database.id}. Nothing has been changed.`,
      );
    }
    const found = await findDatabase(wrangler, names.database);
    if (!found.exists) {
      throw new CliError(
        EXIT.user,
        `There is no database called ${names.database} on account ${accountId}.`,
        `The records name the database ${knownDatabaseId}. Either this is ` +
          'not the account that owns this site, or the database is gone — ' +
          'and recording this account would make the records say something ' +
          'nobody has checked.',
      );
    }
    if (found.id !== knownDatabaseId) {
      throw new CliError(
        EXIT.user,
        `${names.database} on this account is a different database from the one recorded.`,
        `The records name ${knownDatabaseId}; account ${accountId} reports ` +
          `${found.id}. A name can be reused, so this is somebody else's ` +
          'database or a later one of your own. Nothing has been changed.',
      );
    }
  }

  let next: Ledger | null = ledger;
  for (const kind of options.adopt ?? []) {
    if (next === null) {
      throw new CliError(
        EXIT.user,
        'There is no ledger in this project, so there is nothing to adopt.',
        'Adoption resumes an interrupted `create`; a project without a ledger ' +
          'never started one.',
      );
    }
    const current = next[kind] as ResourceRecord | undefined;
    if (current?.status !== 'pending') {
      throw new CliError(
        EXIT.user,
        `The ledger does not have a pending ${kind} to adopt.`,
        current === undefined
          ? `It records nothing about the ${kind}.`
          : `It records the ${kind} as "${current.status}" already.`,
      );
    }
    const name = current.name ?? names[kind === 'worker' ? 'worker' : kind];
    const found = await lookup(wrangler, kind, name);
    if (!found.exists) {
      throw new CliError(
        EXIT.user,
        `There is no ${kind} called ${name} on this account.`,
        'Nothing to adopt. Run `mallok create .` to finish provisioning ' +
          'instead — it will create it.',
      );
    }

    // A D1 database has a UUID, so adopting one can be tied to a specific
    // database rather than to a name. The operator has to repeat that id
    // back: between `create` printing what it saw and this command running,
    // the resource under that name can be replaced, and an adoption that
    // cannot tell the difference is an adoption of whatever is there now.
    if (kind === 'database') {
      // `findDatabase` never reports an existing D1 without a UUID. Keeping
      // this explicit prevents D1 from falling into the name-only path used
      // for R2 and Workers if that contract is weakened later.
      if (found.id === undefined || found.id === '') {
        throw new CliError(
          EXIT.remote,
          `Cloudflare did not identify the database ${name}.`,
          'A D1 database cannot be adopted by name alone.',
        );
      }
      if (
        identity.database.id !== PLACEHOLDER_DATABASE_ID &&
        identity.database.id !== found.id
      ) {
        throw new CliError(
          EXIT.user,
          'wrangler.jsonc is bound to a different D1 database.',
          `The DB binding names ${identity.database.id}; Cloudflare reports ` +
            `${found.id}. Nothing has been changed.`,
        );
      }
      if (options.expectId === undefined || options.expectId === '') {
        throw new CliError(
          EXIT.user,
          `Adopting the ${kind} ${name} needs the id it is expected to have.`,
          `It currently reports ${found.id}. Check that against what \`mallok ` +
            'create` printed, then repeat it back:\n' +
            `  mallok repair ${options.slug} --adopt ${kind} --expect-id ${found.id}`,
        );
      }
      if (options.expectId !== found.id) {
        throw new CliError(
          EXIT.user,
          `The ${kind} ${name} is no longer ${options.expectId}.`,
          `It now reports ${found.id}. A name can be reused, so this is not ` +
            'the resource the decision was made about. Nothing has been ' +
            'changed.',
        );
      }
    } else {
      // R2 buckets and Workers are addressed by name and nothing else, so the
      // evidence here is the account plus the name. Weaker, and reported as
      // such rather than quietly treated as the same thing.
      unverifiable.push(kind);
    }

    report.step(
      `Adopting the ${kind} ${name}${found.id === undefined ? '' : ` (${found.id})`}…`,
    );
    next = {
      ...next,
      [kind]: {
        status: 'adopted',
        name,
        ...(found.id === undefined ? {} : { id: found.id }),
        at: new Date().toISOString(),
      },
    };
    adopted.push(kind);
    changed.push(`${kind} adopted`);
  }

  if (next !== null && (next.accountId !== accountId || adopted.length > 0)) {
    if (next.accountId !== accountId) {
      changed.push('ledger account id');
    }
    await writeLedger(projectDir, { ...next, accountId });
  }

  if (record !== undefined && record.accountId !== accountId) {
    await writeRegistry(
      upsertSite(sites, { ...record, accountId }),
      registryPath,
    );
    changed.push('registry account id');
  }

  report.step(
    changed.length === 0
      ? `Nothing to repair: ${options.slug} already records ${accountId}.`
      : `Repaired ${options.slug}: ${changed.join(', ')}.`,
  );

  return { slug: options.slug, accountId, adopted, unverifiable, changed };
}
