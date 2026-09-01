import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://seo-test.example';
const EMAIL = 'seo@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

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

describe('SEO endpoints', () => {
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
        name: 'seo-test',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    // en + de, one translated article, one draft that must stay invisible.
    await api('PATCH', '/_mallok/api/settings', { locales: ['en', 'de'] });
    const created = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      markdown:
        '---\ntitle: Sitemap fodder\ndescription: A visible article.\ndate: 2026-08-20T08:00:00Z\n---\n\nBody.',
    });
    const { id } = (await created.json()) as { id: string };
    const detail = await SELF.fetch(`${ORIGIN}/_mallok/api/content/${id}`, {
      headers: auth(),
    });
    const group = ((await detail.json()) as { translationGroup: string })
      .translationGroup;
    await api('POST', '/_mallok/api/content', {
      kind: 'article',
      locale: 'de',
      slug: 'sitemap-futter',
      translationGroup: group,
      markdown:
        '---\ntitle: Sitemap-Futter\ndate: 2026-08-21T08:00:00Z\n---\n\nText.',
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'article',
      markdown: '---\ntitle: Hidden draft\ndraft: true\n---\n\nInvisible.',
    });
  });

  it('serves a sitemap with only published content', async () => {
    await forgetCached('/sitemap.xml');
    const response = await get('/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');
    const body = await response.text();
    expect(body).toContain(
      '<loc>https://seo-test.example/news/sitemap-fodder</loc>',
    );
    expect(body).toContain(
      '<loc>https://seo-test.example/de/news/sitemap-futter</loc>',
    );
    expect(body).not.toContain('hidden-draft');
  });

  it('carries hreflang alternates and x-default in the sitemap', async () => {
    const body = await (await get('/sitemap.xml')).text();
    expect(body).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://seo-test.example/news/sitemap-fodder"/>',
    );
    expect(body).toContain(
      '<xhtml:link rel="alternate" hreflang="de" href="https://seo-test.example/de/news/sitemap-futter"/>',
    );
    expect(body).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://seo-test.example/news/sitemap-fodder"/>',
    );
  });

  it('caches the sitemap under its own tag', async () => {
    const again = await get('/sitemap.xml');
    expect(again.headers.get('x-mallok-cache')).toBe('HIT');
    await forgetCached('/sitemap.xml');
    const fresh = await get('/sitemap.xml');
    expect(fresh.headers.get('cache-tag')).toBe('sitemap');
  });

  it('serves an RSS feed per locale', async () => {
    await forgetCached('/feed.xml');
    const english = await get('/feed.xml');
    expect(english.status).toBe(200);
    expect(english.headers.get('content-type')).toContain('rss');
    const enBody = await english.text();
    expect(enBody).toContain('<title>Sitemap fodder</title>');
    expect(enBody).toContain('<language>en</language>');
    expect(enBody).not.toContain('Sitemap-Futter');
    expect(enBody).not.toContain('Hidden draft');

    await forgetCached('/de/feed.xml');
    const german = await get('/de/feed.xml');
    expect(german.status).toBe(200);
    const deBody = await german.text();
    expect(deBody).toContain('<title>Sitemap-Futter</title>');
    expect(deBody).toContain('<language>de</language>');
    expect(german.headers.get('cache-tag')).toBe('feed:de');
  });

  it('returns 404 for a feed in a locale the site has not enabled', async () => {
    expect((await get('/fr/feed.xml')).status).toBe(404);
  });

  it('disallows everything while no custom domain is bound', async () => {
    await forgetCached('/robots.txt');
    const response = await get('/robots.txt');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Disallow: /');
    expect(body).not.toContain('Sitemap:');
  });

  it('marks pages noindex while no custom domain is bound', async () => {
    await forgetCached('/news/sitemap-fodder');
    const page = await get('/news/sitemap-fodder');
    expect(page.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('opens robots and drops noindex on the canonical host', async () => {
    await api('PATCH', '/_mallok/api/settings', { domain: 'seo-test.example' });
    await forgetCached('/robots.txt');
    const robots = await (await get('/robots.txt')).text();
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /_mallok/');
    expect(robots).toContain('Sitemap: https://seo-test.example/sitemap.xml');

    await forgetCached('/news/sitemap-fodder');
    const page = await get('/news/sitemap-fodder');
    expect(page.headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps a non-canonical host noindexed after the domain is bound', async () => {
    const other = await SELF.fetch(
      'https://other-host.example/news/sitemap-fodder',
    );
    expect(other.status).toBe(200);
    expect(other.headers.get('x-robots-tag')).toBe('noindex');

    const robots = await SELF.fetch('https://other-host.example/robots.txt');
    // Cached per-origin, so the wrong host cannot serve the open robots file.
    expect(await robots.text()).toContain('Disallow: /');
  });

  it('emits Product JSON-LD on product pages', async () => {
    await api('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: 'products' },
      },
    });
    const created = await api('POST', '/_mallok/api/content', {
      kind: 'product',
      markdown:
        '---\ntitle: Grade 5 bar\ndescription: Round bar.\ngrade: Ti-6Al-4V\n---\n\nBody.',
    });
    expect(created.status).toBe(201);
    const { path } = (await created.json()) as { path: string };
    const html = await (await get(path)).text();
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"sku":"Ti-6Al-4V"');
    expect(html).toContain('"name":"Grade 5 bar"');
  });
});
