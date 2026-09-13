import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../../src/cli/output.js';
import {
  assertUsableConfig,
  configFingerprint,
  PLACEHOLDER_DATABASE_ID,
  parseDatabaseId,
  parseJsonc,
  rateLimitNamespace,
  renderConfig,
  resourceNames,
  type SiteConfigInput,
  stripJsonc,
  validateDomain,
  validateSlug,
  writeSiteConfig,
} from '../../src/cli/site-config.js';

/**
 * The configuration a site will actually be deployed with.
 *
 * This is the half of `mallok create` that used to run *after* the database
 * and the bucket existed: names were written into a file nobody had checked,
 * and a mistake surfaced at the deploy, with two real resources already on the
 * account. Everything here is now decided and validated before the first
 * remote call, which only helps if the validation is real.
 */

const INPUT: SiteConfigInput = {
  slug: 'acme',
  names: resourceNames('acme'),
  databaseId: PLACEHOLDER_DATABASE_ID,
  domain: null,
  rateLimitNamespace: rateLimitNamespace('acme'),
};

const BASE = `{
  // A comment, and a URL inside a string: both have to survive.
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mallok-site",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-08-01",
  "assets": { "directory": "./dist/assets", "binding": "ASSETS" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mallok-site-db",
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "mallok-site-media" }],
  "ratelimits": [
    { "name": "RATE_LIMITER", "namespace_id": "1000", "simple": { "limit": 10, "period": 60 } }
  ],
  "vars": {
    "MALLOK_SITE": "site",
    "MALLOK_DOMAIN": ""
  },
  "triggers": { "crons": ["* * * * *"] }
}
`;

describe('stripping JSONC', () => {
  it('removes comments and trailing commas', () => {
    const parsed = JSON.parse(
      stripJsonc('{\n  // a\n  "a": 1, /* b */\n  "b": [1, 2,],\n}'),
    ) as { a: number; b: number[] };

    expect(parsed).toEqual({ a: 1, b: [1, 2] });
  });

  it('leaves a // inside a string alone', () => {
    // A regular expression over the whole file corrupts any value containing
    // `//` — a URL, for instance — and produces a configuration that parses
    // and is wrong.
    const parsed = JSON.parse(
      stripJsonc('{ "url": "https://example.com/a", "n": 1 }'),
    ) as { url: string };

    expect(parsed.url).toBe('https://example.com/a');
  });

  it('leaves an escaped quote alone', () => {
    const parsed = JSON.parse(stripJsonc('{ "a": "say \\"hi\\" // now" }')) as {
      a: string;
    };

    expect(parsed.a).toBe('say "hi" // now');
  });

  it('explains where a broken config is broken', () => {
    expect(() => parseJsonc('{ "a": }', 'wrangler.jsonc')).toThrow(CliError);
    expect(() => parseJsonc('{ "a": }', 'wrangler.jsonc')).toThrow(
      /wrangler\.jsonc is not valid JSONC/,
    );
  });
});

describe('slugs', () => {
  it('accepts a normal slug', () => {
    expect(validateSlug('acme')).toBeNull();
    expect(validateSlug('acme-titanium-2')).toBeNull();
  });

  it('rejects shapes that produce invalid resource names', () => {
    for (const slug of ['AB', '-lead', 'trail-', 'a', 'under_score']) {
      expect(validateSlug(slug), slug).not.toBeNull();
    }
  });

  it('refuses the prefix it adds itself', () => {
    // `mallok-acme` would produce `mallok-mallok-acme`. Refused rather than
    // silently stripped: a person who typed it meant something.
    expect(validateSlug('mallok-acme')).toContain('automatically');
  });
});

describe('domains', () => {
  it('accepts a hostname', () => {
    expect(validateDomain('example.com')).toBeNull();
    expect(validateDomain('shop.example.co.uk')).toBeNull();
  });

  it('refuses everything that is not one', () => {
    for (const domain of [
      'https://example.com',
      'example.com/path',
      '*.example.com',
      'localhost',
      'exam ple.com',
      ' example.com',
      '',
      `${'a'.repeat(250)}.example.com`,
      'exa_mple.com',
    ]) {
      expect(validateDomain(domain), domain).not.toBeNull();
    }
  });
});

