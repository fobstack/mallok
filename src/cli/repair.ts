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
  currentAccountId,
  findBucket,
  findDatabase,
  findWorker,
  type Wrangler,
  wranglerFor,
} from './cloudflare.js';
import {
  type Ledger,
  type ResourceRecord,
  readLedger,
  writeLedger,
} from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { readRegistry, upsertSite, writeRegistry } from './registry.js';
import { resourceNames } from './site-config.js';

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
  readonly run?: CommandRunner;
}

export interface RepairResult {
  readonly slug: string;
  readonly accountId: string;
  readonly adopted: readonly Adoptable[];
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

  const wrangler = wranglerFor(projectDir, runner, options.accountId);
  // `currentAccountId` already refuses when `--account-id` names an account
  // this login cannot reach, which is what stops this command being a way to
  // claim an account rather than record one.
  const accountId = await currentAccountId(wrangler, options.accountId);

  // A record that already names a *different* account is not repaired. It is
  // a statement that these resources belong elsewhere, and overwriting it is
  // how this command would become the hole it exists to close.
  for (const [what, known] of [
    ['ledger', ledger?.accountId],
    ['registry', record?.accountId],
  ] as const) {
    if (
      typeof known === 'string' &&
      known !== '' &&
      known !== accountId &&
      options.adopt === undefined
    ) {
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
  const names = resourceNames(options.slug);

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

  return { slug: options.slug, accountId, adopted, changed };
}
