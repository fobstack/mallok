import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOME_RECENT } from '../../src/core/index.js';
import { listRecentByKind } from '../../src/db/queries.js';
import { tagsForContent } from '../../src/worker/cache.js';

/**
 * `recent.<kind>` on the home page (docs/THEME_FORMAT.md §7.4).
 *
 * The Worker's home page used to load published articles only, so a theme's
 * `recent.product` was always empty: Atelier's product section never appeared
 * on a served site, though `mallok build` showed it for the same content.
 */
const ORIGIN = 'https://home-recent.example';
const EMAIL = 'home@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

async function api(method: string, path: string, body?: unknown) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function coldHome(): Promise<Response> {
  await caches.default.delete(new Request(`${ORIGIN}/`));
  return SELF.fetch(`${ORIGIN}/`);
}

describe('the home page lists every kind the theme lists', () => {
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
        name: 'home',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    await api('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: 'products' },
      },
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'a-note',
      markdown: '---\ntitle: A note from the mill\n---\n\nText.',
    });
  });

  it('shows a published product on the home page', async () => {
    await api('POST', '/_mallok/api/content', {
      kind: 'product',
      slug: 'seamless-tube',
      markdown: '---\ntitle: Seamless tube alpha\n---\n\nA product.',
    });

    const home = await (await coldHome()).text();
    // Atelier's home reads `recent.product`.
    expect(home).toContain('Seamless tube alpha');
    expect(home).toContain('href="/products/seamless-tube"');
  });

  it('holds at most ten items per kind, newest first, in one batch', async () => {
    for (let index = 1; index <= 11; index++) {
      const day = String(index).padStart(2, '0');
      await api('POST', '/_mallok/api/content', {
        kind: 'product',
        slug: `bar-${day}`,
        markdown: `---\ntitle: Bar number ${day}\ndate: 2026-01-${day}\n---\n\nA bar.`,
      });
    }

    // Twelve products now. Atelier shows three, so the bound is asserted on
    // what the page is given rather than on what one theme draws.
    const recent = await listRecentByKind(
      env.DB,
      ['product', 'article', 'page'],
      'en',
      HOME_RECENT,
      new Date().toISOString(),
    );
    expect(recent.product).toHaveLength(10);
    expect(recent.product?.[0]?.slug).toBe('seamless-tube');
    expect(recent.product?.map((row) => row.slug)).not.toContain('bar-01');
    expect(recent.product?.map((row) => row.slug)).not.toContain('bar-02');
    expect(recent.article?.map((row) => row.slug)).toEqual(['a-note']);
    expect(recent.page).toEqual([]);
  });

  it('is purged by a change to any kind', async () => {
    const home = await coldHome();
    expect(home.headers.get('cache-tag')).toContain('home:en');
    // Every content change carries the home tag of its locale, whatever the
    // kind, so a new product reaches the home page without waiting for the
    // cache to expire.
    for (const kind of ['article', 'product', 'page']) {
      expect(tagsForContent('id', kind, 'en')).toContain('home:en');
    }
  });
});
