import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  nextNamespace,
  readRegistry,
  type SiteRecord,
  upsertSite,
  writeRegistry,
} from '../../src/cli/registry.js';

let root = '';

const record = (slug: string, ratelimitNs: number): SiteRecord => ({
  slug,
  origin: `https://${slug}.example.test`,
  domain: null,
  accountId: 'account-1',
  databaseId: `database-${slug}`,
  bucket: `bucket-${slug}`,
  ratelimitNs,
  createdAt: '2026-09-17T00:00:00.000Z',
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mallok-registry-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the local site registry', () => {
  it('round-trips records and creates the parent directory', async () => {
    const path = join(root, '.mallok/sites.json');
    const sites = [record('beta', 1002), record('alpha', 1001)];

    await writeRegistry(sites, path);

    await expect(readRegistry(path)).resolves.toEqual(sites);
    expect(await readFile(path, 'utf8')).toMatch(/\n$/);
  });

  it('treats an absent, invalid or shape-less file as an empty registry', async () => {
    const path = join(root, 'sites.json');
    await expect(readRegistry(path)).resolves.toEqual([]);

    await writeFile(path, '{not json');
    await expect(readRegistry(path)).resolves.toEqual([]);

    await writeFile(path, '{}');
    await expect(readRegistry(path)).resolves.toEqual([]);
  });

  it('replaces one slug, sorts the result and chooses the first free namespace', () => {
    const sites = [record('beta', 1002), record('alpha', 1001)];
    const updated = upsertSite(sites, record('beta', 1004));

    expect(updated.map(({ slug }) => slug)).toEqual(['alpha', 'beta']);
    expect(updated[1]?.ratelimitNs).toBe(1004);
    expect(nextNamespace(updated)).toBe(1002);
    expect(sites[0]?.ratelimitNs).toBe(1002);
  });
});
