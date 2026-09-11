/**
 * The site registry, `.mallok/sites.json` (docs/CLOUDFLARE_RESOURCES.md §9).
 *
 * It records what was created so a later command can find it. It **never**
 * contains a secret: the file is meant to live in a repository, and a
 * `MALLOK_SECRET` or an API token in version control is the failure this
 * rule exists to prevent.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** One registered site. */
export interface SiteRecord {
  readonly slug: string;
  readonly origin: string;
  readonly domain: string | null;
  readonly accountId: string | null;
  readonly databaseId: string | null;
  readonly bucket: string;
  /** Rate-limit namespace, unique per site within an account. */
  readonly ratelimitNs: number;
  readonly createdAt: string;
}

const PATH = '.mallok/sites.json';

/** Reads the registry, returning an empty one when the file is absent. */
export async function readRegistry(path = PATH): Promise<SiteRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      sites?: SiteRecord[];
    };
    return parsed.sites ?? [];
  } catch {
    return [];
  }
}

/** Writes the registry, creating `.mallok/` if needed. */
export async function writeRegistry(
  sites: readonly SiteRecord[],
  path = PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ sites }, null, 2)}\n`, 'utf8');
}

/** Adds or replaces a record, keeping the file sorted by slug. */
export function upsertSite(
  sites: readonly SiteRecord[],
  record: SiteRecord,
): SiteRecord[] {
  const rest = sites.filter((site) => site.slug !== record.slug);
  return [...rest, record].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The next free rate-limit namespace.
 *
 * They must be unique per account, so the registry assigns them rather than
 * letting two sites collide on the default.
 */
export function nextNamespace(sites: readonly SiteRecord[]): number {
  const used = new Set(sites.map((site) => site.ratelimitNs));
  let candidate = 1001;
  while (used.has(candidate)) {
    candidate++;
  }
  return candidate;
}
