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
  currentAccountId,
  findBucket,
  findDatabase,
  findWorker,
  lastLine,
  secretNames,
  type Wrangler,
  wranglerFor,
} from './cloudflare.js';
import {
  assertSameAccount,
  isComplete,
  LEDGER_FILE,
  LEDGER_SCHEMA_VERSION,
  type Ledger,
  readLedger,
  writeLedger,
} from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import {
  frozenInstallArgs,
  installArgs,
  LOCKFILES,
  type PackageManager,
  runArgs,
} from './package-manager.js';
import { readRegistry, upsertSite, writeRegistry } from './registry.js';
import {
  configFingerprint,
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
  readonly packageManager?: PackageManager;
  readonly cwd?: string;
  readonly run?: CommandRunner;
  readonly templateDir?: string;
}

export interface CreateResult {
  readonly projectDir: string;
  readonly slug: string;
  readonly origin: string | null;
  readonly deployed: boolean;
  /** Printed once, never stored: the wizard needs it to create the admin. */
  readonly setupKey: string | null;
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
  manager: PackageManager,
  hasLockfile: boolean,
): PreflightStep[] {
  return [
    {
      label: hasLockfile
        ? 'Installing dependencies (from the lockfile)'
        : 'Installing dependencies',
      command: manager,
      args: hasLockfile ? frozenInstallArgs(manager) : installArgs(manager),
    },
    {
      label: 'Building',
      command: manager,
      args: runArgs(manager, 'build'),
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
  const manager = options.packageManager ?? 'npm';
  const slug = options.slug ?? slugFromDirectory(options.directory);
  const domain = options.domain ?? null;

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
    rateLimitNamespace: rateLimitNamespace(slug),
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
    const hasLockfile = await exists(join(projectDir, LOCKFILES[manager]));
    for (const step of preflightSteps(projectDir, manager, hasLockfile)) {
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
    if (!(await exists(join(projectDir, LOCKFILES[manager])))) {
      throw new CliError(
        EXIT.user,
        `The install did not produce a ${LOCKFILES[manager]}.`,
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
        setupKey: null,
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
        setupKey: null,
        ledger: null,
        alreadyComplete: false,
      };
    }

    // ---- 5. Only now may anything on Cloudflare change ------------------
    return await provision(
      { projectDir, slug, domain, names, fingerprint, configInput, runner },
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
  readonly names: ReturnType<typeof resourceNames>;
  readonly fingerprint: string;
  readonly configInput: SiteConfigInput;
  readonly runner: CommandRunner;
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
  const wrangler = wranglerFor(projectDir, runner);

  // ---- Read-only: who am I, and what is already there? ------------------
  report.step('Checking you are signed in to Cloudflare…');
  const accountId = await currentAccountId(wrangler);
  if (existing !== null) {
    assertSameAccount(existing, accountId);
  }

  if (existing !== null && isComplete(existing)) {
    // Nothing to do, and saying so is the whole feature: a second run used to
    // redeploy and rotate MALLOK_SECRET, which signs every user out and makes
    // stored plugin keys unreadable.
    report.step(`${slug} is already provisioned; nothing to do.`);
    return {
      projectDir,
      slug,
      origin: existing.origin ?? null,
      deployed: true,
      setupKey: null,
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
  refuseUnknown(
    'database',
    names.database,
    database.exists,
    existing?.database,
  );
  refuseUnknown('bucket', names.bucket, bucket.exists, existing?.bucket);
  refuseUnknown('Worker', names.worker, worker.exists, existing?.worker);

  // ---- Intent, written before the first mutation ------------------------
  let ledger: Ledger = existing ?? {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    accountId,
    directory: projectDir,
    slug,
    domain: input.domain,
    fingerprint: input.fingerprint,
    startedAt: new Date().toISOString(),
  };
  ledger = { ...ledger, accountId, directory: projectDir };
  await writeLedger(projectDir, ledger);

  // ---- D1 ----------------------------------------------------------------
  let databaseId = ledger.database?.id;
  if (ledger.database?.status !== 'created' || databaseId === undefined) {
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
  if (ledger.bucket?.status !== 'created') {
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
  // Reconciled by **name**. An interrupted run may have set a secret without
  // recording it; generating a new value to be safe would sign every user out
  // and make stored plugin keys unreadable. Cloudflare will say whether a
  // secret of that name exists, and that is enough.
  const present = new Set(await secretNames(wrangler, names.worker));
  const recorded = new Set(ledger.secrets ?? []);
  let setupKey: string | null = null;

  if (!present.has('MALLOK_SECRET')) {
    report.step('Setting MALLOK_SECRET…');
    await putSecret(wrangler, 'MALLOK_SECRET', randomSecret());
  } else if (!recorded.has('MALLOK_SECRET')) {
    report.step('MALLOK_SECRET is already set; leaving it alone.');
  }
  recorded.add('MALLOK_SECRET');

  if (!present.has('MALLOK_SETUP_KEY')) {
    // A one-time credential for the first-run wizard. Without it, a deployed
    // but un-set-up site can be claimed by whoever reaches `/_mallok/setup`
    // first — and a fresh Worker's address is not a secret.
    setupKey = randomSecret();
    report.step('Setting MALLOK_SETUP_KEY…');
    await putSecret(wrangler, 'MALLOK_SETUP_KEY', setupKey);
  }
  recorded.add('MALLOK_SETUP_KEY');

  ledger = {
    ...ledger,
    // Names only. This file is meant to be committed.
    secrets: [...recorded].sort(),
    completedAt: new Date().toISOString(),
  };
  await writeLedger(projectDir, ledger);

  // ---- The registry, for the commands that come later ---------------------
  const registryPath = join(projectDir, '.mallok/sites.json');
  const sites = await readRegistry(registryPath);
  await writeRegistry(
    upsertSite(sites, {
      slug,
      origin,
      domain: input.domain,
      accountId,
      databaseId,
      bucket: names.bucket,
      ratelimitNs: Number(input.configInput.rateLimitNamespace),
      createdAt: new Date().toISOString(),
    }),
    registryPath,
  );

  return {
    projectDir,
    slug,
    origin,
    deployed: true,
    setupKey,
    ledger,
    alreadyComplete: false,
  };
}

/** Refuses to build on a resource this project did not create. */
function refuseUnknown(
  kind: string,
  name: string,
  exists: boolean,
  record: { status: string } | undefined,
): void {
  if (!exists) {
    return;
  }
  if (record?.status === 'created' || record?.status === 'adopted') {
    return;
  }
  throw new CliError(
    EXIT.user,
    `A ${kind} named ${name} already exists on this account, and this project did not create it.`,
    'It may belong to another site: pointing this one at it would mean two ' +
      'sites sharing one. Choose another --slug, or delete that resource if ' +
      'it is genuinely unused.',
  );
}

/** Pipes a secret to wrangler. The value never becomes an argument. */
async function putSecret(
  wrangler: Wrangler,
  name: string,
  value: string,
): Promise<void> {
  const put = await wrangler.run(['secret', 'put', name], { input: value });
  if (put.code !== 0) {
    throw new CliError(
      EXIT.remote,
      `The Worker deployed but ${name} could not be set.`,
      `Run \`wrangler secret put ${name}\` in the project before opening the site.`,
    );
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
