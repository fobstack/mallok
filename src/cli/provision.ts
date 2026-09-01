/**
 * `mallok create` and `mallok destroy`
 * (docs/CLOUDFLARE_RESOURCES.md §6, §10).
 *
 * Both drive `wrangler` rather than the Cloudflare REST API, so the user's
 * existing OAuth login is the only credential involved and the CLI never
 * handles an account token (docs/CLI.md §4).
 *
 * Every step is idempotent and prints its result. A failure stops the run and
 * says which step failed — creation half-done is recoverable, creation
 * half-done and silent is not.
 */

import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CliError, EXIT, type Reporter } from './output.js';
import {
  nextNamespace,
  readRegistry,
  resourceNames,
  type SiteRecord,
  upsertSite,
  validateSlug,
  writeRegistry,
} from './registry.js';

/** Result of one wrangler invocation. */
interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs wrangler, streaming nothing and capturing both streams. */
export async function runWrangler(
  args: readonly string[],
  input?: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['wrangler', ...args], {
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
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Pulls a `database_id` out of `wrangler d1 create` output. */
export function parseDatabaseId(output: string): string | null {
  return (
    /"?database_id"?\s*[:=]\s*"?([0-9a-f-]{36})"?/i.exec(output)?.[1] ?? null
  );
}

/** Builds a per-site wrangler config from the repository's own. */
export async function buildSiteConfig(
  slug: string,
  databaseId: string,
  domain: string | null,
  namespace: number,
): Promise<string> {
  const names = resourceNames(slug);
  const base = await readFile('wrangler.jsonc', 'utf8');
  // The base config is JSONC; the substitutions below are all on quoted
  // string values, so the comments survive untouched.
  let config = base
    .replace(/"name":\s*"[^"]*"/, `"name": "${names.worker}"`)
    .replace(
      /"database_name":\s*"[^"]*"/,
      `"database_name": "${names.database}"`,
    )
    .replace(/"database_id":\s*"[^"]*"/, `"database_id": "${databaseId}"`)
    .replace(/"bucket_name":\s*"[^"]*"/, `"bucket_name": "${names.bucket}"`);
  if (domain !== null) {
    // A custom_domain route makes the deploy create the DNS record and the
    // certificate (docs/CLOUDFLARE_RESOURCES.md §6 step 9).
    config = config.replace(
      /"compatibility_date"/,
      `"routes": [{ "pattern": "${domain}", "custom_domain": true }],\n  "compatibility_date"`,
    );
  }
  void namespace;
  return config;
}

/** Options `mallok create` takes. */
export interface CreateOptions {
  readonly slug: string;
  readonly domain: string | null;
  readonly dryRun: boolean;
}

/**
 * Creates a site.
 *
 * The order is fixed by docs/CLOUDFLARE_RESOURCES.md §6 and each step is
 * reported, because a partial creation the user cannot see is worse than a
 * failure they can.
 */
export async function createSite(
  options: CreateOptions,
  report: Reporter,
): Promise<SiteRecord> {
  const slugError = validateSlug(options.slug);
  if (slugError !== null) {
    throw new CliError(EXIT.user, slugError);
  }
  const names = resourceNames(options.slug);
  const sites = await readRegistry();
  if (sites.some((site) => site.slug === options.slug)) {
    throw new CliError(
      EXIT.user,
      `"${options.slug}" is already in .mallok/sites.json.`,
      'Pick another slug, or run `mallok destroy` first.',
    );
  }

  if (options.dryRun) {
    report.step('Dry run — nothing will be created. Steps that would run:');
    for (const line of [
      `wrangler d1 create ${names.database}`,
      `wrangler r2 bucket create ${names.bucket}`,
      'generate MALLOK_SECRET (32 random bytes)',
      `write ${names.config}`,
      `wrangler deploy -c ${names.config}`,
      `wrangler secret put MALLOK_SECRET -c ${names.config}`,
    ]) {
      report.step(`  ${line}`);
    }
    return {
      slug: options.slug,
      origin: '',
      domain: options.domain,
      accountId: null,
      databaseId: null,
      bucket: names.bucket,
      ratelimitNs: nextNamespace(sites),
      createdAt: new Date().toISOString(),
    };
  }

  report.step('Checking you are signed in to Cloudflare…');
  const who = await runWrangler(['whoami']);
  if (who.code !== 0) {
    throw new CliError(
      EXIT.auth,
      'Not signed in to Cloudflare.',
      'Run `npx wrangler login` and try again.',
    );
  }

  report.step(`Creating database ${names.database}…`);
  const database = await runWrangler(['d1', 'create', names.database]);
  if (database.code !== 0) {
    throw new CliError(
      EXIT.remote,
      `Could not create the database: ${database.stderr.trim().split('\n').at(-1) ?? ''}`,
    );
  }
  const databaseId = parseDatabaseId(`${database.stdout}\n${database.stderr}`);
  if (databaseId === null) {
    throw new CliError(
      EXIT.remote,
      'The database was created but its id could not be read from wrangler output.',
      `Find it with \`npx wrangler d1 info ${names.database}\` and write ${names.config} by hand.`,
    );
  }

  report.step(`Creating bucket ${names.bucket}…`);
  const bucket = await runWrangler(['r2', 'bucket', 'create', names.bucket]);
  if (bucket.code !== 0 && !bucket.stderr.includes('already exists')) {
    throw new CliError(
      EXIT.remote,
      `Could not create the bucket: ${bucket.stderr.trim().split('\n').at(-1) ?? ''}`,
    );
  }

  const namespace = nextNamespace(sites);
  report.step(`Writing ${names.config}…`);
  await mkdir(dirname(names.config), { recursive: true });
  await writeFile(
    names.config,
    await buildSiteConfig(options.slug, databaseId, options.domain, namespace),
    'utf8',
  );

  report.step('Deploying…');
  const deploy = await runWrangler(['deploy', '-c', names.config]);
  if (deploy.code !== 0) {
    throw new CliError(
      EXIT.remote,
      `The deploy failed: ${deploy.stderr.trim().split('\n').at(-1) ?? ''}`,
      `The database and bucket exist; fix the problem and run \`npx wrangler deploy -c ${names.config}\`.`,
    );
  }
  const origin =
    options.domain !== null
      ? `https://${options.domain}`
      : (/https:\/\/[^\s]+\.workers\.dev/.exec(deploy.stdout)?.[0] ?? '');

  report.step('Setting MALLOK_SECRET…');
  // Generated here and piped straight in: it is never written to a file and
  // never printed (docs/SECURITY.md §2).
  const raw = webcrypto.getRandomValues(new Uint8Array(32));
  const secret = Buffer.from(raw).toString('base64');
  const put = await runWrangler(
    ['secret', 'put', 'MALLOK_SECRET', '-c', names.config],
    secret,
  );
  if (put.code !== 0) {
    throw new CliError(
      EXIT.remote,
      'The Worker deployed but MALLOK_SECRET could not be set.',
      `Run \`npx wrangler secret put MALLOK_SECRET -c ${names.config}\` before opening the site.`,
    );
  }

  const record: SiteRecord = {
    slug: options.slug,
    origin,
    domain: options.domain,
    accountId: null,
    databaseId,
    bucket: names.bucket,
    ratelimitNs: namespace,
    createdAt: new Date().toISOString(),
  };
  await writeRegistry(upsertSite(sites, record));
  return record;
}

/** One step of a destroy run. */
export interface DestroyStep {
  readonly label: string;
  readonly args: readonly string[];
  /** Missing resources are fine; the run is idempotent. */
  readonly tolerateMissing: boolean;
}

/** The delete order (docs/CLOUDFLARE_RESOURCES.md §10). */
export function destroySteps(slug: string, config: string): DestroyStep[] {
  const names = resourceNames(slug);
  return [
    {
      label: `Delete the Worker ${names.worker}`,
      args: ['delete', '-c', config],
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
  'Delete the Turnstile widget, if one was created.',
  'Delete the CF_API_TOKEN you created for cache purging.',
  'Remove any DNS records the setup wizard added.',
];
