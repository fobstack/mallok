/**
 * `mallok create` — generate a project, prove it builds, then provision.
 *
 * The order is the whole design, and it is the opposite of what this command
 * used to do. It used to sign in, create a D1 database, create an R2 bucket,
 * write a config, and only then attempt a deploy — so a project that could not
 * build left two real resources behind on the user's account, named after a
 * site that did not exist, with nothing recording them. The second run then
 * refused the slug it had itself half-provisioned.
 *
 * Now **nothing on Cloudflare is touched until the project has been generated,
 * installed, built and passed `wrangler deploy --dry-run` locally.** The
 * expensive, irreversible half runs only after the free, reversible half has
 * proved the artifact is deployable.
 *
 * The other half of the fix is a ledger: every resource this command creates
 * is written to `.mallok/create-state.json` **before** the next step runs, so
 * an interrupted run can be resumed or cleaned up. It records names, never
 * secrets.
 */

import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { CliError, EXIT, type Reporter } from './output.js';
import {
  nextNamespace,
  readRegistry,
  resourceNames,
  upsertSite,
  validateSlug,
  writeRegistry,
} from './registry.js';
import {
  generateProject,
  hasProjectWrangler,
  isMallokProject,
  isUsableTarget,
  projectWrangler,
  verifyTemplate,
} from './template.js';

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
  options: { cwd: string; input?: string },
) => Promise<RunResult>;

