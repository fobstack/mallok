import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { definePlugin } from '../../src/plugins/define.js';
import { postPurgeAll } from '../../src/worker/admin-cache.js';
import { purgeNow, purgeTags } from '../../src/worker/cache.js';
import { buildPluginContext } from '../../src/worker/plugin-runtime.js';

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
        const body = (await response.json()) as {
          error: string;
          code: string;
          params: { status: string | number; detail: string };
        };
        expect(body.error).toMatch(message);
        // Named for the admin, with Cloudflare's own words as a parameter
        // (docs/ADMIN_I18N_AND_UI.md, D3).
        expect(body.code).toMatch(/^cache\.purge_(refused|limited|failed)$/);
        expect(body.error).toContain(body.params.detail);
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

    it('counts only an envelope that says success: a 200 that is not Cloudflare JSON fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      answer(() => new Response('<html>Proxy says hello</html>'));
      const result = await purgeNow(withToken, ['c:9'], 'content');
      expect(result).toMatchObject({ attempted: true, ok: false, status: 200 });
      answer(() => new Response('{"errors":[]}'));
      expect((await purgeNow(withToken, ['c:9'], 'content')).ok).toBe(false);
    });

    it('keeps a failure recorded while a whole-site purge was in flight', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const stored = async () =>
        (
          await env.DB.prepare(
            'SELECT last_purge_failure AS f FROM site WHERE id = 1',
          ).first<{ f: string | null }>()
        )?.f ?? null;
      // A failure stamped after the purge below starts: it concerns a change
      // that purge may not have covered.
      const later = JSON.stringify({
        at: new Date(Date.now() + 60_000).toISOString(),
        source: 'plugin:pricing',
        tags: 1,
        detail: 'refused',
      });
      await env.DB.prepare(
        'UPDATE site SET last_purge_failure = ? WHERE id = 1',
      )
        .bind(later)
        .run();
      answer(() => new Response('{"success":true,"errors":[]}'));
      expect((await purgeNow(withToken, ['site'], 'manual')).ok).toBe(true);
      expect(await stored()).toBe(later);

      // One stamped before it is what a whole-site purge replaces.
      const earlier = JSON.stringify({
        at: new Date(Date.now() - 60_000).toISOString(),
        source: 'content',
        tags: 1,
        detail: 'refused',
      });
      await env.DB.prepare(
        'UPDATE site SET last_purge_failure = ? WHERE id = 1',
      )
        .bind(earlier)
        .run();
      expect((await purgeNow(withToken, ['site'], 'manual')).ok).toBe(true);
      expect(await stored()).toBeNull();
    });

    it('forgets a failure once no token is configured, since nothing can fail', async () => {
      await env.DB.prepare(
        'UPDATE site SET last_purge_failure = ? WHERE id = 1',
      )
        .bind(
          JSON.stringify({
            at: new Date(Date.now() - 1000).toISOString(),
            source: 'content',
            tags: 1,
            detail: 'refused',
          }),
        )
        .run();
      const result = await purgeNow(env, ['site'], 'content');
      expect(result.attempted).toBe(false);
      const row = await env.DB.prepare(
        'SELECT last_purge_failure AS f FROM site WHERE id = 1',
      ).first<{ f: string | null }>();
      expect(row?.f).toBeNull();
    });

    it("keeps a plugin's purge alive when the plugin does not wait for it, and tells it a failure", async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // Purges are coalesced per isolate and flushed with the environment of
      // the first caller. Let whatever earlier requests queued go out first.
      await purgeTags(env, [], 'content');
      const kept: Promise<unknown>[] = [];
      const pricing = definePlugin({
        manifest: { id: 'pricing', name: 'Pricing', version: '1.0.0' },
      });
      const ctx = await buildPluginContext(
        withToken,
        {
          waitUntil: (promise: Promise<unknown>) => {
            kept.push(promise);
          },
          passThroughOnException: () => undefined,
          props: {},
        } as unknown as ExecutionContext,
        {} as never,
        {
          plugin: pricing,
          settings: {},
          state: {
            plugin_id: 'pricing',
            enabled: 1,
            version: '1.0.0',
            settings: '{}',
            secrets: '{}',
            updated_at: '',
          },
        },
      );
      answer(
        () =>
          new Response(
            '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}',
            { status: 403 },
          ),
      );
      // Called and not awaited, the way a fire-and-forget plugin would.
      const outcome = ctx.purgeTags(['prices']);
      expect(kept).toHaveLength(1);
      await Promise.all(kept);
      expect(await outcome).toEqual({
        attempted: true,
        ok: false,
        status: 403,
      });
    });

    it('recovers when a scheduled flush was lost, and sends what it held', async () => {
      const logged = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const sent: string[][] = [];
      globalThis.fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        sent.push((JSON.parse(String(init?.body)) as { tags: string[] }).tags);
        return new Response('{"success":true,"errors":[]}');
      }) as typeof fetch;
      vi.useFakeTimers();
      try {
        // A flush whose timer never fires: its request ended without keeping
        // it alive.
        void purgeTags(withToken, ['lost'], 'plugin:pricing');
        vi.clearAllTimers();
        vi.setSystemTime(Date.now() + 15_000);
        const next = purgeTags(withToken, ['next'], 'content');
        await vi.advanceTimersByTimeAsync(2_000);
        expect((await next).ok).toBe(true);
      } finally {
        vi.useRealTimers();
      }
      expect(sent).toEqual([['lost', 'next']]);
      expect(
        logged.mock.calls.map(
          (call) => (JSON.parse(String(call[0])) as { event: string }).event,
        ),
      ).toContain('purge_flush_lost');
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
