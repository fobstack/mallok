/**
 * What may reach a shared cache.
 *
 * These are the rules that, if broken, serve one visitor's page to another —
 * so they are tested against the handler itself with a counting cache, and
 * assert the *absence* of cache traffic rather than only the response header.
 * A `BYPASS` label with a `put()` behind it would still be a leak.
 */

import { describe, expect, it } from 'vitest';
import {
  createPageHandler,
  type PageCache,
} from '../../src/runtime/cloudflare/index.js';
import { Runtime } from '../../src/runtime/core/runtime.js';
import type {
  PageModule,
  RouteManifest,
} from '../../src/runtime/core/types.js';

interface Env {
  readonly nothing?: never;
}

/** A cache that records every call, so "never asked" is testable. */
function countingCache(): PageCache & {
  readonly matches: Request[];
  readonly puts: Request[];
} {
  const matches: Request[] = [];
  const puts: Request[] = [];
  const store = new Map<string, Response>();
  return {
    matches,
    puts,
    async match(request) {
      matches.push(request);
      const hit = store.get(request.url);
      return hit === undefined ? undefined : hit.clone();
    },
    async put(request, response) {
      puts.push(request);
      store.set(request.url, response.clone());
    },
  };
}

function context(): ExecutionContext {
  return {
    waitUntil: (promise: Promise<unknown>) => void promise,
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
}

function manifestFor(page: PageModule): RouteManifest {
  return {
    routes: [{ pattern: '/[...rest]', load: () => Promise.resolve(page) }],
  };
}

const PUBLIC_PAGE: PageModule = {
  render: () => '<main>public</main>',
  cache: () => ({ mode: 'public', edgeSeconds: 60, tags: ['home'] }),
};

/** A page that is public by policy but whose response must not be shared. */
function pageWithHeaders(headers: Record<string, string>): PageModule {
  return {
    render: () => ({ body: '<main>hi</main>', headers }),
    cache: () => ({ mode: 'public', edgeSeconds: 60, tags: ['home'] }),
  };
}

function handlerFor(
  page: PageModule,
  cache: PageCache,
  cacheKey?: (request: Request) => Request,
) {
  return createPageHandler<Env, unknown>({
    runtime: new Runtime(manifestFor(page)),
    cache,
    ...(cacheKey === undefined ? {} : { cacheKey }),
  });
}

describe('a request that carries credentials', () => {
  it('is never read from or written to the shared cache', async () => {
    for (const header of [
      { cookie: 'session=abc' },
      { authorization: 'Bearer token' },
    ]) {
      const cache = countingCache();
      const handle = handlerFor(PUBLIC_PAGE, cache);
      const response = await handle(
        new Request('https://x.test/', { headers: header }),
        {},
        context(),
      );

      expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
      expect(cache.matches).toHaveLength(0);
      expect(cache.puts).toHaveLength(0);
      // A tag on an uncached response is a purge target that does not exist.
      expect(response.headers.get('cache-tag')).toBeNull();
      expect(response.headers.get('cache-control')).not.toContain('public');
    }
  });

  it('cannot be laundered by a cacheKey that drops the headers', async () => {
    // The real hazard: a product normalises the key by rebuilding the request,
    // which silently discards Cookie and Authorization. Eligibility must be
    // decided from the request as it arrived, not from the key.
    const cache = countingCache();
    const handle = handlerFor(PUBLIC_PAGE, cache, (request) => {
      const url = new URL(request.url);
      url.search = '';
      return new Request(url.toString(), { method: 'GET' });
    });

    const response = await handle(
      new Request('https://x.test/?utm_source=x', {
        headers: { authorization: 'Bearer token' },
      }),
      {},
      context(),
    );

    expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
    expect(cache.matches).toHaveLength(0);
    expect(cache.puts).toHaveLength(0);
  });
});

describe('a response that must not be shared', () => {
  const hostile: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['cache-control: private', { 'cache-control': 'private, max-age=60' }],
    ['cache-control: no-store', { 'cache-control': 'no-store' }],
    ['set-cookie', { 'set-cookie': 'session=abc; Path=/' }],
    ['vary: *', { vary: '*' }],
  ];

  for (const [name, headers] of hostile) {
    it(`is not stored when it carries ${name}`, async () => {
      const cache = countingCache();
      const handle = handlerFor(pageWithHeaders(headers), cache);
      const response = await handle(
        new Request('https://x.test/'),
        {},
        context(),
      );

      expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
      expect(cache.puts).toHaveLength(0);
      expect(response.headers.get('cache-tag')).toBeNull();
      // The page's own refusal outranks the policy it declared: overwriting
      // `private` with `public` is what would let a CDN keep it.
      expect(response.headers.get('cache-control')).not.toContain('public');
    });
  }
});

