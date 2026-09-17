/**
 * `mallok create` — generate a project, prove it builds, then provision.
 *
 * The order is the whole design. It used to sign in, create a D1 database,
 * create an R2 bucket, write a config and only then attempt a deploy — so a
 * project that could not build left two real resources behind, named after a
 * site that did not exist, recorded nowhere.
 *
 * Now, in order:
 *
 *   free and reversible   check the arguments, generate the project, write
 *                         the **final** configuration, install, build, and
 *                         `wrangler deploy --dry-run` with that exact config
 *   read-only             which account is this, and does anything of these
 *                         names already exist
 *   irreversible          create, deploy, set secrets — each one recorded in
 *                         the ledger before the call that performs it
 *
 * Running it again on a finished project does nothing at all: no deploy, no
 * new secret, exit 0. Running it again on an interrupted one continues from
 * the ledger.
 */

import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { access, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  type CommandRunner,
  findBucket,
  findDatabase,
  findWorker,
  lastLine,
  secretNames,
  verifiedWrangler,
  type Wrangler,
} from './cloudflare.js';
import { assertInteractiveSecretDelivery, deliverSecret } from './deliver.js';
import {
  assertLedgerResourceNames,
  assertSameAccount,
  isComplete,
  LEDGER_FILE,
  LEDGER_SCHEMA_VERSION,
  type Ledger,
  type ResourceRecord,
  readLedger,
  writeLedger,
} from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import {
  assertNpmProject,
  frozenInstallArgs,
  installArgs,
  LOCKFILE,
  runArgs,
} from './package-manager.js';
import { readRegistry, upsertSite, writeRegistry } from './registry.js';
import {
  configFingerprint,
  normaliseDomain,
  PLACEHOLDER_DATABASE_ID,
  parseDatabaseId,
  rateLimitNamespace,
  resourceNames,
  type SiteConfigInput,
  validateDomain,
  validateSlug,
  writeSiteConfig,
} from './site-config.js';
import {
  generateProject,
  hasProjectWrangler,
  isMallokProject,
  isUsableTarget,
  verifyTemplate,
} from './template.js';

export type { CommandRunner, RunResult } from './cloudflare.js';

export const spawnRunner: CommandRunner = (command, args, options) =>
  new Promise((done) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
    child.on('error', (error) =>
      done({ code: 127, stdout, stderr: `${stderr}${error.message}` }),
    );
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });

export interface CreateOptions {
  /** The directory to create, as given on the command line. */
  readonly directory: string;
  /** Cloudflare resource slug. Defaults to the directory's own name. */
  readonly slug?: string;
  readonly domain?: string | null;
  /** Generate and verify locally; touch nothing on Cloudflare. */
  readonly noDeploy?: boolean;
  /** Verify in a temporary directory, then remove it. */
  readonly dryRun?: boolean;
  /** The Cloudflare account to act on; checked against `whoami`. */
  readonly accountId?: string | undefined;
  /**
   * Hands the one-time setup key to a person, and throws if it cannot.
   *
   * The ledger records `setupKeyDeliveredAt` **after** this returns, never
   * before: Cloudflare does not give a secret's value back, so a key that was
   * set and never shown is a key nobody has, and a ledger that claims
   * otherwise stops the next run from rotating it. The site would then be
   * deployed, unclaimable and unrecoverable.
   *
   * The default writes to stdout and waits for the write to be accepted. A
   * caller that cannot deliver — a closed pipe, a full disk — must throw, so
   * that this run fails loudly and the next one rotates.
   */
  readonly deliverSetupKey?: (key: string) => Promise<void> | void;
  /**
   * The rate-limit namespace id, when the derived one will not do.
   *
   * The derivation is deterministic and collision-*resistant*, not
   * collision-free (see `rateLimitNamespace`). This is the way out when two
   * slugs on one account do land on the same number: pick one, set it here,
   * and it is written to `wrangler.jsonc` and the ledger like any other.
   */
  readonly rateLimitNamespace?: string | undefined;
  /**
   * Asks the deployed site whether it already has an administrator.
   *
   * Injected so that tests do not reach the network; the default asks the
   * site's own public setup endpoint.
   */
  readonly hasAdministrator?: (origin: string) => Promise<boolean | null>;
  readonly cwd?: string;
  readonly run?: CommandRunner;
  readonly templateDir?: string;
}