export const spawnRunner: CommandRunner = (command, args, options) =>
  new Promise((done) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
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

/** What has been provisioned so far. Names only — never a secret. */
export interface CreateState {
  readonly slug: string;
  readonly startedAt: string;
  databaseName?: string;
  databaseId?: string;
  bucketName?: string;
  deployedAt?: string;
  secretSetAt?: string;
  origin?: string;
}

const STATE_FILE = '.mallok/create-state.json';

export function statePath(projectDir: string): string {
  return join(projectDir, STATE_FILE);
}

export async function readState(
  projectDir: string,
): Promise<CreateState | null> {
  try {
    return JSON.parse(
      await readFile(statePath(projectDir), 'utf8'),
    ) as CreateState;
  } catch {
    return null;
  }
}

/** Written after each step, so an interruption is recoverable rather than lost. */
export async function writeState(
  projectDir: string,
  state: CreateState,
): Promise<void> {
  const path = statePath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

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
  readonly cwd?: string;
  readonly run?: CommandRunner;
  readonly templateDir?: string;
}

/** A slug derived from a directory name, or a clear reason it cannot be. */
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

export function preflightSteps(projectDir: string): PreflightStep[] {
  return [
    {
      label: 'Installing dependencies (frozen lockfile)',
      command: 'pnpm',
      args: ['install', '--frozen-lockfile'],
    },
    {
      label: 'Building',
      command: 'pnpm',
      args: ['run', 'build'],
    },
    {
      // The project's own Wrangler, at the version its lockfile pinned.
      label: 'Checking the deploy would succeed',
      command: projectWrangler(projectDir),
      args: ['deploy', '--dry-run', '--outdir', 'dist/worker-preflight'],
    },
  ];
}

export interface CreateResult {
  readonly projectDir: string;
  readonly slug: string;
  readonly origin: string | null;
  readonly deployed: boolean;
  readonly state: CreateState | null;
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
  const run = options.run ?? spawnRunner;
  const cwd = options.cwd ?? process.cwd();
  const slug = options.slug ?? slugFromDirectory(options.directory);

  // ---- 1. Checks that cost nothing --------------------------------------
  const slugError = validateSlug(slug);
  if (slugError !== null) {
    throw new CliError(
      EXIT.user,
      slugError,
      'Pass --slug to choose one that differs from the directory name.',
    );
  }
  await verifyTemplate(options.templateDir);

  const projectDir =
    options.dryRun === true
      ? await temporaryDirectory()
      : resolve(cwd, options.directory);

  /*
   * A second run in a directory this command already generated is a
   * **resume**, not a collision.
   *
   * It is the documented way to finish a run that stopped — after
   * `--no-deploy`, or after a deploy failed with the database and bucket
   * already created (`docs/CLOUDFLARE_RESOURCES.md §6`). Refusing it left the
   * ledger with no way to be acted on: the state file said what existed and
   * the only command that could use it would not start.
   *
   * A directory with anything *else* in it is still refused.
   */
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

  try {
    // ---- 2. Generate ----------------------------------------------------
    if (resuming) {
      // Nothing is regenerated: the files there may have been edited, and
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

    // ---- 3. Prove it builds --------------------------------------------
    for (const step of preflightSteps(projectDir)) {
      report.step(`${step.label}…`);
      const result = await run(step.command, step.args, { cwd: projectDir });
      if (result.code !== 0) {
        throw new CliError(
          EXIT.user,
          `${step.label} failed.`,
          lastLine(result.stderr, result.stdout),
        );
      }
    }

    if (options.dryRun === true) {
      report.step('Dry run: the project builds and would deploy cleanly.');
      report.step('Nothing was created on Cloudflare and no files were kept.');
      return {
        projectDir,
        slug,
        origin: null,
        deployed: false,
        state: null,
      };
    }

    if (options.noDeploy === true) {
      report.step(`${options.directory} is ready.`);
      report.step('Nothing was created on Cloudflare (--no-deploy).');
      report.step(
        `Next: cd ${options.directory} && npx mallok create . --slug ${slug}`,
      );
      return { projectDir, slug, origin: null, deployed: false, state: null };
    }

    // ---- 4. Only now may anything on Cloudflare change ------------------
    const origin = await provision(
      { projectDir, slug, domain: options.domain ?? null, run },
      report,
    );
    return {
      projectDir,
      slug,
      origin,
      deployed: true,
      state: await readState(projectDir),
    };
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
  readonly run: CommandRunner;
}

/**
 * The irreversible half.
 *
 * Every remote step records itself before the next one starts. A run killed
 * between two steps leaves a file saying exactly what exists.
 */
async function provision(
  input: ProvisionInput,
  report: Reporter,
): Promise<string> {
  const { projectDir, slug, run } = input;
  const names = resourceNames(slug);
  const wrangler = projectWrangler(projectDir);
  if (!(await hasProjectWrangler(projectDir))) {
    throw new CliError(
      EXIT.user,
      'The project has no Wrangler binary.',
      'Run `pnpm install` inside the project and try again.',
    );
  }

  let state: CreateState = (await readState(projectDir)) ?? {
    slug,
    startedAt: new Date().toISOString(),
  };
  if (state.slug !== slug) {
    throw new CliError(
      EXIT.user,
      `This directory was created for the slug "${state.slug}".`,
      `Run with --slug ${state.slug}, or remove ${STATE_FILE} if you know it is stale.`,
    );
  }

  report.step('Checking you are signed in to Cloudflare…');
  const who = await run(wrangler, ['whoami'], { cwd: projectDir });
  if (who.code !== 0) {
    throw new CliError(
      EXIT.auth,
      'Not signed in to Cloudflare.',
      'Run `npx wrangler login` and try again.',
    );
  }

  if (state.databaseId === undefined) {
    report.step(`Creating database ${names.database}…`);
    const created = await run(wrangler, ['d1', 'create', names.database], {
      cwd: projectDir,
    });
    if (created.code !== 0) {
      // A name that already exists but is not in our ledger belongs to someone
      // else's site. Adopting it would point this project at a database with
      // another site's content in it.
      if (/already exists/i.test(`${created.stdout}${created.stderr}`)) {
        throw new CliError(
          EXIT.user,
          `A database named ${names.database} already exists and was not created by this run.`,
          'Choose another --slug, or delete that database if it is genuinely unused.',
        );
      }
      throw new CliError(
        EXIT.remote,
        'Could not create the database.',
        lastLine(created.stderr),
      );
    }
    const id = parseDatabaseId(`${created.stdout}\n${created.stderr}`);
    if (id === null) {
      throw new CliError(
        EXIT.remote,
        'The database was created but its id could not be read.',
        `Find it with \`wrangler d1 info ${names.database}\` and add it to wrangler.jsonc.`,
      );
    }
    state = { ...state, databaseName: names.database, databaseId: id };
    await writeState(projectDir, state);
  } else {
    report.step(`Database ${names.database} already created by this run.`);
  }

  if (state.bucketName === undefined) {
    report.step(`Creating bucket ${names.bucket}…`);
    const bucket = await run(
      wrangler,
      ['r2', 'bucket', 'create', names.bucket],
      { cwd: projectDir },
    );
    if (bucket.code !== 0) {
      if (/already exists/i.test(`${bucket.stdout}${bucket.stderr}`)) {
        throw new CliError(
          EXIT.user,
          `A bucket named ${names.bucket} already exists and was not created by this run.`,
          'Choose another --slug, or delete that bucket if it is genuinely unused.',
        );
      }
      throw new CliError(
        EXIT.remote,
        'Could not create the bucket.',
        lastLine(bucket.stderr),
      );
    }
    state = { ...state, bucketName: names.bucket };
    await writeState(projectDir, state);
  } else {
    report.step(`Bucket ${names.bucket} already created by this run.`);
  }

  report.step('Writing wrangler.jsonc…');
  await applyResourceIds(projectDir, {
    worker: names.worker,
    database: names.database,
    databaseId: state.databaseId ?? '',
    bucket: names.bucket,
    domain: input.domain,
  });

  report.step('Deploying…');
  const deploy = await run(wrangler, ['deploy'], { cwd: projectDir });
  if (deploy.code !== 0) {
    throw new CliError(
      EXIT.remote,
      'The deploy failed.',
      `The database and bucket exist and are recorded in ${STATE_FILE}. Fix the problem and run \`mallok create . --slug ${slug}\` again, or \`mallok destroy ${slug}\` to remove them.`,
    );
  }
  const origin =
    input.domain !== null
      ? `https://${input.domain}`
      : (/https:\/\/[^\s]+\.workers\.dev/.exec(deploy.stdout)?.[0] ?? '');
  state = { ...state, deployedAt: new Date().toISOString(), origin };
  await writeState(projectDir, state);

  report.step('Setting MALLOK_SECRET…');
  // Generated here and piped straight in: never written to a file, never
  // printed, and never recorded in the ledger.
  const secret = Buffer.from(
    webcrypto.getRandomValues(new Uint8Array(32)),
  ).toString('base64');
  const put = await run(wrangler, ['secret', 'put', 'MALLOK_SECRET'], {
    cwd: projectDir,
    input: secret,
  });
  if (put.code !== 0) {
    throw new CliError(
      EXIT.remote,
      'The Worker deployed but MALLOK_SECRET could not be set.',
      'Run `npx wrangler secret put MALLOK_SECRET` in the project before opening the site.',
    );
  }
  await writeState(projectDir, {
    ...state,
    secretSetAt: new Date().toISOString(),
  });

  // The registry is what `mallok publish` and `mallok destroy` read to find
  // this site later. It lives inside the project, holds names and an origin,
  // and never a secret (docs/CLOUDFLARE_RESOURCES.md §9).
  const registryPath = join(projectDir, '.mallok/sites.json');
  const sites = await readRegistry(registryPath);
  await writeRegistry(
    upsertSite(sites, {
      slug,
      origin,
      domain: input.domain,
      accountId: null,
      databaseId: state.databaseId ?? null,
      bucket: names.bucket,
      ratelimitNs: nextNamespace(sites),
      createdAt: new Date().toISOString(),
    }),
    registryPath,
  );
  return origin;
}

/** Pulls a `database_id` out of `wrangler d1 create` output. */
export function parseDatabaseId(output: string): string | null {
  return (
    /"?database_id"?\s*[:=]\s*"?([0-9a-f-]{36})"?/i.exec(output)?.[1] ?? null
  );
}

interface ResourceIds {
  readonly worker: string;
  readonly database: string;
  readonly databaseId: string;
  readonly bucket: string;
  readonly domain: string | null;
}

/**
 * Points the generated project's own `wrangler.jsonc` at the real resources.
 *
 * Edited in place rather than written into a nested `.mallok/sites/<slug>.jsonc`
 * as before: a nested config has to rewrite every relative path in the file,
 * which is exactly the bug Gate A found. The project has one config, and it is
 * the one `wrangler deploy` reads with no `-c` flag.
 */
export async function applyResourceIds(
  projectDir: string,
  ids: ResourceIds,
): Promise<void> {
  const path = join(projectDir, 'wrangler.jsonc');
  const base = await readFile(path, 'utf8');
  let config = base
    .replace(/"name":\s*"[^"]*"/, `"name": "${ids.worker}"`)
    .replace(/"database_name":\s*"[^"]*"/, `"database_name": "${ids.database}"`)
    .replace(/"database_id":\s*"[^"]*"/, `"database_id": "${ids.databaseId}"`)
    .replace(/"bucket_name":\s*"[^"]*"/, `"bucket_name": "${ids.bucket}"`);
  if (ids.domain !== null) {
    config = config.replace(
      /"compatibility_date"/,
      `"routes": [{ "pattern": "${ids.domain}", "custom_domain": true }],\n  "compatibility_date"`,
    );
  }
  await writeFile(path, config, 'utf8');
}

async function temporaryDirectory(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  return await mkdtemp(join(tmpdir(), 'mallok-create-'));
}

/**
 * The line most likely to explain a failure.
 *
 * Not simply the last line: build tools end with warnings and summaries, so
 * the last line of a failed `pnpm build` was
 * "Adjust chunk size limit for this warning" while the actual cause —
 * a missing script — sat further up. A line that looks like an error is
 * preferred, and the last non-empty line is the fallback.
 */
function lastLine(...streams: string[]): string {
  const looksLikeError =
    /\b(error|ERR_[A-Z_]+|failed|not found|cannot|missing)\b/i;
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