describe('an ordinary public page', () => {
  it('is still stored, tagged and served from the cache', async () => {
    const cache = countingCache();
    const handle = handlerFor(PUBLIC_PAGE, cache);
    const url = 'https://x.test/';

    const miss = await handle(new Request(url), {}, context());
    expect(miss.headers.get('x-runtime-cache')).toBe('MISS');
    expect(miss.headers.get('cache-tag')).toBe('home');
    expect(miss.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=60',
    );
    expect(cache.puts).toHaveLength(1);

    const hit = await handle(new Request(url), {}, context());
    expect(hit.headers.get('x-runtime-cache')).toBe('HIT');
  });
});

describe('Cache-Control is read case-insensitively', () => {
  // HTTP field values are case-insensitive, and real frameworks emit `Private`
  // and `no-cache, No-Store` alike. A case-sensitive check silently caches
  // every one of them.
  const spellings = [
    'Private',
    'NO-STORE',
    'pRiVaTe',
    'public, Private, max-age=60',
    'max-age=60, No-Store',
  ];

  for (const spelling of spellings) {
    it(`refuses to store a response saying "${spelling}"`, async () => {
      const cache = countingCache();
      const handle = handlerFor(
        pageWithHeaders({ 'cache-control': spelling }),
        cache,
      );
      const response = await handle(
        new Request('https://x.test/'),
        {},
        context(),
      );

      expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
      expect(cache.puts).toHaveLength(0);
      expect(response.headers.get('cache-tag')).toBeNull();
      expect(response.headers.get('cache-control')?.toLowerCase()).not.toMatch(
        /(^|[\s,])public([\s,;]|$)/,
      );
    });
  }
});

/**
 * The case that matters most, and the one a `put()`-count alone would miss.
 *
 * The page deliberately declares itself publicly cacheable for an hour. Each
 * of these reasons must not only keep it out of *our* cache, but strip that
 * permission from the response — otherwise the visitor's browser, or any
 * intermediary between us and them, keeps a page it should never hold.
 */
describe('a BYPASS never leaves carrying public cache permission', () => {
  const publicPage = pageWithHeaders({
    'cache-control': 'public, max-age=3600',
  });

  const cases: ReadonlyArray<
    readonly [string, { request?: Record<string, string>; page?: PageModule }]
  > = [
    [
      'the request carried Authorization',
      {
        request: { authorization: 'Bearer token' },
      },
    ],
    ['the request carried a Cookie', { request: { cookie: 'session=abc' } }],
    [
      'the response sets a cookie',
      {
        page: pageWithHeaders({
          'cache-control': 'public, max-age=3600',
          'set-cookie': 'session=abc; Path=/',
        }),
      },
    ],
    [
      'the response varies on everything',
      {
        page: pageWithHeaders({
          'cache-control': 'public, max-age=3600',
          vary: '*',
        }),
      },
    ],
    [
      'the response says private',
      {
        page: pageWithHeaders({
          'cache-control': 'public, max-age=3600, private',
        }),
      },
    ],
    [
      'the policy is no-store',
      {
        page: {
          render: () => ({
            body: '<main>hi</main>',
            headers: { 'cache-control': 'public, max-age=3600' },
          }),
          cache: () => ({ mode: 'no-store' }),
        },
      },
    ],
    [
      'the status forbids sharing',
      {
        page: {
          render: () => ({
            body: '<main>gone</main>',
            status: 410,
            headers: { 'cache-control': 'public, max-age=3600' },
          }),
          cache: () => ({ mode: 'public', edgeSeconds: 60, tags: ['home'] }),
        },
      },
    ],
  ];

  for (const [reason, setup] of cases) {
    it(`strips it when ${reason}`, async () => {
      const cache = countingCache();
      const handle = handlerFor(setup.page ?? publicPage, cache);
      const response = await handle(
        new Request('https://x.test/', {
          ...(setup.request === undefined ? {} : { headers: setup.request }),
        }),
        {},
        context(),
      );

      expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
      expect(cache.matches).toHaveLength(setup.request === undefined ? 1 : 0);
      expect(cache.puts).toHaveLength(0);
      expect(response.headers.get('cache-tag')).toBeNull();

      const control = (
        response.headers.get('cache-control') ?? ''
      ).toLowerCase();
      expect(control).not.toMatch(/(^|[\s,])public([\s,;]|$)/);
      expect(control).toMatch(/(^|[\s,])(private|no-store)([\s,;]|$)/);
    });
  }
});

