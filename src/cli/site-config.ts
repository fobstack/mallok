/**
 * A site's final Wrangler configuration: producing it, checking it, and
 * identifying it.
 *
 * The order this enables is the one thing `mallok create` most needed and did
 * not have: **the configuration that will be deployed is written and verified
 * before anything on Cloudflare is created.** It used to create a database and
 * a bucket, write their ids into the config, and only then find out whether
 * the result was a valid configuration at all.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError, EXIT } from './output.js';

/** Names derived from a slug (docs/CLOUDFLARE_RESOURCES.md §3). */
export interface ResourceNames {
  readonly worker: string;
  readonly database: string;
  readonly bucket: string;
}

/** Everything that goes into a site's final configuration. */
export interface SiteConfigInput {
  readonly slug: string;
  readonly names: ResourceNames;
  /** Empty until the database exists; the dry-run uses a placeholder. */
  readonly databaseId: string;
  readonly domain: string | null;
  /** Rate-limit namespace, unique per site within the account. */
  readonly rateLimitNamespace: string;
}

/**
 * The id used while checking a configuration that has no database yet.
 *
 * A real uuid shape, because `wrangler deploy --dry-run` validates the field:
 * a placeholder like `TBD` would fail the check for a reason that has nothing
 * to do with the site.
 */
export const PLACEHOLDER_DATABASE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * A stable rate-limit namespace for a slug.
 *
 * Cloudflare requires the id to be unique per account, and the template ships
 * `1000` for every site — so two Mallok sites on one account silently shared a
 * limiter, and a busy site throttled a quiet one. Derived from the slug so it
 * is stable across runs and machines, and recorded in the ledger so a
 * collision is visible rather than mysterious.
 */
export function rateLimitNamespace(slug: string): string {
  // FNV-1a, for a small deterministic spread with no dependency.
  let hash = 0x811c9dc5;
  for (const character of slug) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // 1001–65000: outside the template's default, and inside what Cloudflare
  // accepts for a namespace id.
  return String(1001 + (hash % 63_999));
}

/** Resource names for a slug. */
export function resourceNames(slug: string): ResourceNames {
  return {
    worker: `mallok-${slug}`,
    database: `mallok-${slug}-db`,
    bucket: `mallok-${slug}-media`,
  };
}

/**
 * Rejects a slug that would produce an invalid resource name.
 *
 * The `mallok-` prefix is added by {@link resourceNames}, so a slug that
 * carries it would produce `mallok-mallok-acme`. That is refused rather than
 * silently stripped: a person who typed it meant something, and guessing which
 * is how a gate ends up provisioning under a name nobody expected.
 */
export function validateSlug(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
    return 'A slug is 3–32 characters of lowercase letters, digits and hyphens, and cannot start or end with a hyphen.';
  }
  if (slug.startsWith('mallok-')) {
    return 'The "mallok-" prefix is added automatically; leave it off the slug.';
  }
  return null;
}

/**
 * Checks a custom domain before it can reach Cloudflare.
 *
 * Validated here, before the first remote call, because a malformed hostname
 * used to be written into the configuration and discovered at the deploy —
 * after the database and the bucket already existed.
 */
export function validateDomain(domain: string): string | null {
  if (domain !== domain.trim() || domain === '') {
    return 'A domain cannot be empty or padded with spaces.';
  }
  if (domain.includes('://') || domain.includes('/')) {
    return 'Give a hostname, not a URL: example.com, not https://example.com/.';
  }
  if (domain.includes('*')) {
    return 'A wildcard is not a hostname a Worker can be bound to.';
  }
  if (domain.length > 253) {
    return 'That hostname is longer than DNS allows.';
  }
  const labels = domain.split('.');
  if (labels.length < 2) {
    return 'A custom domain needs at least one dot: example.com.';
  }
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) {
      return `"${label}" is not a valid DNS label.`;
    }
  }
  // No quoting check is needed beyond this point: the label rule above
  // already restricts every character to [A-Za-z0-9-], so nothing that would
  // need escaping inside a JSONC string can reach the configuration.
  return null;
}

/**
 * Strips JSONC comments without touching string contents.
 *
 * A regular expression over the whole file would corrupt any value containing
 * `//` — a URL, for instance — which is exactly the kind of bug that produces
 * a configuration that parses but is wrong.
 */
export function stripJsonc(text: string): string {
  let out = '';
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const character = text[index] ?? '';
    const next = text[index + 1] ?? '';
    if (inString) {
      out += character;
      if (character === '\\') {
        out += next;
        index += 2;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      index++;
      continue;
    }
    if (character === '"') {
      inString = true;
      out += character;
      index++;
      continue;
    }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index++;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === '*' && text[index + 1] === '/')
      ) {
        index++;
      }
      index += 2;
      continue;
    }
    out += character;
    index++;
  }
  // Trailing commas are legal in JSONC and not in JSON.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Parses a Wrangler configuration file. */