describe('rendering the configuration', () => {
  it('writes every name, and keeps the file valid JSONC', () => {
    const rendered = renderConfig(BASE, INPUT);
    const parsed = parseJsonc(rendered, 'wrangler.jsonc');

    expect(parsed.name).toBe('mallok-acme');
    expect(rendered).toContain('// A comment');
    expect(rendered).toContain('"$schema"');
    assertUsableConfig(parsed, INPUT);
  });

  it('adds a custom-domain route and the domain var', () => {
    const withDomain = { ...INPUT, domain: 'shop.example.com' };
    const rendered = renderConfig(BASE, withDomain);

    expect(rendered).toContain('"pattern": "shop.example.com"');
    expect(rendered).toContain('"custom_domain": true');
    expect(rendered).toContain('"MALLOK_DOMAIN": "shop.example.com"');
    // No var asks for the setup key any more: a site requires one by
    // default, so the var said nothing and its *absence* used to mean "let
    // anyone in". What a rendered config must never carry is the
    // development switch that turns the requirement off.
    expect(rendered).not.toContain('MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY');
    assertUsableConfig(parseJsonc(rendered, 'wrangler.jsonc'), withDomain);
  });

  it('gives every slug its own rate-limit namespace', () => {
    // The template ships 1000 for every site, so two sites on one account
    // shared a limiter and a busy one throttled a quiet one.
    const namespaces = ['acme', 'beta', 'gamma', 'delta', 'epsilon'].map(
      rateLimitNamespace,
    );

    expect(new Set(namespaces).size).toBe(5);
    expect(rateLimitNamespace('acme')).toBe(rateLimitNamespace('acme'));
    for (const namespace of namespaces) {
      expect(Number(namespace)).toBeGreaterThan(1000);
    }
  });

  it('refuses a configuration that came out wrong', () => {
    // The check exists because the alternative is discovering it at the
    // deploy, after the database and the bucket exist.
    const missingBucket = BASE.replace('"binding": "MEDIA"', '"binding": "X"');
    expect(() =>
      assertUsableConfig(
        parseJsonc(renderConfig(missingBucket, INPUT), 'w.jsonc'),
        INPUT,
      ),
    ).toThrow(/no R2 binding named MEDIA/);

    const noLimiter = BASE.replace('"name": "RATE_LIMITER"', '"name": "X"');
    expect(() =>
      assertUsableConfig(
        parseJsonc(renderConfig(noLimiter, INPUT), 'w.jsonc'),
        INPUT,
      ),
    ).toThrow(/RATE_LIMITER/);
  });
});

describe('the fingerprint', () => {
  it('changes when what would be deployed changes', () => {
    const base = configFingerprint(INPUT);

    expect(configFingerprint(INPUT)).toBe(base);
    expect(configFingerprint({ ...INPUT, domain: 'example.com' })).not.toBe(
      base,
    );
    expect(
      configFingerprint({
        ...INPUT,
        slug: 'other',
        names: resourceNames('other'),
      }),
    ).not.toBe(base);
  });

  it('does not change when only the database id is known', () => {
    // The id is learned during the run; a resumed run must not be refused
    // because it now knows something the first run did not.
    expect(
      configFingerprint({ ...INPUT, databaseId: 'real-id-learned-later' }),
    ).toBe(configFingerprint(INPUT));
  });
});

describe('writing it to a project', () => {
  let project = '';

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'mallok-config-'));
    await writeFile(join(project, 'wrangler.jsonc'), BASE, 'utf8');
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it('edits the project’s own file in place', async () => {
    await writeSiteConfig(project, INPUT);

    const written = await readFile(join(project, 'wrangler.jsonc'), 'utf8');
    expect(written).toContain('"name": "mallok-acme"');
    // `main` and `assets.directory` are untouched, because this file stays
    // where its relative paths were written for. The old design wrote a
    // second config two directories down and had to rewrite both — the bug
    // Gate A found on a real account.
    expect(written).toContain('"main": "src/worker/index.ts"');
    expect(written).toContain('"directory": "./dist/assets"');
  });

  it('says so when there is no configuration to edit', async () => {
    await rm(join(project, 'wrangler.jsonc'));

    await expect(writeSiteConfig(project, INPUT)).rejects.toThrow(
      /no wrangler\.jsonc/,
    );
  });
});

describe('reading a database id back from wrangler', () => {
  it('reads either shape it prints', () => {
    const uuid = '2f3a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8';

    expect(parseDatabaseId(`"database_id": "${uuid}"`)).toBe(uuid);
    expect(parseDatabaseId(`database_id = "${uuid}"`)).toBe(uuid);
    // Null rather than a wrong value: the run stops and says where to look.
    expect(parseDatabaseId('Created database mallok-acme-db')).toBeNull();
  });
});