/** A method a shared cache must never serve from. */
describe('a non-GET request', () => {
  it('never touches the shared cache', async () => {
    const cache = countingCache();
    const handle = createPageHandler<Env, unknown>({
      runtime: new Runtime(
        manifestFor({
          action: () => ({}),
          render: () => ({
            body: '<main>posted</main>',
            headers: { 'cache-control': 'public, max-age=3600' },
          }),
          cache: () => ({ mode: 'public', edgeSeconds: 60, tags: ['home'] }),
        }),
      ),
      cache,
    });

    const response = await handle(
      new Request('https://x.test/', { method: 'POST' }),
      {},
      context(),
    );

    expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
    expect(cache.matches).toHaveLength(0);
    expect(cache.puts).toHaveLength(0);
    expect(response.headers.get('cache-tag')).toBeNull();
    expect((response.headers.get('cache-control') ?? '').toLowerCase()).toMatch(
      /(^|[\s,])(private|no-store)([\s,;]|$)/,
    );
  });
});

/**
 * HEAD is the same response as GET without the body.
 *
 * Getting this wrong is subtle and expensive: a monitor that HEADs a page and
 * reads `Cache-Control` must see what a visitor's GET would see, and a HEAD
 * that answered from — or wrote to — a different cache entry than the GET
 * would double the cache footprint of every page for no benefit.
 */
describe('HEAD', () => {
  it('matches GET in status and headers, but sends no body', async () => {
    const cache = countingCache();
    const handle = handlerFor(PUBLIC_PAGE, cache);

    const get = await handle(new Request('https://x.test/'), {}, context());
    const getBody = await get.clone().text();
    const head = await handle(
      new Request('https://x.test/', { method: 'HEAD' }),
      {},
      context(),
    );

    expect(head.status).toBe(get.status);
    expect(head.headers.get('content-type')).toBe(
      get.headers.get('content-type'),
    );
    expect(head.headers.get('cache-control')).toBe(
      get.headers.get('cache-control'),
    );
    expect(head.headers.get('cache-tag')).toBe(get.headers.get('cache-tag'));

    expect(getBody).not.toBe('');
    expect(await head.text()).toBe('');
  });

  it('shares the GET cache entry rather than keeping its own', async () => {
    // Pinned deliberately: a HEAD is answered from the entry a GET stored, and
    // a HEAD alone never populates the cache — the body it would store is the
    // one thing it does not have.
    const cache = countingCache();
    const handle = handlerFor(PUBLIC_PAGE, cache);
    const url = 'https://x.test/';

    // A cold HEAD renders — a MISS — but stores nothing: the body it would
    // need to store is the one thing it does not have.
    const head = await handle(
      new Request(url, { method: 'HEAD' }),
      {},
      context(),
    );
    expect(head.headers.get('x-runtime-cache')).toBe('MISS');
    expect(cache.puts).toHaveLength(0);

    const get = await handle(new Request(url), {}, context());
    expect(get.headers.get('x-runtime-cache')).toBe('MISS');
    expect(cache.puts).toHaveLength(1);

    const second = await handle(
      new Request(url, { method: 'HEAD' }),
      {},
      context(),
    );
    expect(second.headers.get('x-runtime-cache')).toBe('HIT');
    expect(await second.text()).toBe('');
    // One entry, keyed the same way for both methods.
    expect(cache.puts[0]?.url).toBe(url);
  });
});

/**
 * Cookies a product has declared its HTML does not depend on.
 *
 * The default stands: any cookie bypasses the shared cache, because a page
 * that varies by cookie and is cached by URL serves one visitor's view to the
 * next. But a storefront whose HTML is provably identical with or without a
 * currency preference should not lose caching for every returning visitor, and
 * the fix for that is *not* to strip the cookie in `cacheKey` — that hides the
 * credential from the check rather than establishing it is inert.
 *
 * So it is declared, narrowly, and anything unexpected still bypasses.
 */