/**
 * Checks an explicitly given rate-limit namespace.
 *
 * Cloudflare wants a positive 32-bit integer, and a value it rejects is only
 * discovered at `wrangler deploy` — after the database and the bucket exist.
 * The whole point of taking an override is that somebody is working around a
 * collision, so it has to be rejected here or not at all.
 */
function assertNamespace(value: string): string {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 4_294_967_295) {
    throw new CliError(
      EXIT.user,
      `--rate-limit-namespace must be a whole number from 1 to 4294967295; got "${value}".`,
      'Cloudflare rejects anything else, and it would fail at deploy time, ' +
        'after the database and the bucket had already been created.',
    );
  }
  return String(number);
}

export interface CreateResult {
  readonly projectDir: string;
  readonly slug: string;
  readonly origin: string | null;
  readonly deployed: boolean;
  readonly ledger: Ledger | null;
  /** True when the project was already finished and nothing was done. */
  readonly alreadyComplete: boolean;
}

/** A slug derived from a directory name. */
export function slugFromDirectory(directory: string): string {
  return basename(resolve(directory))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** The preflight steps, in order. Each must pass before Cloudflare is touched. */
export interface PreflightStep {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

export function preflightSteps(
  projectDir: string,
  hasLockfile: boolean,
): PreflightStep[] {
  return [
    {
      label: hasLockfile
        ? 'Installing dependencies (from the lockfile)'
        : 'Installing dependencies',
      command: 'npm',
      args: hasLockfile ? frozenInstallArgs() : installArgs(),
    },
    {
      label: 'Building',
      command: 'npm',
      args: runArgs('build'),
    },
    {
      // The project's own Wrangler, at the version its lockfile pinned, and
      // the configuration this run intends to deploy — not a placeholder.
      label: 'Checking the deploy would succeed',
      command: join(projectDir, 'node_modules/.bin/wrangler'),
      args: ['deploy', '--dry-run', '--outdir', 'dist/worker-preflight'],
    },
  ];
}

/**
 * Creates a site.
 *
 * Reads as one long function because the order *is* the contract: every early
 * return is a point where nothing on Cloudflare has been touched yet, and
 * splitting it up would make that harder to check rather than easier.
 */
export async function createSite(
  options: CreateOptions,
  report: Reporter,
): Promise<CreateResult> {
  const runner = options.run ?? spawnRunner;
  const cwd = options.cwd ?? process.cwd();
  const slug = options.slug ?? slugFromDirectory(options.directory);
  // Normalised before anything reads it: the configuration, the fingerprint
  // and the Worker's own `MALLOK_DOMAIN` must all agree, and they only do if
  // there is one spelling of the name.
  const domain =
    options.domain === undefined || options.domain === null
      ? null
      : normaliseDomain(options.domain);

  // ---- 1. Checks that cost nothing --------------------------------------
  const slugError = validateSlug(slug);
  if (slugError !== null) {
    throw new CliError(
      EXIT.user,
      slugError,
      'Pass --slug to choose one that differs from the directory name.',
    );
  }
  if (domain !== null) {
    const domainError = validateDomain(domain);
    if (domainError !== null) {
      throw new CliError(EXIT.user, `--domain ${domain}: ${domainError}`);
    }
  }
  await verifyTemplate(options.templateDir);

  const projectDir =
    options.dryRun === true
      ? await temporaryDirectory()
      : resolve(cwd, options.directory);

  const resuming =
    options.dryRun !== true && (await isMallokProject(projectDir));
  if (
    options.dryRun !== true &&
    !resuming &&
    !(await isUsableTarget(projectDir))
  ) {
    throw new CliError(
      EXIT.user,
      `${options.directory} already exists and is not empty.`,
      'Pick a different directory name, or remove that one first.',
    );
  }

  // Read before anything is written: a corrupt ledger stops the run here,
  // while nothing has been done, rather than halfway through provisioning.
  const existing =
    options.dryRun === true ? null : await readLedger(projectDir);
  if (existing !== null && existing.slug !== slug) {
    throw new CliError(
      EXIT.user,
      `This directory was provisioned for the slug "${existing.slug}".`,
      `Run with --slug ${existing.slug}, or use a different directory.`,
    );
  }

  const names = resourceNames(slug);
  const configInput: SiteConfigInput = {
    slug,
    names,
    databaseId: existing?.database?.id ?? PLACEHOLDER_DATABASE_ID,
    domain,
    // The override wins; otherwise the value this project was already
    // deployed with wins; otherwise the derivation. Re-deriving on resume
    // would quietly move a site that used `--rate-limit-namespace` onto a
    // different limiter, and the fingerprint check would blame the domain.
    rateLimitNamespace:
      options.rateLimitNamespace === undefined
        ? (existing?.rateLimitNamespace ?? rateLimitNamespace(slug))
        : assertNamespace(options.rateLimitNamespace),
  };
  const fingerprint = configFingerprint(configInput);
  if (existing !== null && existing.fingerprint !== fingerprint) {
    throw new CliError(
      EXIT.user,
      'This run would deploy a different configuration from the one that ' +
        'created this project’s resources.',
      `The ledger was written for domain ${existing.domain ?? '(none)'} and ` +
        `slug ${existing.slug}. Match those, or run \`mallok destroy\` first.`,
    );
  }

  try {
    // ---- 2. Generate ----------------------------------------------------
    if (resuming) {
      // Nothing is regenerated: the files may have been edited, and
      // overwriting a user's project to finish provisioning it would be a
      // strange way to be helpful.
      report.step(`Resuming ${options.directory}…`);
    } else {
      report.step(`Creating ${options.directory}…`);
      await generateProject({
        target: projectDir,
        name: slug,
        ...(options.templateDir === undefined
          ? {}
          : { templateDir: options.templateDir }),
      });
    }

    // ---- 3. The configuration that will actually be deployed ------------
    //
    // Written *before* the dry-run, so the dry-run checks the real thing:
    // the final Worker name, the real bucket, the rate-limit namespace, the
    // custom domain. Only the database id is a placeholder, because that id
    // cannot exist before the database does.
    report.step('Writing wrangler.jsonc…');
    await writeSiteConfig(projectDir, configInput);

    // ---- 4. Prove it builds ---------------------------------------------
    await assertNpmProject(projectDir);
    const hasLockfile = await exists(join(projectDir, LOCKFILE));
    for (const step of preflightSteps(projectDir, hasLockfile)) {
      report.step(`${step.label}…`);
      const result = await runner(step.command, step.args, { cwd: projectDir });
      if (result.code !== 0) {
        throw new CliError(
          EXIT.user,
          `${step.label} failed.`,
          lastLine(result.stderr, result.stdout),
        );
      }
    }
    if (!(await exists(join(projectDir, LOCKFILE)))) {
      throw new CliError(
        EXIT.user,
        `The install did not produce a ${LOCKFILE}.`,
        'A project with no lockfile cannot be rebuilt from what it records.',
      );
    }

    if (options.dryRun === true) {
      report.step('Dry run: the project builds and would deploy cleanly.');
      report.step('Nothing was created on Cloudflare and no files were kept.');
      return {
        projectDir,
        slug,
        origin: null,
        deployed: false,
        ledger: null,
        alreadyComplete: false,
      };
    }

    if (options.noDeploy === true) {
      report.step(`${options.directory} is ready.`);
      report.step('Nothing was created on Cloudflare (--no-deploy).');
      report.step(
        `Next: cd ${options.directory} && npx mallok create . --slug ${slug}`,
      );
      return {
        projectDir,
        slug,
        origin: null,
        deployed: false,
        ledger: null,
        alreadyComplete: false,
      };
    }

    // ---- 5. Only now may anything on Cloudflare change ------------------
    if (options.deliverSetupKey === undefined) {
      // This is still before the first Cloudflare mutation. Checking inside
      // the delivery function would be too late: the secret would already
      // have been rotated and there would be no safe place to reveal it.
      assertInteractiveSecretDelivery(process.stdout);
    }
    return await provision(
      {
        projectDir,
        slug,
        domain,
        names,
        fingerprint,
        configInput,
        runner,
        accountId: options.accountId,
        hasAdministrator: options.hasAdministrator ?? siteHasAdministrator,
        deliverSetupKey: options.deliverSetupKey ?? printSetupKey,
      },
      existing,
      report,
    );
  } finally {
    if (options.dryRun === true) {
      await rm(projectDir, { recursive: true, force: true });
    }
  }
}

interface ProvisionInput {
  readonly projectDir: string;
  readonly slug: string;
  readonly domain: string | null;
  readonly accountId?: string | undefined;
  readonly names: ReturnType<typeof resourceNames>;
  readonly fingerprint: string;
  readonly configInput: SiteConfigInput;
  readonly runner: CommandRunner;
  readonly hasAdministrator: (origin: string) => Promise<boolean | null>;
  readonly deliverSetupKey: (key: string) => Promise<void> | void;
}

/**
 * The irreversible half.
 *
 * Every remote step records itself before the next one starts, so a run
 * killed between two steps leaves a file saying exactly what exists.
 */
async function provision(
  input: ProvisionInput,
  existing: Ledger | null,
  report: Reporter,
): Promise<CreateResult> {
  const { projectDir, slug, names, runner } = input;
  if (!(await hasProjectWrangler(projectDir))) {
    throw new CliError(
      EXIT.user,
      'The project has no Wrangler binary.',
      'Run the install inside the project and try again.',
    );
  }
  // ---- Read-only: who am I, and what is already there? ------------------
  report.step('Checking you are signed in to Cloudflare…');
  const { wrangler, accountId, identity } = await verifiedWrangler(
    projectDir,
    runner,
    input.accountId,
  );
  if (
    identity.worker !== names.worker ||
    identity.database.name !== names.database ||
    identity.bucket.name !== names.bucket
  ) {
    throw new CliError(
      EXIT.user,
      'wrangler.jsonc targets different resources from this create run.',
      `Expected Worker ${names.worker}, database ${names.database} and bucket ` +
        `${names.bucket}; found ${identity.worker}, ${identity.database.name} ` +
        `and ${identity.bucket.name}. Nothing has been changed.`,
    );
  }
  if (existing !== null) {
    assertSameAccount(existing, accountId);
    assertLedgerResourceNames(existing, names);
  }

  if (existing !== null && isComplete(existing)) {
    // Nothing to do on Cloudflare, and saying so is the whole feature: a
    // second run used to redeploy and rotate MALLOK_SECRET, which signs every
    // user out and makes stored plugin keys unreadable.
    //
    // The registry is the exception. It is written last, so a run killed
    // between the final ledger write and it leaves a finished site that
    // `publish` and `destroy` cannot find. Repairing it is local, free and
    // exactly what a resumed run is for.
    const repaired = await ensureRegistered(projectDir, existing, accountId);
    report.step(
      repaired
        ? `${slug} is already provisioned; restored .mallok/sites.json.`
        : `${slug} is already provisioned; nothing to do.`,
    );
    return {
      projectDir,
      slug,
      origin: existing.origin ?? null,
      deployed: true,
      ledger: existing,
      alreadyComplete: true,
    };
  }

  report.step('Checking those names are free…');
  const [database, bucket, worker] = await Promise.all([
    findDatabase(wrangler, names.database),
    findBucket(wrangler, names.bucket),
    findWorker(wrangler, names.worker),
  ]);

  /*
   * Reconciling what exists with what the ledger says.
   *
   * A resource can exist for three reasons, and they need three answers:
   *
   * - the ledger says we created it — ours, carry on;
   * - the ledger says we were **about to** create it (`pending`) and it is
   *   there — the call took effect and the process died before the answer
   *   arrived, which is by far the most likely way a `pending` record and a
   *   live resource end up together on the same account. Ours, adopted;
   * - the ledger says nothing about it — somebody else's, and the run stops.
   *
   * The second case is what made an interrupted run unrecoverable: it created
   * a second database, or refused the slug for ever. The account is the same
   * (checked above), the name is the one this project derives from its own
   * slug, and for D1 the id Cloudflare reports is recorded, so a later run can
   * tell the adopted database from any other.
   */
  const adopted: string[] = [];
  const reconcile = (
    kind: string,
    name: string,
    found: { exists: boolean; id?: string },
    record: ResourceRecord | undefined,
  ): ResourceRecord | undefined => {
    if (!found.exists) {
      return record;
    }
    if (record?.status === 'created' || record?.status === 'adopted') {
      return record;
    }
    if (record?.status === 'pending') {
      // A pending record says this project was *about* to create something of
      // that name. It does not say the thing now sitting there is the thing
      // it created. On a shared account a same-named database belongs to
      // whoever made it, and adopting it means running migrations against
      // their data on the next boot.
      //
      // So this stops and prints both halves — what Cloudflare reports and
      // what the ledger believes — and leaves the decision to a person.
      throw new CliError(
        EXIT.user,
        `A ${kind} named ${name} exists on this account, and this project cannot prove it created it.`,
        `The ledger records the ${kind} as "pending": the last run was about ` +
          'to create it and did not record an answer. That is consistent ' +
          'with the call having succeeded — and equally consistent with ' +
          `something else already owning the name.\n` +
          `  on Cloudflare: ${name}${found.id === undefined ? '' : ` (${found.id})`}\n` +
          `  in the ledger:  ${kind} pending${record.id === undefined ? '' : `, id ${record.id}`}\n` +
          'Compare them, and if it is yours, adopt it explicitly:\n' +
          `  mallok repair ${slug} --adopt ${kind === 'Worker' ? 'worker' : kind}`,
      );
    }
    throw new CliError(
      EXIT.user,
      `A ${kind} named ${name} already exists on this account, and this project did not create it.`,
      'It may belong to another site: pointing this one at it would mean two ' +
        'sites sharing one. Choose another --slug, or delete that resource if ' +
        'it is genuinely unused.',
    );
  };

  // ---- Intent, written before the first mutation ------------------------
  let ledger: Ledger = existing ?? {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    accountId,
    directory: projectDir,
    slug,
    domain: input.domain,
    fingerprint: input.fingerprint,
    rateLimitNamespace: input.configInput.rateLimitNamespace,
    startedAt: new Date().toISOString(),
  };
  const reconciled = {
    database: reconcile('database', names.database, database, ledger.database),
    bucket: reconcile('bucket', names.bucket, bucket, ledger.bucket),
    worker: reconcile('Worker', names.worker, worker, ledger.worker),
  };
  for (const line of adopted) {
    report.step(`Adopting the ${line} this project already created.`);
  }
  ledger = {
    ...ledger,
    accountId,
    directory: projectDir,
    ...(reconciled.database === undefined
      ? {}
      : { database: reconciled.database }),
    ...(reconciled.bucket === undefined ? {} : { bucket: reconciled.bucket }),
    ...(reconciled.worker === undefined ? {} : { worker: reconciled.worker }),
  };
  await writeLedger(projectDir, ledger);

  // ---- D1 ----------------------------------------------------------------
  let databaseId = ledger.database?.id;
  if (
    (ledger.database?.status !== 'created' &&
      ledger.database?.status !== 'adopted') ||
    databaseId === undefined
  ) {
    report.step(`Creating database ${names.database}…`);
    ledger = {
      ...ledger,
      database: { status: 'pending', name: names.database },
    };
    await writeLedger(projectDir, ledger);
    const created = await wrangler.run(['d1', 'create', names.database]);
    if (created.code !== 0) {
      throw new CliError(
        EXIT.remote,
        'Could not create the database.',
        lastLine(created.stderr, created.stdout),
      );
    }
    databaseId = parseDatabaseId(`${created.stdout}\n${created.stderr}`) ?? '';
    if (databaseId === '') {
      // The database exists; ask Cloudflare what its id is rather than
      // leaving the ledger with a resource it cannot name.
      databaseId = (await findDatabase(wrangler, names.database)).id ?? '';
    }
    if (databaseId === '') {
      throw new CliError(
        EXIT.remote,
        'The database was created but its id could not be read.',
        `Find it with \`wrangler d1 info ${names.database}\` and put it in ` +
          `wrangler.jsonc and ${LEDGER_FILE}.`,
      );
    }
    ledger = {
      ...ledger,
      database: {
        status: 'created',
        name: names.database,
        id: databaseId,
        at: new Date().toISOString(),
      },
    };
    await writeLedger(projectDir, ledger);
  } else {
    report.step(`Database ${names.database} already created by this project.`);
  }

  // ---- R2 ----------------------------------------------------------------
  if (
    ledger.bucket?.status !== 'created' &&
    ledger.bucket?.status !== 'adopted'
  ) {
    report.step(`Creating bucket ${names.bucket}…`);
    ledger = { ...ledger, bucket: { status: 'pending', name: names.bucket } };
    await writeLedger(projectDir, ledger);
    const created = await wrangler.run([
      'r2',
      'bucket',
      'create',
      names.bucket,
    ]);
    if (created.code !== 0) {
      throw new CliError(
        EXIT.remote,
        'Could not create the bucket.',
        lastLine(created.stderr, created.stdout),
      );
    }
    ledger = {
      ...ledger,
      bucket: {
        status: 'created',
        name: names.bucket,
        at: new Date().toISOString(),
      },
    };
    await writeLedger(projectDir, ledger);
  } else {
    report.step(`Bucket ${names.bucket} already created by this project.`);
  }

  // ---- The real configuration --------------------------------------------
  report.step('Writing the database id into wrangler.jsonc…');
  await writeSiteConfig(projectDir, { ...input.configInput, databaseId });

  // ---- Deploy -------------------------------------------------------------
  //
  // A deploy is idempotent — it uploads the current bundle either way — so an
  // adopted Worker is redeployed rather than assumed correct. The bundle a
  // half-finished run uploaded may predate the database id that has since
  // been written into wrangler.jsonc.
  report.step('Deploying…');
  ledger = { ...ledger, worker: { status: 'pending', name: names.worker } };
  await writeLedger(projectDir, ledger);
  const deploy = await wrangler.run(['deploy']);
  if (deploy.code !== 0) {
    throw new CliError(
      EXIT.remote,
      'The deploy failed.',
      `The database and bucket exist and are recorded in ${LEDGER_FILE}. Fix ` +
        `the problem and run \`mallok create . --slug ${slug}\` again, or ` +
        `\`mallok destroy ${slug} --confirm ${slug}\` to remove them.`,
    );
  }
  const origin =
    input.domain !== null
      ? `https://${input.domain}`
      : (/https:\/\/[^\s]+\.workers\.dev/.exec(deploy.stdout)?.[0] ?? '');
  ledger = {
    ...ledger,
    worker: {
      status: 'created',
      name: names.worker,
      at: new Date().toISOString(),
    },
    origin,
  };
  await writeLedger(projectDir, ledger);

  // ---- Secrets ------------------------------------------------------------
  //
  // Reconciled by **name**, because that is all Cloudflare will tell us and
  // all that is needed. `secretNames` throws rather than returning an empty
  // list when it cannot read: an empty list means "this Worker has no
  // secrets", and acting on that when the truth is "the API did not answer"
  // sets a new MALLOK_SECRET, which signs every user out and makes stored
  // plugin keys unreadable.
  const present = new Set(await secretNames(wrangler, names.worker));
  const recorded = new Set(ledger.secrets ?? []);
  let setupKey: string | null = null;

  if (!present.has('MALLOK_SECRET')) {
    report.step('Setting MALLOK_SECRET…');
    await putSecret(wrangler, names.worker, 'MALLOK_SECRET', randomSecret());
  } else if (!recorded.has('MALLOK_SECRET')) {
    report.step('MALLOK_SECRET is already set; leaving it alone.');
  }
  recorded.add('MALLOK_SECRET');

  /*
   * The setup key, and the one case where rotating a secret is the fix.
   *
   * It is a one-time credential for the first-run wizard: without it, a
   * deployed but unclaimed site belongs to whoever reaches `/_mallok/setup`
   * first, and a fresh Worker's address is not a secret.
   *
   * A key the CLI set and never managed to print is a key **nobody has** —
   * the site cannot be set up and `create` has no way to recover it, because
   * Cloudflare never returns a secret's value. The ledger therefore records
   * not just that the secret exists but that its value was *delivered*, and a
   * resumed run that finds the first without the second rotates it. That is
   * safe exactly while no administrator exists, which is checked against the
   * site's own public setup endpoint rather than assumed.
   */
  if (!present.has('MALLOK_SETUP_KEY')) {
    setupKey = randomSecret();
    report.step('Setting MALLOK_SETUP_KEY…');
    await putSecret(wrangler, names.worker, 'MALLOK_SETUP_KEY', setupKey);
  } else if (ledger.setupKeyDeliveredAt === undefined) {
    const claimed = await input.hasAdministrator(origin);
    if (claimed === true) {
      report.step(
        'The site already has an administrator, so the setup key is spent.',
      );
    } else if (claimed === null) {
      // `null` is "could not tell", and it used to fall into the same branch
      // as "no administrator". Rotating there replaces a key that may be in
      // the hands of the site's actual owner, and hands the replacement to
      // whoever ran this — on the strength of a request that timed out.
      throw new CliError(
        EXIT.remote,
        `Could not ask ${origin === '' ? 'the site' : origin} whether it already has an administrator.`,
        'A setup key was set on a previous run and never shown, so it would ' +
          'have to be rotated — and rotating one on a site that may already ' +
          'be owned is a way in for whoever asks. Check the site is ' +
          'reachable and run this again; it resumes from here.',
      );
    } else {
      report.step(
        'A setup key was set but never shown, so it cannot be recovered. ' +
          'Rotating it…',
      );
      setupKey = randomSecret();
      await putSecret(wrangler, names.worker, 'MALLOK_SETUP_KEY', setupKey);
    }
  }
  recorded.add('MALLOK_SETUP_KEY');

  // ---- Hand the key over, and only then record that it was handed over ----
  //
  // The order here is the whole guarantee. `setupKeyDeliveredAt` is what stops
  // a resumed run rotating a key that somebody already holds, so recording it
  // before the value reaches a person turns an interrupted run into a
  // permanently unclaimable site: the secret exists, nobody knows it, and the
  // resume that exists to fix that sees a delivery already recorded.
  //
  // This used to write the ledger first and let the caller print afterwards.
  if (setupKey !== null) {
    await input.deliverSetupKey(setupKey);
  }

  ledger = {
    ...ledger,
    // Names only. This file is meant to be committed.
    secrets: [...recorded].sort(),
    setupKeyDeliveredAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  await writeLedger(projectDir, ledger);

  // ---- The registry, for the commands that come later ---------------------
  await ensureRegistered(projectDir, ledger, accountId);

  return {
    projectDir,
    slug,
    origin,
    deployed: true,
    ledger,
    alreadyComplete: false,
  };
}

/** Pipes a secret to wrangler. The value never becomes an argument. */
async function putSecret(
  wrangler: Wrangler,
  worker: string,
  name: string,
  value: string,
): Promise<void> {
  const put = await wrangler.run(['secret', 'put', name, '--name', worker], {
    input: value,
  });
  if (put.code !== 0) {
    throw new CliError(
      EXIT.remote,
      `The Worker deployed but ${name} could not be set.`,
      `Run \`wrangler secret put ${name}\` in the project before opening the site.`,
    );
  }
}

/**
 * Writes the site into the project's registry if it is not already there.
 *
 * Returns true when it had to repair something. The registry is what
 * `mallok publish` and `mallok destroy` read to find a site; the ledger is
 * what `create` reads to finish one. Both are derived from the same run, so
 * a missing registry entry is repairable from the ledger without asking
 * Cloudflare anything.
 */
async function ensureRegistered(
  projectDir: string,
  ledger: Ledger,
  accountId: string,
): Promise<boolean> {
  const registryPath = join(projectDir, '.mallok/sites.json');
  const sites = await readRegistry(registryPath);
  const existing = sites.find((site) => site.slug === ledger.slug);
  if (existing !== undefined && existing.accountId === accountId) {
    return false;
  }
  await writeRegistry(
    upsertSite(sites, {
      slug: ledger.slug,
      origin: ledger.origin ?? '',
      domain: ledger.domain,
      accountId,
      databaseId: ledger.database?.id ?? null,
      bucket: ledger.bucket?.name ?? '',
      // The value the Worker was deployed with, not a fresh derivation: a
      // site created with `--rate-limit-namespace` has a number no
      // derivation would produce.
      ratelimitNs: Number(
        ledger.rateLimitNamespace ?? rateLimitNamespace(ledger.slug),
      ),
      createdAt: ledger.completedAt ?? new Date().toISOString(),
    }),
    registryPath,
  );
  return existing === undefined;
}

/** The default hand-over: stdout, awaited (`deliver.ts`). */
async function printSetupKey(key: string): Promise<void> {
  assertInteractiveSecretDelivery(process.stdout);
  await deliverSecret(process.stdout, 'MALLOK_SETUP_KEY', key);
}

/**
 * Whether the site already has an administrator.
 *
 * Read from the site's own public setup endpoint, which exists to answer
 * exactly this. `null` when the question cannot be answered — in which case
 * the caller must not treat "unknown" as "no".
 */
async function siteHasAdministrator(origin: string): Promise<boolean | null> {
  if (origin === '') {
    return null;
  }
  try {
    const response = await fetch(`${origin}/_mallok/api/setup/status`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      return null;
    }
    const status = (await response.json()) as { hasAdmin?: boolean };
    return typeof status.hasAdmin === 'boolean' ? status.hasAdmin : null;
  } catch {
    return null;
  }
}

/** 32 random bytes, base64. Generated, used once, never written to disk. */
function randomSecret(): string {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString(
    'base64',
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function temporaryDirectory(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  return await mkdtemp(join(tmpdir(), 'mallok-create-'));
}
