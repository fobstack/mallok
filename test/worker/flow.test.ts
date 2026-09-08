import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ACTIVE_THEME } from '../../src/themes/index.js';

/** Whatever theme this build ships; the tests must not assume which. */
const THEME = ACTIVE_THEME.manifest;

const ORIGIN = 'https://site.example';

const ADMIN_EMAIL = 'owner@example.com';
const ADMIN_PASSWORD = 'correct horse battery staple';

/** Scoped API token minted in `beforeAll`; stands in for the CLI. */
let apiToken = '';

function get(path: string, headers: HeadersInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { headers });
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${apiToken}` };
}

async function saveContent(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/api/content`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function forgetCached(path: string): Promise<void> {
  await caches.default.delete(new Request(`${ORIGIN}${path}`));
}

// These tests build on each other (boot → save → render) and share the
// Worker's storage within this file, so their order matters.
describe('walking skeleton', () => {
  it('boots once under concurrent first requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => get('/')),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    const migrations = await env.DB.prepare(
      'SELECT id FROM migration ORDER BY id',
    ).all<{ id: string }>();
    // Core plus every compiled-in plugin migration, applied exactly once.
    expect(migrations.results.map((row) => row.id)).toEqual([
      '0001_init',
      'plugin:inquiry:0001_inquiry',
    ]);
    const sites = await env.DB.prepare('SELECT COUNT(*) AS n FROM site').first<{
      n: number;
    }>();
    expect(sites?.n).toBe(1);
  });

  it('bootstraps an administrator and issues a scoped token', async () => {
    const created = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      }),
    });
    expect(created.status).toBe(201);

    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    expect(session.status).toBe(200);
    const setCookie = session.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    const { csrf } = (await session.json()) as { csrf: string };
    const cookie = setCookie.split(';')[0] ?? '';

    const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'test-runner',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    expect(minted.status).toBe(201);
    const body = (await minted.json()) as { token: string };
    expect(body.token.startsWith('mlk_live_')).toBe(true);
    apiToken = body.token;
  });

  it('protects the management API', async () => {
    expect((await get('/_mallok/api/health')).status).toBe(401);
    expect(
      (await get('/_mallok/api/health', { authorization: 'Bearer nope' }))
        .status,
    ).toBe(401);
    const ok = await get('/_mallok/api/health', auth());
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; theme: string };
    expect(body.ok).toBe(true);
    expect(body.theme).toBe(`${THEME.id}@${THEME.version}`);
  });

  it('links the stylesheet to Static Assets instead of inlining it', async () => {
    const page = await get('/');
    const html = await page.text();
    expect(html).toContain(
      `<link rel="stylesheet" href="/theme/${THEME.id}/${THEME.version}/style.css">`,
    );
    // The Task 01 shortcut of inlining the stylesheet is gone.
    expect(html).not.toContain('<style>body');

    // Whether that URL actually returns the file is Static Assets' job, and
    // the Workers test pool wires up only the `ASSETS` binding, not the
    // directory — so it cannot be asserted here. It is verified against
    // `wrangler dev` instead; see docs/tasks/TASK-04.md.
  });

  it('serves the home page and caches it at the edge', async () => {
    await forgetCached('/');
    const miss = await get('/');
    expect(miss.status).toBe(200);
    expect(miss.headers.get('x-mallok-cache')).toBe('MISS');
    // The edge keeps the page for an hour; the browser revalidates every time.
    // Purging Cloudflare does not reach a visitor's browser, so a long
    // `max-age` would serve a stale page long after the edit went live.
    expect(miss.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=3600',
    );
    expect(miss.headers.get('cache-tag')).toBe('site,home:en');
    expect(await miss.text()).toContain('My Mallok site');

    const hit = await get('/');
    expect(hit.headers.get('x-mallok-cache')).toBe('HIT');
  });

  it('publishes Markdown and renders it on its public path', async () => {
    const markdown = [
      '---',
      'title: Titanium prices in August',
      'description: A short summary.',
      'date: 2026-08-01T08:00:00Z',
      'tags: [titanium, prices]',
      '---',
      '',
      '## Market',
      '',
      'Prices **rose** this month.',
      '',
      '<script>alert(1)</script>',
      '',
      '![Furnace](images/furnace.jpg)',
    ].join('\n');

    const created = await saveContent({ kind: 'article', markdown });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      id: string;
      path: string;
      status: string;
      missingAssets: string[];
    };
    expect(body.path).toBe('/news/titanium-prices-in-august');
    expect(body.status).toBe('published');
    expect(body.missingAssets).toEqual(['images/furnace.jpg']);

    const page = await get(body.path);
    expect(page.status).toBe(200);
    expect(page.headers.get('x-mallok-cache')).toBe('MISS');
    expect(page.headers.get('x-mallok-fragment')).toBe('CACHED');
    expect(page.headers.get('cache-tag')).toBe(
      `site,c:${body.id},k:article:en,home:en,feed:en,tag:en,sitemap`,
    );
    const html = await page.text();
    expect(html).toMatch(/<h1[^>]*>Titanium prices in August<\/h1>/);
    expect(html).toContain('Prices <strong>rose</strong> this month.');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain(
      '<link rel="canonical" href="https://site.example/news/titanium-prices-in-august">',
    );

    await forgetCached('/');
    expect(await (await get('/')).text()).toContain(
      'Titanium prices in August',
    );

    await forgetCached('/news');
    const list = await get('/news');
    expect(list.status).toBe(200);
    expect(await list.text()).toContain(
      'href="/news/titanium-prices-in-august"',
    );
  });

  it('is idempotent when the same bundle is published again', async () => {
    const markdown = '---\ntitle: Same twice\n---\n\nBody.';
    const first = await saveContent({ kind: 'article', markdown });
    expect(first.status).toBe(201);
    const second = await saveContent({ kind: 'article', markdown });
    expect(second.status).toBe(200);
    expect((await second.json()) as object).toMatchObject({ unchanged: true });
  });

  it('keeps drafts and scheduled items off the public site', async () => {
    const draft = await saveContent({
      kind: 'article',
      markdown: '---\ntitle: Draft only\ndraft: true\n---\n\nHidden.',
    });
    const draftBody = (await draft.json()) as { path: string; status: string };
    expect(draftBody.status).toBe('draft');
    expect((await get(draftBody.path)).status).toBe(404);

    const scheduled = await saveContent({
      kind: 'article',
      markdown: '---\ntitle: Later\ndate: 2999-01-01T00:00:00Z\n---\n\nFuture.',
    });
    const scheduledBody = (await scheduled.json()) as {
      path: string;
      status: string;
    };
    expect(scheduledBody.status).toBe('scheduled');
    expect((await get(scheduledBody.path)).status).toBe(404);
  });

  it('records a redirect when the slug changes', async () => {
    const created = await saveContent({
      kind: 'page',
      markdown: '---\ntitle: About us\n---\n\nWho we are.',
    });
    const { id, path } = (await created.json()) as { id: string; path: string };
    expect(path).toBe('/about-us');

    const moved = await saveContent({
      id,
      kind: 'page',
      slug: 'company',
      markdown: '---\ntitle: About us\n---\n\nWho we are, renamed.',
    });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { path: string }).path).toBe('/company');

    const old = await SELF.fetch(`${ORIGIN}/about-us`, { redirect: 'manual' });
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe(`${ORIGIN}/company`);
  });

  it('lists content for the admin, including drafts', async () => {
    const listed = await get('/_mallok/api/content?kind=article', auth());
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      items: { title: string; status: string }[];
      hasNext: boolean;
    };
    const titles = body.items.map((item) => item.title);
    expect(titles).toContain('Draft only');
    expect(titles).toContain('Titanium prices in August');
    expect(body.hasNext).toBe(false);
  });

  it('reads one item back with its Markdown source intact', async () => {
    const list = await get('/_mallok/api/content?kind=page', auth());
    const { items } = (await list.json()) as { items: { id: string }[] };
    const id = items[0]?.id ?? '';
    const one = await get(`/_mallok/api/content/${id}`, auth());
    expect(one.status).toBe(200);
    const body = (await one.json()) as { markdown: string };
    expect(body.markdown).toContain('title: About us');
  });

  it('deletes content and stops serving it', async () => {
    const created = await saveContent({
      kind: 'article',
      markdown: '---\ntitle: Temporary\n---\n\nGone soon.',
    });
    const { id, path } = (await created.json()) as { id: string; path: string };
    expect((await get(path)).status).toBe(200);

    const removed = await SELF.fetch(`${ORIGIN}/_mallok/api/content/${id}`, {
      method: 'DELETE',
      headers: auth(),
    });
    expect(removed.status).toBe(200);

    await forgetCached(path);
    expect((await get(path)).status).toBe(404);
  });

  it('reads and updates settings', async () => {
    const before = await get('/_mallok/api/settings', auth());
    expect(before.status).toBe(200);
    expect((await before.json()) as object).toMatchObject({
      name: 'My Mallok site',
      defaultLocale: 'en',
    });

    const updated = await SELF.fetch(`${ORIGIN}/_mallok/api/settings`, {
      method: 'PATCH',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Titanium Seller', cacheTtl: 600 }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as object).toMatchObject({
      name: 'Titanium Seller',
      cacheTtl: 600,
    });
  });

  it('refuses to change the default locale through the settings patch', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/api/settings`, {
      method: 'PATCH',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ defaultLocale: 'de' }),
    });
    // It rewrites every URL, so it has its own endpoint and its own
    // confirmation rather than riding along with an ordinary settings save.
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('default-locale');
  });

  it('rejects unusable input with clear errors', async () => {
    const noTitle = await saveContent({
      kind: 'article',
      markdown: 'no front matter',
    });
    expect(noTitle.status).toBe(400);
    const badKind = await saveContent({
      kind: 'product',
      markdown: '---\ntitle: x\n---\n',
    });
    expect(badKind.status).toBe(400);
    const badAsset = await saveContent({
      kind: 'article',
      markdown: '---\ntitle: x\n---\n',
      assets: { '../etc/passwd': 'a'.repeat(64) },
    });
    expect(badAsset.status).toBe(400);
  });

  it('renders the theme’s own 404 for unknown public paths', async () => {
    const missing = await get('/nope/nothing');
    expect(missing.status).toBe(404);
    // A missing page is a real page in the site's theme, not a bare JSON
    // error: a visitor who mistypes a URL still gets the header, the
    // navigation and a way back.
    expect(missing.headers.get('content-type')).toContain('text/html');
    expect(missing.headers.get('x-robots-tag')).toBe('noindex');
    const html = await missing.text();
    expect(html).toContain('Page not found');
    expect(html).toContain('<footer');
    // Rendered but never stored: the page may exist by the next request.
    expect(missing.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 404 for unknown internal paths and hides internals', async () => {
    const missing = await get('/_mallok/whatever');
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('{"error":"Not found."}');
  });
});
