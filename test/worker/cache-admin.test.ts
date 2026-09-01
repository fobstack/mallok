import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Cache maintenance (docs/ADMIN.md §11).
 *
 * The property worth asserting is that clearing loses nothing: `render_cache`
 * is derived from the Markdown that produced it (docs/DATA_MODEL.md §4), so
 * emptying it must leave every page still renderable.
 */

const ORIGIN = 'https://cache-admin.example';
const EMAIL = 'cache@example.com';
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

describe('cache maintenance', () => {
  let path = '';

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
        name: 'cache',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    const created = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'cached-page',
      markdown: '---\ntitle: Cached\n---\n\nBody that must survive.',
    });
    path = ((await created.json()) as { path: string }).path;
  });

  it('empties the fragment cache without losing anything', async () => {
    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM render_cache',
    ).first<{ n: number }>();
    expect(before?.n).toBeGreaterThan(0);

    const cleared = await api('POST', '/_mallok/api/cache/fragments');
    expect(cleared.status).toBe(200);
    const result = (await cleared.json()) as { cleared: number; note: string };
    expect(result.cleared).toBe(before?.n);
    expect(result.note).toContain('rebuilt');

    const after = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM render_cache',
    ).first<{ n: number }>();
    expect(after?.n).toBe(0);

    // The page still renders, and regenerating refills the cache.
    await caches.default.delete(new Request(`${ORIGIN}${path}`));
    const page = await SELF.fetch(`${ORIGIN}${path}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('x-mallok-fragment')).toBe('REGENERATED');
    expect(await page.text()).toContain('Body that must survive.');
  });

  it('says plainly when it cannot purge rather than claiming success', async () => {
    // No CF_API_TOKEN in this environment: an honest degradation, not a
    // failure (docs/CLOUDFLARE_RESOURCES.md §6).
    const response = await api('POST', '/_mallok/api/cache/purge');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      purged: boolean;
      attempted: boolean;
      note?: string;
    };
    expect(body.purged).toBe(false);
    expect(body.attempted).toBe(false);
    expect(body.note).toContain('No cache-purge token');
  });

  it('needs the settings scope', async () => {
    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie =
      (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { csrf } = (await session.json()) as { csrf: string };
    const weak = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'weak', scopes: ['content:write'] }),
    });
    const weakToken = ((await weak.json()) as { token: string }).token;
    const refused = await SELF.fetch(`${ORIGIN}/_mallok/api/cache/purge`, {
      method: 'POST',
      headers: { authorization: `Bearer ${weakToken}` },
    });
    expect(refused.status).toBe(403);
  });
});
