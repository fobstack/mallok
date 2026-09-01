import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://locale-test.example';
const EMAIL = 'locale@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';
/** The English article every test builds on. */
let englishId = '';
let group = '';

function auth(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('authorization', `Bearer ${token}`);
  return headers;
}

function get(path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: auth({ 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function forgetCached(path: string): Promise<void> {
  await caches.default.delete(new Request(`${ORIGIN}${path}`));
}

describe('multiple locales', () => {
  beforeAll(async () => {
    await get('/');
    await api('POST', '/_mallok/api/auth/bootstrap', {
      email: EMAIL,
      password: PASSWORD,
    });
    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie =
      (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { csrf } = (await session.json()) as { csrf: string };
    const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'locale-test',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;
  });

  it('enables a second locale', async () => {
    const response = await api('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'de'],
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as object).toMatchObject({
      locales: ['en', 'de'],
      defaultLocale: 'en',
    });
  });

  it('refuses to drop the locale that is currently the default', async () => {
    const response = await api('PATCH', '/_mallok/api/settings', {
      locales: ['de'],
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('default locale');
  });

  it('publishes an article in the default locale without a prefix', async () => {
    const created = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      markdown: '---\ntitle: Titanium supply\n---\n\nEnglish body.',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; path: string };
    expect(body.path).toBe('/news/titanium-supply');
    englishId = body.id;

    const detail = await SELF.fetch(
      `${ORIGIN}/_mallok/api/content/${englishId}`,
      { headers: auth() },
    );
    group = ((await detail.json()) as { translationGroup: string })
      .translationGroup;
    expect(group).not.toBe('');
  });

  it('publishes a translation under its own prefix', async () => {
    const created = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      locale: 'de',
      slug: 'titan-versorgung',
      translationGroup: group,
      markdown: '---\ntitle: Titan-Versorgung\n---\n\nDeutscher Text.',
    });
    expect(created.status).toBe(201);
    expect((await created.json()) as object).toMatchObject({
      path: '/de/news/titan-versorgung',
    });

    const page = await get('/de/news/titan-versorgung');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Deutscher Text');
  });

  it('refuses a locale the site has not enabled', async () => {
    const response = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      locale: 'fr',
      markdown: '---\ntitle: Non\n---\n\nNon.',
    });
    expect(response.status).toBe(400);
  });

  it('points the two versions at each other with hreflang', async () => {
    const english = await (await get('/news/titanium-supply')).text();
    expect(english).toContain(
      '<link rel="alternate" hreflang="en" href="https://locale-test.example/news/titanium-supply">',
    );
    expect(english).toContain(
      '<link rel="alternate" hreflang="de" href="https://locale-test.example/de/news/titan-versorgung">',
    );
    // x-default points at the default locale.
    expect(english).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://locale-test.example/news/titanium-supply">',
    );

    const german = await (await get('/de/news/titan-versorgung')).text();
    expect(german).toContain('hreflang="en"');
    expect(german).toContain('hreflang="de"');
    expect(german).toContain(
      '<link rel="canonical" href="https://locale-test.example/de/news/titan-versorgung">',
    );
  });

  it('serves a home page per locale', async () => {
    const german = await get('/de');
    expect(german.status).toBe(200);
    expect(german.headers.get('cache-tag')).toContain('home:de');

    const english = await get('/');
    expect(english.headers.get('cache-tag')).toContain('home:en');
  });

  it('serves a list page per locale, each with hreflang', async () => {
    const german = await get('/de/news');
    expect(german.status).toBe(200);
    expect(german.headers.get('cache-tag')).toContain('k:article:de');
    const html = await german.text();
    expect(html).toContain('href="/de/news/titan-versorgung"');
    expect(html).toContain(
      '<link rel="alternate" hreflang="en" href="https://locale-test.example/news">',
    );
    expect(html).toContain(
      '<link rel="alternate" hreflang="de" href="https://locale-test.example/de/news">',
    );

    const english = await get('/news');
    expect(english.headers.get('cache-tag')).toContain('k:article:en');
    // Each locale lists only its own content.
    const englishHtml = await english.text();
    expect(englishHtml).toContain('href="/news/titanium-supply"');
    expect(englishHtml).not.toContain('titan-versorgung');
  });

  it('tells the editor which locales exist and which would be new', async () => {
    const detail = await SELF.fetch(
      `${ORIGIN}/_mallok/api/content/${englishId}`,
      { headers: auth() },
    );
    const body = (await detail.json()) as {
      translations: { locale: string; exists: boolean; path?: string }[];
    };
    expect(body.translations).toHaveLength(2);
    expect(body.translations).toContainEqual(
      expect.objectContaining({ locale: 'de', exists: true }),
    );
    expect(body.translations.find((item) => item.locale === 'en')?.exists).toBe(
      true,
    );
  });

  it('requires an explicit confirmation to change the default locale', async () => {
    const response = await api('POST', '/_mallok/api/settings/default-locale', {
      locale: 'de',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('confirm');
  });

  it('refuses a default locale that is not enabled', async () => {
    const response = await api('POST', '/_mallok/api/settings/default-locale', {
      locale: 'fr',
      confirm: true,
    });
    expect(response.status).toBe(400);
  });

  it('swaps every URL when the default locale changes, leaving redirects', async () => {
    const response = await api('POST', '/_mallok/api/settings/default-locale', {
      locale: 'de',
      confirm: true,
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as object).toMatchObject({
      defaultLocale: 'de',
      moved: 2,
    });

    // German is now at the root, English carries the prefix.
    for (const path of [
      '/news/titan-versorgung',
      '/en/news/titanium-supply',
      '/news/titanium-supply',
      '/de/news/titan-versorgung',
    ]) {
      await forgetCached(path);
    }
    expect((await get('/news/titan-versorgung')).status).toBe(200);
    expect((await get('/en/news/titanium-supply')).status).toBe(200);

    // The old URLs still resolve, so no external link breaks.
    const oldEnglish = await SELF.fetch(`${ORIGIN}/news/titanium-supply`, {
      redirect: 'manual',
    });
    expect(oldEnglish.status).toBe(301);
    expect(oldEnglish.headers.get('location')).toBe(
      `${ORIGIN}/en/news/titanium-supply`,
    );

    const oldGerman = await SELF.fetch(`${ORIGIN}/de/news/titan-versorgung`, {
      redirect: 'manual',
    });
    expect(oldGerman.status).toBe(301);
    expect(oldGerman.headers.get('location')).toBe(
      `${ORIGIN}/news/titan-versorgung`,
    );
  });

  it('keeps content ids and translation groups across the swap', async () => {
    const detail = await SELF.fetch(
      `${ORIGIN}/_mallok/api/content/${englishId}`,
      { headers: auth() },
    );
    expect((await detail.json()) as object).toMatchObject({
      id: englishId,
      translationGroup: group,
      path: '/en/news/titanium-supply',
    });
  });

  it('moves x-default with the default locale', async () => {
    await forgetCached('/news/titan-versorgung');
    const html = await (await get('/news/titan-versorgung')).text();
    expect(html).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://locale-test.example/news/titan-versorgung">',
    );
  });

  it('is a no-op when the target is already the default', async () => {
    const response = await api('POST', '/_mallok/api/settings/default-locale', {
      locale: 'de',
      confirm: true,
    });
    expect((await response.json()) as object).toMatchObject({
      unchanged: true,
      moved: 0,
    });
  });
});