describe('ignoredCookies', () => {
  function handlerWith(cache: PageCache, ignoredCookies?: readonly string[]) {
    return createPageHandler<Env, unknown>({
      runtime: new Runtime(
        manifestFor({
          render: (_data, context) =>
            `<main>${context.request.headers.get('cookie') ?? 'no-cookie'}</main>`,
          cache: () => ({ mode: 'public', edgeSeconds: 60, tags: ['home'] }),
        }),
      ),
      cache,
      ...(ignoredCookies === undefined ? {} : { ignoredCookies }),
    });
  }

  it('keeps bypassing every cookie when a product declares none', async () => {
    const cache = countingCache();
    const handle = handlerWith(cache);
    const response = await handle(
      new Request('https://x.test/', { headers: { cookie: 'currency=EUR' } }),
      {},
      context(),
    );
    expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
    expect(cache.matches).toHaveLength(0);
  });

  it('shares the cache when only declared cookies are present', async () => {
    const cache = countingCache();
    const handle = handlerWith(cache, ['currency', 'cart']);

    const first = await handle(
      new Request('https://x.test/', { headers: { cookie: 'currency=EUR' } }),
      {},
      context(),
    );
    expect(first.headers.get('x-runtime-cache')).toBe('MISS');

    const second = await handle(
      new Request('https://x.test/', {
        headers: { cookie: 'cart=abc; currency=GBP' },
      }),
      {},
      context(),
    );
    expect(second.headers.get('x-runtime-cache')).toBe('HIT');
  });

  it('hides the declared cookies from the page itself', async () => {
    // The declaration is a claim that the HTML does not depend on them. If the
    // page could still read one, the claim would be unenforceable and the
    // first page to use it would poison the cache for everyone.
    const cache = countingCache();
    const handle = handlerWith(cache, ['currency']);
    const response = await handle(
      new Request('https://x.test/hidden', {
        headers: { cookie: 'currency=EUR' },
      }),
      {},
      context(),
    );
    expect(await response.text()).toContain('no-cookie');
  });

  it('bypasses as soon as one undeclared cookie appears', async () => {
    const cache = countingCache();
    const handle = handlerWith(cache, ['currency']);
    const response = await handle(
      new Request('https://x.test/', {
        headers: { cookie: 'currency=EUR; session=secret' },
      }),
      {},
      context(),
    );
    expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(cache.matches).toHaveLength(0);
  });

  it('bypasses a malformed cookie header', async () => {
    const cache = countingCache();
    const handle = handlerWith(cache, ['currency']);
    for (const cookie of ['currency', '=EUR', '   ', 'currency=EUR;;;=']) {
      const response = await handle(
        new Request('https://x.test/', { headers: { cookie } }),
        {},
        context(),
      );
      expect(response.headers.get('x-runtime-cache'), cookie).toBe('BYPASS');
    }
    expect(cache.matches).toHaveLength(0);
  });

  it('never ignores Authorization, whatever is declared', async () => {
    const cache = countingCache();
    const handle = handlerWith(cache, ['currency']);
    const response = await handle(
      new Request('https://x.test/', {
        headers: { cookie: 'currency=EUR', authorization: 'Bearer t' },
      }),
      {},
      context(),
    );
    expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(cache.matches).toHaveLength(0);
  });

  it('still refuses to store a response that sets a cookie', async () => {
    const cache = countingCache();
    const handle = createPageHandler<Env, unknown>({
      runtime: new Runtime(
        manifestFor(pageWithHeaders({ 'set-cookie': 'session=abc; Path=/' })),
      ),
      cache,
      ignoredCookies: ['currency'],
    });
    const response = await handle(
      new Request('https://x.test/', { headers: { cookie: 'currency=EUR' } }),
      {},
      context(),
    );
    expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
    expect(cache.puts).toHaveLength(0);
  });
});

describe('browser policy survives cache storage', () => {
  it.each([0, 30])(
    'restores browser max-age %i after the cache rewrites headers',
    async (browserSeconds) => {
      const backing = countingCache();
      const cache: PageCache = {
        put: (request, response) => backing.put(request, response),
        async match(request) {
          const hit = await backing.match(request);
          if (hit !== undefined) {
            hit.headers.set(
              'cache-control',
              'public, max-age=14400, s-maxage=60',
            );
          }
          return hit;
        },
      };
      const handle = handlerFor(
        {
          ...PUBLIC_PAGE,
          cache: () => ({ mode: 'public', edgeSeconds: 60, browserSeconds }),
        },
        cache,
      );
      const request = new Request('https://x.test/browser-policy');
      const miss = await handle(request, {}, context());
      const hit = await handle(request, {}, context());
      expect(hit.headers.get('x-runtime-cache')).toBe('HIT');
      expect(hit.headers.get('cache-control')).toBe(
        miss.headers.get('cache-control'),
      );
      expect([...miss.headers.keys(), ...hit.headers.keys()]).not.toContain(
        'x-mallok-stored-cache-control',
      );
    },
  );
});
