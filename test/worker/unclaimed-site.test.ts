import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { cacheKeyFor, purgeTags } from '../../src/worker/cache.js';
import worker from '../../src/worker/index.js';

/**
 * What a site serves before anyone owns it, and what clears the cache when
 * its owner changes something (docs/ARCHITECTURE.md §6).
 *
 * The first thing anyone does with a fresh deployment is open its address.
 * That page used to be stored for the default cache lifetime, an hour, so the
 * owner set the site up and went on being served "My Mallok site" — with
 * nothing to purge it where no purge token is bound, which is every local
 * run.
 */

const ORIGIN = 'https://unclaimed.example';
const EMAIL = 'owner@example.com';
const PASSWORD = 'a sufficiently long password';

/** Runs a request through the Worker and waits for what it left running. */
async function through(
  request: Request,
  bindings: typeof env = env,
): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch?.(request as never, bindings, {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext);
  await Promise.all(pending);
  if (response === undefined) {
    throw new Error('the Worker has a fetch handler');
  }
  return response;
}

function stored(path: string): Promise<Response | undefined> {
  return caches.default.match(cacheKeyFor(new Request(`${ORIGIN}${path}`)));
}

// The home page, a kind's list, and the three SEO endpoints.
const PUBLIC = ['/', '/news', '/sitemap.xml', '/robots.txt', '/feed.xml'];

describe('a site nobody has claimed', () => {
  let cookie = '';
  let csrf = '';

  it('serves its pages and stores none of them', async () => {
    for (const path of PUBLIC) {
      const first = await through(new Request(`${ORIGIN}${path}`));
      expect(first.status).toBe(200);
      await first.text();
      expect(await stored(path)).toBeUndefined();
    }
    const home = await through(new Request(`${ORIGIN}/`));
    expect(home.headers.get('x-mallok-cache')).not.toBe('HIT');
    expect(home.headers.get('cache-control')).toBe('private, no-store');
    expect(home.headers.get('cache-tag')).toBeNull();
    expect(await home.text()).toContain('My Mallok site');
  });

  it('is marked claimed by creating its administrator, in the same batch', async () => {
    const before = await env.DB.prepare(
      'SELECT claimed_at FROM site WHERE id = 1',
    ).first<{ claimed_at: string | null }>();
    expect(before?.claimed_at).toBeNull();

    const created = await SELF.fetch(`${ORIGIN}/_mallok/api/setup/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect([200, 201]).toContain(created.status);
    const after = await env.DB.prepare(
      `SELECT site.claimed_at AS site, setup_claim.claimed_at AS claim
       FROM site, setup_claim WHERE site.id = 1`,
    ).first<{ site: string | null; claim: string }>();
    expect(after?.site).toBe(after?.claim);

    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    cookie = (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    csrf = ((await session.json()) as { csrf: string }).csrf;
  });

  it('shows the owner their site, not the placeholder, the moment it is set up', async () => {
    const named = await SELF.fetch(`${ORIGIN}/_mallok/api/setup/site`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Titan Works',
        defaultLocale: 'en',
        locales: ['en'],
      }),
    });
    expect(named.status).toBe(200);
    // No purge token is bound here, as in any local run: nothing was purged,
    // and nothing needed to be.
    const home = await through(new Request(`${ORIGIN}/`));
    const html = await home.text();
    expect(html).toContain('Titan Works');
    expect(html).not.toContain('My Mallok site');
  });

  it('stores pages from then on', async () => {
    for (const path of PUBLIC) {
      await (await through(new Request(`${ORIGIN}${path}`))).text();
      expect(await stored(path), path).toBeDefined();
    }
    const again = await through(new Request(`${ORIGIN}/`));
    expect(again.headers.get('x-mallok-cache')).toBe('HIT');
  });

  // Each purge waits out the two-second window in which purges are coalesced.
  it('purges the whole site when a plugin is switched or a setting changes, given a token', {
    timeout: 30_000,
  }, async () => {
    await purgeTags(env, []);
    const purged: string[][] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith('https://api.cloudflare.com/')) {
        throw new Error(`Unexpected outbound fetch: ${url}`);
      }
      purged.push((JSON.parse(String(init?.body)) as { tags: string[] }).tags);
      return new Response('{"success":true}', { status: 200 });
    }) as typeof fetch;
    const withToken = {
      ...env,
      CF_API_TOKEN: 'fixture-token',
      CF_ZONE_ID: 'zone',
    } as typeof env;
    const send = (method: string, path: string, body: unknown) =>
      through(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: {
            cookie,
            'x-mallok-csrf': csrf,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        withToken,
      );
    try {
      for (const enabled of [true, false]) {
        const switched = await send(
          'POST',
          '/_mallok/api/plugins/inquiry/enabled',
          { enabled },
        );
        expect(switched.status).toBe(200);
      }
      const patched = await send('PATCH', '/_mallok/api/settings', {
        nav: { en: [{ label: 'News', href: '/news' }] },
      });
      expect(patched.status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
    // On, off, and the navigation: each asked Cloudflare to drop every page.
    expect(purged).toEqual([['site'], ['site'], ['site']]);
  });
});
