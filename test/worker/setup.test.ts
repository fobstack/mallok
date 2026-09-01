import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The first-run wizard (docs/ADMIN.md §5).
 *
 * The property that matters most is the last one: once setup completes, the
 * routes must stop existing, or anyone who finds the URL could re-seed a
 * live site.
 */

const ORIGIN = 'https://setup-test.example';
const EMAIL = 'setup@example.com';
const PASSWORD = 'a sufficiently long password';

let cookie = '';
let csrf = '';

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie === '' ? {} : { cookie, 'x-mallok-csrf': csrf }),
    },
    body: JSON.stringify(body),
  });
}

describe('the setup wizard', () => {
  beforeAll(async () => {
    await SELF.fetch(`${ORIGIN}/`);
  });

  it('reports what this deployment can and cannot do', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/api/setup`);
    expect(response.status).toBe(200);
    const status = (await response.json()) as {
      completed: boolean;
      hasAdmin: boolean;
      starters: { id: string; matchesActiveTheme: boolean }[];
      purgeConfigured: boolean;
      customDomain: string | null;
    };
    expect(status.completed).toBe(false);
    expect(status.starters.map((entry) => entry.id)).toContain('trade-b2b');
    // Neither is configured in a test environment, and the wizard says so
    // rather than letting the user discover it later.
    expect(status.purgeConfigured).toBe(false);
    expect(status.customDomain).toBeNull();
  });

  it('creates the administrator in the first step', async () => {
    const created = await post('/_mallok/api/setup/admin', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect([200, 201]).toContain(created.status);

    const session = await post('/_mallok/api/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    cookie = (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    csrf = ((await session.json()) as { csrf: string }).csrf;
    expect(cookie).not.toBe('');
  });

  it('refuses later steps without that account', async () => {
    const saved = cookie;
    cookie = '';
    const response = await post('/_mallok/api/setup/site', {
      name: 'X',
      defaultLocale: 'en',
      locales: ['en'],
    });
    expect(response.status).toBe(401);
    cookie = saved;
  });

  it('sets the site name and languages, and lowers the cache lifetime', async () => {
    const response = await post('/_mallok/api/setup/site', {
      name: 'Baoji Titanium Works',
      defaultLocale: 'en',
      locales: ['en', 'zh'],
    });
    expect(response.status).toBe(200);
    // No purge token here, so a long cache would hide every edit; the wizard
    // shortens it and reports that it did (docs/ADMIN.md §5).
    expect((await response.json()) as { cacheTtlLowered: boolean }).toEqual({
      ok: true,
      cacheTtlLowered: true,
    });
    const row = await env.DB.prepare(
      'SELECT name, default_locale, cache_ttl FROM site WHERE id = 1',
    ).first<{ name: string; default_locale: string; cache_ttl: number }>();
    expect(row?.name).toBe('Baoji Titanium Works');
    expect(row?.cache_ttl).toBe(60);
  });

  it('rejects a language list that omits the default', async () => {
    const response = await post('/_mallok/api/setup/site', {
      name: 'X',
      defaultLocale: 'de',
      locales: ['en'],
    });
    expect(response.status).toBe(400);
  });

  it('installs a starter as ordinary content', async () => {
    const response = await post('/_mallok/api/setup/starter', {
      starter: 'trade-b2b',
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      created: number;
      failed: { slug: string; error: string }[];
      plugins: string[];
    };
    expect(result.failed).toEqual([]);
    expect(result.created).toBeGreaterThan(10);
    expect(result.plugins).toContain('inquiry');

    // The starter's plugin is switched on…
    const plugin = await env.DB.prepare(
      "SELECT enabled FROM plugin_state WHERE plugin_id = 'inquiry'",
    ).first<{ enabled: number }>();
    expect(plugin?.enabled).toBe(1);

    // …and its content is indistinguishable from typed content.
    const product = await env.DB.prepare(
      "SELECT kind, path, status FROM content WHERE slug = 'grade-5-titanium-bar'",
    ).first<{ kind: string; path: string; status: string }>();
    expect(product?.kind).toBe('product');
    expect(product?.path).toBe('/products/grade-5-titanium-bar');
    expect(product?.status).toBe('published');
  });

  it("installs the starter's translations into one group", async () => {
    // A foreign-trade site that ships monolingual is missing half its market,
    // so the starter's key pages arrive in both languages with `hreflang`
    // already correct (docs/ARCHITECTURE.md §9).
    const site = await env.DB.prepare(
      'SELECT locales FROM site WHERE id = 1',
    ).first<{ locales: string }>();
    expect(JSON.parse(site?.locales ?? '[]')).toContain('zh');

    const pair = await env.DB.prepare(
      `SELECT locale, slug, path, translation_group FROM content
       WHERE translation_group = (
         SELECT translation_group FROM content WHERE slug = 'grade-5-titanium-bar'
       ) ORDER BY locale`,
    ).all<{ locale: string; slug: string; path: string }>();
    expect(pair.results.map((row) => row.locale)).toEqual(['en', 'zh']);
    // The default locale has no prefix; every other language does.
    expect(pair.results[0]?.path).toBe('/products/grade-5-titanium-bar');
    expect(pair.results[1]?.path).toBe('/zh/products/gr5-tihejin-bang');
  });

  it('leaves untranslated items alone rather than duplicating them', async () => {
    // Case studies and news are English only in this starter, which is what
    // a real site looks like; the editor offers to create the rest.
    const cases = await env.DB.prepare(
      "SELECT locale FROM content WHERE kind = 'case'",
    ).all<{ locale: string }>();
    expect(new Set(cases.results.map((row) => row.locale))).toEqual(
      new Set(['en']),
    );
  });

  it('names a starter that does not exist rather than failing vaguely', async () => {
    const response = await post('/_mallok/api/setup/starter', {
      starter: 'nope',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain(
      'nope',
    );
  });

  it('closes for good once completed', async () => {
    const done = await post('/_mallok/api/setup/complete', {});
    expect(done.status).toBe(200);

    // Every route, including the read-only status, is gone.
    for (const path of ['', '/status', '/admin', '/site', '/starter']) {
      const response = await SELF.fetch(`${ORIGIN}/_mallok/api/setup${path}`, {
        method: path === '' || path === '/status' ? 'GET' : 'POST',
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        ...(path === '' || path === '/status' ? {} : { body: '{}' }),
      });
      expect(response.status).toBe(404);
    }
  });
});