export function parseJsonc(
  text: string,
  path: string,
): Record<string, unknown> {
  try {
    return JSON.parse(stripJsonc(text)) as Record<string, unknown>;
  } catch (error) {
    throw new CliError(
      EXIT.user,
      `${path} is not valid JSONC: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Writes the values a site's configuration needs.
 *
 * Edited in place, in the project's own `wrangler.jsonc`. The previous design
 * wrote a second config into `.mallok/sites/<slug>.jsonc` and deployed with
 * `-c`, which meant every relative path in it had to be rewritten — the bug
 * Gate A found on a real account. A config that sits where its paths were
 * written for cannot have that class of bug.
 */
export function renderConfig(base: string, input: SiteConfigInput): string {
  let config = base
    .replace(/"name":\s*"[^"]*"/, `"name": "${input.names.worker}"`)
    .replace(
      /"database_name":\s*"[^"]*"/,
      `"database_name": "${input.names.database}"`,
    )
    .replace(/"database_id":\s*"[^"]*"/, `"database_id": "${input.databaseId}"`)
    .replace(
      /"bucket_name":\s*"[^"]*"/,
      `"bucket_name": "${input.names.bucket}"`,
    )
    .replace(
      /"namespace_id":\s*"[^"]*"/,
      `"namespace_id": "${input.rateLimitNamespace}"`,
    )
    .replace(/"MALLOK_SITE":\s*"[^"]*"/, `"MALLOK_SITE": "${input.slug}"`);
  if (input.domain !== null && !config.includes('"routes"')) {
    // A custom_domain route makes the deploy create the DNS record and the
    // certificate (docs/CLOUDFLARE_RESOURCES.md §6).
    config = config.replace(
      /"compatibility_date"/,
      `"routes": [{ "pattern": "${input.domain}", "custom_domain": true }],\n  "compatibility_date"`,
    );
  }
  return config;
}

/** The checks a rendered configuration has to pass before it is used. */
export function assertUsableConfig(
  config: Record<string, unknown>,
  input: SiteConfigInput,
): void {
  const problems: string[] = [];
  if (config.name !== input.names.worker) {
    problems.push(`name is "${String(config.name)}"`);
  }
  const databases = config.d1_databases as
    | { binding?: string; database_name?: string; database_id?: string }[]
    | undefined;
  if (databases?.[0]?.binding !== 'DB') {
    problems.push('no D1 binding named DB');
  }
  if (databases?.[0]?.database_name !== input.names.database) {
    problems.push('the database name was not written');
  }
  if (databases?.[0]?.database_id !== input.databaseId) {
    problems.push('the database id was not written');
  }
  const buckets = config.r2_buckets as
    | { binding?: string; bucket_name?: string }[]
    | undefined;
  if (buckets?.[0]?.binding !== 'MEDIA') {
    problems.push('no R2 binding named MEDIA');
  }
  if (buckets?.[0]?.bucket_name !== input.names.bucket) {
    problems.push('the bucket name was not written');
  }
  const limits = config.ratelimits as
    | { name?: string; namespace_id?: string }[]
    | undefined;
  if (limits?.[0]?.name !== 'RATE_LIMITER') {
    problems.push('no rate-limit binding named RATE_LIMITER');
  }
  if (limits?.[0]?.namespace_id !== input.rateLimitNamespace) {
    problems.push('the rate-limit namespace was not written');
  }
  if (
    (config.assets as { binding?: string } | undefined)?.binding !== 'ASSETS'
  ) {
    problems.push('no assets binding named ASSETS');
  }
  if (input.domain !== null) {
    const routes = config.routes as
      | { pattern?: string; custom_domain?: boolean }[]
      | undefined;
    if (
      routes?.some(
        (route) =>
          route.pattern === input.domain && route.custom_domain === true,
      ) !== true
    ) {
      problems.push(`no custom_domain route for ${input.domain}`);
    }
  }
  if (problems.length > 0) {
    throw new CliError(
      EXIT.user,
      `The generated wrangler.jsonc is not usable: ${problems.join('; ')}.`,
      'This is a bug in `mallok create`; nothing on Cloudflare has been changed.',
    );
  }
}

/**
 * A fingerprint of the configuration a run intends to deploy.
 *
 * Recorded in the ledger before the first mutation. A resumed run that
 * produces a different fingerprint is asking for something else than the run
 * that created the resources, which is worth stopping for.
 */
export function configFingerprint(input: SiteConfigInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        slug: input.slug,
        worker: input.names.worker,
        database: input.names.database,
        bucket: input.names.bucket,
        domain: input.domain,
        rateLimitNamespace: input.rateLimitNamespace,
      }),
    )
    .digest('hex')
    .slice(0, 32);
}

/** Reads, renders, validates and writes a project's configuration. */
export async function writeSiteConfig(
  projectDir: string,
  input: SiteConfigInput,
): Promise<string> {
  const path = join(projectDir, 'wrangler.jsonc');
  const base = await readFile(path, 'utf8').catch(() => {
    throw new CliError(
      EXIT.user,
      'This directory has no wrangler.jsonc.',
      'Run `mallok create` from an empty directory, or from inside a project it made.',
    );
  });
  const rendered = renderConfig(base, input);
  assertUsableConfig(parseJsonc(rendered, path), input);
  await writeFile(path, rendered, 'utf8');
  return rendered;
}

/** Pulls a `database_id` out of `wrangler d1 create` output. */
export function parseDatabaseId(output: string): string | null {
  return (
    /"?database_id"?\s*[:=]\s*"?([0-9a-f-]{36})"?/i.exec(output)?.[1] ?? null
  );
}
