import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSiteConfig,
  destroySteps,
  MANUAL_CLEANUP,
  parseDatabaseId,
} from '../../src/cli/provision.js';
import {
  nextNamespace,
  readRegistry,
  resourceNames,
  type SiteRecord,
  upsertSite,
  validateSlug,
  writeRegistry,
} from '../../src/cli/registry.js';

function record(slug: string, ns: number): SiteRecord {
  return {
    slug,
    origin: `https://${slug}.example`,
    domain: null,
    accountId: null,
    databaseId: null,
    bucket: `mallok-${slug}-media`,
    ratelimitNs: ns,
    createdAt: '2026-08-30T00:00:00Z',
  };
}

describe('resource names', () => {
  it('derives every name from the slug', () => {
    expect(resourceNames('acme')).toEqual({
      worker: 'mallok-acme',
      database: 'mallok-acme-db',
      bucket: 'mallok-acme-media',
      config: '.mallok/sites/acme.jsonc',
    });
  });
});

describe('validateSlug', () => {
  it('accepts a normal slug', () => {
    expect(validateSlug('acme')).toBeNull();
    expect(validateSlug('acme-titanium-2')).toBeNull();
  });

  it('rejects shapes that produce invalid resource names', () => {
    expect(validateSlug('AB')).not.toBeNull();
    expect(validateSlug('-lead')).not.toBeNull();
    expect(validateSlug('trail-')).not.toBeNull();
    expect(validateSlug('a')).not.toBeNull();
    expect(validateSlug('under_score')).not.toBeNull();
  });

  it('explains that the prefix is automatic', () => {
    expect(validateSlug('mallok-acme')).toContain('automatically');
  });
});

describe('the registry', () => {
  it('round trips and stays sorted', async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), 'mallok-reg-')),
      'sites.json',
    );
    await writeRegistry(
      upsertSite(upsertSite([], record('zulu', 1001)), record('alpha', 1002)),
      path,
    );
    const read = await readRegistry(path);
    expect(read.map((site) => site.slug)).toEqual(['alpha', 'zulu']);
  });

  it('replaces rather than duplicating an existing slug', () => {
    const updated = upsertSite([record('a', 1001)], {
      ...record('a', 1001),
      origin: 'https://changed.example',
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.origin).toBe('https://changed.example');
  });

  it('assigns a free rate-limit namespace', () => {
    // They must be unique per account, so two sites cannot share one.
    expect(nextNamespace([])).toBe(1001);
    expect(nextNamespace([record('a', 1001), record('b', 1002)])).toBe(1003);
    expect(nextNamespace([record('a', 1001), record('b', 1003)])).toBe(1002);
  });

  it('never stores a secret', async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), 'mallok-reg-')),
      'sites.json',
    );
    await writeRegistry([record('acme', 1001)], path);
    const text = await readFile(path, 'utf8');
    // The file is meant to live in a repository.
    expect(text.toLowerCase()).not.toContain('secret');
    expect(text.toLowerCase()).not.toContain('token');
  });

  it('treats a missing file as an empty registry', async () => {
    expect(await readRegistry('/nonexistent/sites.json')).toEqual([]);
  });
});

describe('parseDatabaseId', () => {
  it('reads the id out of wrangler output in either shape', () => {
    const uuid = '2f3a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8';
    expect(parseDatabaseId(`"database_id": "${uuid}"`)).toBe(uuid);
    expect(parseDatabaseId(`database_id = "${uuid}"`)).toBe(uuid);
  });

  it('returns null rather than a wrong value', () => {
    expect(parseDatabaseId('Created database mallok-acme-db')).toBeNull();
  });
});

describe('buildSiteConfig', () => {
  it('rewrites the names and keeps the file valid JSONC', async () => {
    const config = await buildSiteConfig(
      'acme',
      '2f3a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
      null,
      1001,
    );
    expect(config).toContain('"name": "mallok-acme"');
    expect(config).toContain('"database_name": "mallok-acme-db"');
    expect(config).toContain('"bucket_name": "mallok-acme-media"');
    expect(config).toContain('2f3a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8');
    // The comments in the base config survive the substitutions.
    expect(config).toContain('//');
  });

  it('adds a custom-domain route when a domain is given', async () => {
    const config = await buildSiteConfig('acme', 'id', 'acme.com', 1001);
    expect(config).toContain('"pattern": "acme.com"');
    expect(config).toContain('"custom_domain": true');
  });
});

describe('destroySteps', () => {
  it('deletes in the documented order', () => {
    // Worker first so its bindings release, then the database, then the
    // bucket (docs/CLOUDFLARE_RESOURCES.md §10).
    const steps = destroySteps('acme', '.mallok/sites/acme.jsonc');
    expect(steps.map((step) => step.args[0])).toEqual(['delete', 'd1', 'r2']);
    expect(steps.every((step) => step.tolerateMissing)).toBe(true);
  });

  it('lists what a person still has to do themselves', () => {
    // The CLI cannot delete a Turnstile widget or a dashboard token, and
    // says so rather than leaving them behind silently.
    expect(MANUAL_CLEANUP.join(' ')).toMatch(/Turnstile/);
    expect(MANUAL_CLEANUP.join(' ')).toMatch(/CF_API_TOKEN/);
    expect(MANUAL_CLEANUP.join(' ')).toMatch(/DNS/);
  });
});
