import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Prefixing the default locale too (Task 49, itick M2; docs/ARCHITECTURE.md
 * §9): every page under `/<locale>`, the root a fixed 301 to the default
 * locale's home, and no unprefixed address serving a second copy of a page.
 */

const ORIGIN = 'https://prefix.example';
const EMAIL = 'prefix@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function save(input: Record<string, unknown>): Promise<{
  id: string;
  path: string;
  translationGroup: string;
}> {
  const response = await api('POST', '/_mallok/api/content', input);
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as {
    id: string;
    path: string;
    translationGroup: string;
  };
}

/** A fresh response: the edge cache is emptied first, as a purge would. */
async function get(path: string): Promise<Response> {
  await caches.default.delete(new Request(`${ORIGIN}${path}`));
  return SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
}

async function storedPath(id: string): Promise<string | undefined> {
  const row = await env.DB.prepare('SELECT path FROM content WHERE id = ?')
    .bind(id)
    .first<{ path: string }>();
  return row?.path;
}

function canonicalOf(html: string): string | undefined {
  return /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
}

function alternatesOf(html: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of html.matchAll(
    /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g,
  )) {
    found[match[1] ?? ''] = match[2] ?? '';
  }
  return found;
}

describe('prefixDefaultLocale', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await SELF.fetch(`${ORIGIN}/`);
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
    const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'prefix',
        scopes: ['content:write', 'settings:write', 'export'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    expect(
      (
        await api('PATCH', '/_mallok/api/settings', {
          locales: ['en', 'zh'],
          kinds: {
            page: { base: '' },
            article: { base: 'notes' },
            product: { base: 'products' },
          },
        })
      ).status,
    ).toBe(200);

    const about = await save({
      kind: 'page',
      slug: 'about',
      markdown: '---\ntitle: About\n---\n\nAbout us.',
    });
    ids.about = about.id;
    ids.aboutZh = (
      await save({
        kind: 'page',
        locale: 'zh',
        slug: 'about',
        translationGroup: about.translationGroup,
        markdown: '---\ntitle: 关于\n---\n\n关于我们。',
      })
    ).id;
    const hello = await save({
      kind: 'article',
      slug: 'old-hello',
      markdown:
        '---\ntitle: Hello\ndate: 2026-01-02T00:00:00Z\ntags: [alpha]\n---\n\nBody.',
    });
    ids.hello = hello.id;
    // A slug that moved before the setting changed: its redirect must keep
    // pointing at the item, in one hop, whatever happens next.
    // The body changes too: a save whose only change is the slug is taken
    // for "unchanged" (a separate defect, recorded in docs/tasks/TASK-49.md).
    await save({
      id: hello.id,
      kind: 'article',
      slug: 'hello',
      markdown:
        '---\ntitle: Hello\ndate: 2026-01-02T00:00:00Z\ntags: [alpha]\n---\n\nBody, renamed.',
    });
    ids.helloZh = (
      await save({
        kind: 'article',
        locale: 'zh',
        slug: 'hello',
        translationGroup: hello.translationGroup,
        markdown:
          '---\ntitle: 你好\ndate: 2026-01-02T00:00:00Z\ntags: [alpha]\n---\n\n正文。',
      })
    ).id;
  });

  it('is off by default, and reported by the settings API', async () => {
    const settings = (await (
      await api('GET', '/_mallok/api/settings')
    ).json()) as { prefixDefaultLocale: boolean };
    expect(settings.prefixDefaultLocale).toBe(false);
    expect(await storedPath(ids.about ?? '')).toBe('/about');
  });

  it('cannot be changed in passing by PATCH /settings', async () => {
    const response = await api('PATCH', '/_mallok/api/settings', {
      prefixDefaultLocale: true,
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('settings/locale-prefix');
  });

  it('needs an explicit confirmation, because it rewrites every URL', async () => {
    const response = await api('POST', '/_mallok/api/settings/locale-prefix', {
      enabled: true,
    });
    expect(response.status).toBe(400);
    expect(await storedPath(ids.about ?? '')).toBe('/about');
  });

  it('moves every default-locale path under its prefix, with a redirect from each', async () => {
    const response = await api('POST', '/_mallok/api/settings/locale-prefix', {
      enabled: true,
      confirm: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      prefixDefaultLocale: true,
      moved: 2,
      redirects: 2,
    });
    expect(await storedPath(ids.about ?? '')).toBe('/en/about');
    expect(await storedPath(ids.hello ?? '')).toBe('/en/notes/hello');
    // Other locales were prefixed already.
    expect(await storedPath(ids.aboutZh ?? '')).toBe('/zh/about');
    expect(await storedPath(ids.helloZh ?? '')).toBe('/zh/notes/hello');
  });

  it('answers the root with a fixed 301 to the default locale, never a page', async () => {
    const root = await get('/');
    expect(root.status).toBe(301);
    expect(root.headers.get('location')).toBe(`${ORIGIN}/en`);
    // A redirect is not stored: switching the setting off must take effect.
    expect(root.headers.get('x-mallok-cache')).not.toBe('MISS');
  });

  it('serves each home under its prefix, with prefixed alternates', async () => {
    const home = await get('/en');
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(canonicalOf(html)).toBe(`${ORIGIN}/en`);
    expect(alternatesOf(html)).toEqual({
      en: `${ORIGIN}/en`,
      zh: `${ORIGIN}/zh`,
      'x-default': `${ORIGIN}/en`,
    });
    expect(canonicalOf(await (await get('/zh')).text())).toBe(`${ORIGIN}/zh`);
  });

  it('serves content at the prefixed path, and redirects the old one', async () => {
    const page = await get('/en/about');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(canonicalOf(html)).toBe(`${ORIGIN}/en/about`);
    expect(alternatesOf(html)).toEqual({
      en: `${ORIGIN}/en/about`,
      zh: `${ORIGIN}/zh/about`,
      'x-default': `${ORIGIN}/en/about`,
    });
    const old = await get('/about');
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe(`${ORIGIN}/en/about`);
    // The slug that moved earlier still takes one hop, to the new place.
    const older = await get('/notes/old-hello');
    expect(older.status).toBe(301);
    expect(older.headers.get('location')).toBe(`${ORIGIN}/en/notes/hello`);
  });

  it('serves lists and tag archives only under a prefix', async () => {
    const list = await get('/en/notes');
    expect(list.status).toBe(200);
    const html = await list.text();
    expect(canonicalOf(html)).toBe(`${ORIGIN}/en/notes`);
    expect(alternatesOf(html)).toMatchObject({
      en: `${ORIGIN}/en/notes`,
      zh: `${ORIGIN}/zh/notes`,
    });
    expect(html).toContain('href="/en/notes/hello"');
    expect((await get('/notes')).status).toBe(404);
    expect((await get('/notes/page/2')).status).toBe(404);

    const tag = await get('/en/tags/alpha');
    expect(tag.status).toBe(200);
    expect(canonicalOf(await tag.text())).toBe(`${ORIGIN}/en/tags/alpha`);
    expect((await get('/tags/alpha')).status).toBe(404);
  });

  it('gives templates the prefixed home path', async () => {
    const html = await (await get('/en/notes/hello')).text();
    // site.home_path, as Atelier's header prints it. `site.kinds` is
    // covered in test/core/view.test.ts.
    expect(html).toContain('class="brand" href="/en"');
  });

  it('lists only prefixed URLs in the sitemap, x-default included', async () => {
    const sitemap = await (await get('/sitemap.xml')).text();
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(locs.sort()).toEqual(
      [
        `${ORIGIN}/en/about`,
        `${ORIGIN}/en/notes/hello`,
        `${ORIGIN}/zh/about`,
        `${ORIGIN}/zh/notes/hello`,
      ].sort(),
    );
    expect(sitemap).toContain(`hreflang="x-default" href="${ORIGIN}/en/about"`);
  });

  it('moves the default feed under the prefix', async () => {
    const old = await get('/feed.xml');
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe(`${ORIGIN}/en/feed.xml`);
    const feed = await get('/en/feed.xml');
    expect(feed.status).toBe(200);
    const xml = await feed.text();
    expect(xml).toContain(`<link>${ORIGIN}/en</link>`);
    expect(xml).toContain(`href="${ORIGIN}/en/feed.xml"`);
    expect(xml).toContain(`<link>${ORIGIN}/en/notes/hello</link>`);
  });

  it('saves new content at a prefixed path, with no unprefixed copy', async () => {
    const created = await save({
      kind: 'page',
      slug: 'pricing',
      markdown: '---\ntitle: Pricing\n---\n\nPlans.',
    });
    expect(created.path).toBe('/en/pricing');
    expect((await get('/en/pricing')).status).toBe(200);
    expect((await get('/pricing')).status).toBe(404);
    ids.pricing = created.id;
  });

  it('records the setting in an export, so a restore puts URLs back where they were', async () => {
    const exported = (await (
      await api('GET', '/_mallok/api/export')
    ).json()) as {
      files: { path: string; text?: string }[];
    };
    const site = exported.files.find((file) => file.path === 'site.json');
    expect(JSON.parse(site?.text ?? '{}')).toMatchObject({
      defaultLocale: 'en',
      prefixDefaultLocale: true,
    });
  });

  it("sends the inquiry form's visitor to the prefixed thank-you page", async () => {
    await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: true,
    });
    await api('PATCH', '/_mallok/api/plugins/inquiry/settings', {
      recipient: 'sales@example.com',
      thanks_path: '/thank-you',
    });
    const response = await SELF.fetch(`${ORIGIN}/_mallok/p/inquiry/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        name: 'Ada Buyer',
        email: 'buyer@example.net',
        message: 'A question.',
        locale: 'en',
        source_path: '/en/about',
        website: '',
      }).toString(),
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/en/thank-you`);
  });

  it('switches back, moving every path home and leaving no loop', async () => {
    const response = await api('POST', '/_mallok/api/settings/locale-prefix', {
      enabled: false,
      confirm: true,
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { moved: number }).moved).toBe(3);
    expect(await storedPath(ids.about ?? '')).toBe('/about');
    expect(await storedPath(ids.pricing ?? '')).toBe('/pricing');

    const page = await get('/about');
    expect(page.status).toBe(200);
    expect(canonicalOf(await page.text())).toBe(`${ORIGIN}/about`);
    const moved = await get('/en/about');
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe(`${ORIGIN}/about`);
    // `/about` is content again: the redirect from it is gone, not shadowed.
    const leftover = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM redirect WHERE from_path IN ('/about', '/pricing', '/notes/hello')",
    ).first<{ n: number }>();
    expect(leftover?.n).toBe(0);
    const older = await get('/notes/old-hello');
    expect(older.headers.get('location')).toBe(`${ORIGIN}/notes/hello`);
    expect((await get('/')).status).toBe(200);
  });

  it('refuses the change when a moved path would land on an existing one', async () => {
    // Slug rules keep this from happening through the API, so force it: an
    // item that does not move already holds the path another moves to.
    await env.DB.prepare('UPDATE content SET path = ? WHERE id = ?')
      .bind('/en/about', ids.aboutZh)
      .run();
    const response = await api('POST', '/_mallok/api/settings/locale-prefix', {
      enabled: true,
      confirm: true,
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('/en/about');
    // Nothing was written.
    expect(await storedPath(ids.about ?? '')).toBe('/about');
    const settings = (await (
      await api('GET', '/_mallok/api/settings')
    ).json()) as { prefixDefaultLocale: boolean };
    expect(settings.prefixDefaultLocale).toBe(false);
  });
});
