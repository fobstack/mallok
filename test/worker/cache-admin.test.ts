import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { postPurgeAll } from '../../src/worker/admin-cache.js';
import { purgeNow } from '../../src/worker/cache.js';

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

  describe('with a purge token', () => {
    const withToken = {
      ...env,
      CF_API_TOKEN: 'fixture-token',
      CF_ZONE_ID: 'zone',
    } as typeof env;
    const realFetch = globalThis.fetch;
    const answer = (reply: () => Response | Promise<Response>): void => {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.startsWith('https://api.cloudflare.com/')) {
          throw new Error(`Unexpected outbound fetch: ${url}`);
        }
        return reply();
      }) as typeof fetch;
    };
    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    it('reports success when Cloudflare purged', async () => {
      answer(() => new Response('{"success":true,"errors":[]}'));
      const response = await postPurgeAll(withToken);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ purged: true, attempted: true });
    });

    it.each([
      [
        'an HTTP refusal',
        () =>
          new Response(
            '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}',
            { status: 403 },
          ),
        /HTTP 403.*Zone → Cache Purge → Purge.*not Cache Rules.*Authentication error/,
      ],
      [
        'a 200 whose body says it failed',
        () =>
          new Response(
            '{"success": false,"errors":[{"message":"Rate limited"}]}',
          ),
        /HTTP 200.*Rate limited/,
      ],
      [
        'no answer at all',
        () => {
          throw new Error('network unreachable');
        },
        /did not purge the cache\. .*network unreachable/,
      ],
    ] as [string, () => Response, RegExp][])(
      'says the cache was not cleared, and logs it, on %s',
      async (_name, reply, message) => {
        const logged = vi
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);
        answer(reply);
        const response = await postPurgeAll(withToken);
        // Not a 200 with a cheerful body: the admin shows this as an error.
        expect(response.status).toBe(502);
        expect(((await response.json()) as { error: string }).error).toMatch(
          message,
        );
        expect(
          logged.mock.calls.map(
            (call) => (JSON.parse(String(call[0])) as { event: string }).event,
          ),
        ).toEqual(['purge_failed']);
      },
    );

    it('records a failed background purge for the admin, and a whole-site purge forgets it', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const health = async () =>
        (
          (await (await api('GET', '/_mallok/api/health')).json()) as {
            lastPurgeFailure: unknown;
          }
        ).lastPurgeFailure;
      // The failures asserted above were recorded; start from a clean slate.
      answer(() => new Response('{"success":true,"errors":[]}'));
      await postPurgeAll(withToken);
      expect(await health()).toBeNull();

      answer(
        () =>
          new Response(
            '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}',
            { status: 403 },
          ),
      );
      const failed = await purgeNow(
        withToken,
        ['c:1', 'k:article:en'],
        'plugin:pricing',
      );
      expect(failed.ok).toBe(false);
      expect(await health()).toMatchObject({
        source: 'plugin:pricing',
        status: 403,
        tags: 2,
        detail: expect.stringContaining('Authentication error'),
        advice: expect.stringContaining('Cache Purge'),
      });

      // A purge that worked but named only some pages cannot vouch for the
      // rest: the record stays.
      answer(() => new Response('{"success":true,"errors":[]}'));
      expect((await purgeNow(withToken, ['c:2'], 'content')).ok).toBe(true);
      expect(await health()).toMatchObject({ source: 'plugin:pricing' });

      // Every page purged: nothing the failure left stale can remain.
      const manual = await postPurgeAll(withToken);
      expect(manual.status).toBe(200);
      expect(await health()).toBeNull();
    });

    it('logs a failed background purge too, where nobody is waiting for it', async () => {
      const logged = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      answer(() => new Response('{"success":false}', { status: 401 }));
      const result = await purgeNow(withToken, ['site', 'c:1'], 'content');
      expect(result.ok).toBe(false);
      expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
        event: 'purge_failed',
        source: 'content',
        status: 401,
        tags: 2,
      });
    });
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
