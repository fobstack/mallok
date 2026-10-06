import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { cacheKeyFor } from '../../src/worker/cache.js';

/**
 * A tagline per language (docs/DATA_MODEL.md §2.2, docs/THEME_FORMAT.md §7).
 *
 * `tagline` is one string or a map of locale to string, the way `nav` is
 * keyed. `site.tagline` and the home page's description are the page's
 * language's, falling back to the default language's.
 */

const ORIGIN = 'https://tagline.example';
const EMAIL = 'tagline@example.com';
const PASSWORD = 'a sufficiently long password';

let admin: (method: string, path: string, body?: unknown) => Promise<Response>;

/** The home page of a language, rendered now and not read from the cache. */
async function description(path: string): Promise<string> {
  // No purge token is bound in tests, so a settings change purges nothing.
  await caches.default.delete(cacheKeyFor(new Request(`${ORIGIN}${path}`)));
  const html = await (await SELF.fetch(`${ORIGIN}${path}`)).text();
  return /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
}

async function stored(): Promise<{ tagline: string | null; taglines: string }> {
  const row = await env.DB.prepare(
    'SELECT tagline, taglines FROM site WHERE id = 1',
  ).first<{ tagline: string | null; taglines: string }>();
  if (row === null) {
    throw new Error('no site');
  }
  return row;
}

async function tagline(): Promise<unknown> {
  return (
    (await (await admin('GET', '/_mallok/api/settings')).json()) as {
      tagline: unknown;
    }
  ).tagline;
}

describe('a tagline per language', () => {
  beforeAll(async () => {
    await SELF.fetch(`${ORIGIN}/_mallok/api/setup`);
    await SELF.fetch(`${ORIGIN}/_mallok/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie =
      (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { csrf } = (await session.json()) as { csrf: string };
    admin = (method, path, body) =>
      SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await admin('PATCH', '/_mallok/api/settings', {
      name: 'Titan',
      locales: ['en', 'de', 'zh', 'fr'],
    });
  });

  it('keeps a plain string as it always was, for every language', async () => {
    const saved = await admin('PATCH', '/_mallok/api/settings', {
      tagline: 'Titanium fasteners',
    });
    expect(saved.status).toBe(200);
    expect(await stored()).toEqual({
      tagline: 'Titanium fasteners',
      taglines: '{}',
    });
    expect(await tagline()).toBe('Titanium fasteners');
    expect(await description('/de/')).toBe('Titanium fasteners');
  });

  it('takes a map of locale to text and serves each language its own', async () => {
    const saved = await admin('PATCH', '/_mallok/api/settings', {
      tagline: {
        en: 'Titanium fasteners & parts',
        de: 'Verbindungselemente aus Titan',
        zh: '钛紧固件',
        // Blank: French has none of its own.
        fr: '  ',
      },
    });
    expect(saved.status).toBe(200);
    expect(await stored()).toEqual({
      tagline: 'Titanium fasteners & parts',
      taglines: JSON.stringify({
        de: 'Verbindungselemente aus Titan',
        zh: '钛紧固件',
      }),
    });
    // Read back in the shape it was written, default language first.
    expect(await tagline()).toEqual({
      en: 'Titanium fasteners & parts',
      de: 'Verbindungselemente aus Titan',
      zh: '钛紧固件',
    });
  });

  it("puts the page's language's tagline in the home page description", async () => {
    expect(await description('/')).toBe('Titanium fasteners &amp; parts');
    // `/de/` was rendered with the old tagline by the test above.
    expect(await description('/de/')).toBe('Verbindungselemente aus Titan');
    expect(await description('/zh/')).toBe('钛紧固件');
    // No tagline of its own: the default language's.
    expect(await description('/fr/')).toBe('Titanium fasteners &amp; parts');
  });

  it('describes each language’s feed in that language', async () => {
    const feed = await (await SELF.fetch(`${ORIGIN}/zh/feed.xml`)).text();
    expect(feed).toContain('钛紧固件');
    const english = await (await SELF.fetch(`${ORIGIN}/feed.xml`)).text();
    expect(english).toContain('Titanium fasteners &amp; parts');
  });

  it('exports the map, so a site.json round trip keeps it', async () => {
    const response = await admin('GET', '/_mallok/api/export');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      files: { path: string; text: string }[];
    };
    const site = JSON.parse(
      body.files.find((file) => file.path === 'site.json')?.text ?? '{}',
    ) as { tagline: unknown };
    expect(site.tagline).toEqual({
      en: 'Titanium fasteners & parts',
      de: 'Verbindungselemente aus Titan',
      zh: '钛紧固件',
    });
  });

  it('refuses a key that is not a locale, and leaves the rest alone when the tagline is not sent', async () => {
    const refused = await admin('PATCH', '/_mallok/api/settings', {
      tagline: { 'not a locale': 'x' },
    });
    expect(refused.status).toBe(400);
    await admin('PATCH', '/_mallok/api/settings', { name: 'Titan Works' });
    expect(JSON.parse((await stored()).taglines)).toHaveProperty('de');
  });

  it('goes back to one tagline for everyone when a string is saved again', async () => {
    await admin('PATCH', '/_mallok/api/settings', { tagline: 'One line' });
    expect(await stored()).toEqual({ tagline: 'One line', taglines: '{}' });
    expect(await tagline()).toBe('One line');
    await admin('PATCH', '/_mallok/api/settings', { tagline: null });
    expect(await stored()).toEqual({ tagline: null, taglines: '{}' });
  });
});
