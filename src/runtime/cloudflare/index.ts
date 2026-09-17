/**
 * The Workers adapter (`src/runtime/cloudflare`).
 *
 * Two things this file deliberately does **not** do:
 *
 * 1. **It does not make the deployment asset-first.** That is
 *    `assets.run_worker_first = false` in `wrangler.jsonc`, which keeps the
 *    request out of the Worker entirely. Calling `ASSETS.fetch()` from inside
 *    a handler has already cost a Worker invocation, so it is a fallback for
 *    products that need one, not a billing optimisation.
 * 2. **It does not own routing for the whole Worker.** A product's dispatcher
 *    handles its API and admin paths first and calls this for public pages
 *    only. A public catch-all route must never get the chance to swallow
 *    `/_mallok/api/*`.
 *
 * The handler takes `(request, env, ctx)` and is created once per module
 * evaluation; `env` arrives per request and is never stored in a module
 * global, because a Worker isolate is shared across requests.
 */

import {
  cacheControlFor,
  classifyCookies,
  forbidsSharedCaching,
  grantsSharedCaching,
  isCacheableRequest,
  isStorable,
  validateTags,
} from '../core/cache.js';
import type { PageResult, Runtime } from '../core/index.js';
import type { LocaleResolution } from '../core/router.js';
import type { CachePolicy, DocumentRenderer, PageData } from '../core/types.js';

/** The subset of `Fetcher` this adapter needs from an Assets binding. */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** What the adapter is given for each request, before any page runs. */
export interface RequestScope<Env> {
  readonly request: Request;
  readonly env: Env;
  readonly ctx: ExecutionContext;
}

export interface AdapterOptions<Env, Locals> {
  readonly runtime: Runtime<Locals>;
  /**
   * Per-request extras handed to every lifecycle step. Async so a product can
   * open a database handle or read settings here.
   *
   * Called at most once per request, and not at all on a cache hit — so a
   * product may do real work here (a database round trip, say) without paying
   * for it on the requests that never reach a page.
   */
  readonly locals?: (scope: RequestScope<Env>) => Locals | Promise<Locals>;
  /** The product's document renderer; the theme owns the final `<html>`. */
  readonly document?: DocumentRenderer<PageData, Locals>;
  /**
   * Locale settings for this request, when they come from data, not build.
   *
   * Receives the locals already built for this request. Products whose
   * locales live in a database would otherwise have to fetch them twice and
   * deduplicate the calls themselves.
   */
  readonly locale?: (
    locals: Locals,
    scope: RequestScope<Env>,
  ) => LocaleResolution | Promise<LocaleResolution>;
  /**
   * Normalises the key a page is cached under: dropping tracking query
   * parameters, for instance, so `?utm_source=x` does not fragment the cache.
   *
   * This decides only *where* a page is stored, never *whether* it may be:
   * eligibility is judged on the request as it arrived, so a key that rebuilds
   * the request — and so drops its `Cookie` and `Authorization` — cannot turn
   * a credentialed request into a cacheable one.
   */
  readonly cacheKey?: (request: Request) => Request;
  /** Cache storage. Omit to run with no page cache at all. */
  readonly cache?: PageCache;
  /**
   * Cookie names whose presence must not stop a page being shared.
   *
   * **The default is to bypass on any cookie**, and that stays the right
   * default: a page cached by URL that varies by cookie serves one visitor's
   * view to the next. This is the narrow escape hatch for a cookie a product
   * has established its HTML does not depend on — a currency preference the
   * server never reads, say.
   *
   * It is deliberately not the same as stripping the cookie in `cacheKey`.
   * That hides the credential from the check; this states which names are
   * inert and enforces the claim: the declared cookies are **removed from the
   * request the page sees**, so a page that quietly started reading one gets
   * nothing rather than poisoning the cache for everyone.
   *
   * One undeclared name, one unparsable header, or an `Authorization` header
   * still bypasses. Never list a session or admin cookie here.
   */
  readonly ignoredCookies?: readonly string[];
  /** Called when a tag is dropped, so a broken purge is visible early. */
  readonly onRejectedTag?: (tag: string, reason: string) => void;
  /**
   * Header carrying `HIT` / `MISS` / `BYPASS`. Products that already publish
   * one under their own name pass it here rather than having operators and
   * tests learn a second header for the same fact.
   */
  readonly cacheStatusHeader?: string;
  /**
   * Last resort for a request no route matched.
   *
   * **This is not where a themed 404 belongs.** It runs outside the lifecycle:
   * no `locals` have been built for it, no `head` is serialised, and the
   * document renderer is never called — so whatever it returns is a bare
   * response the theme never saw. A product that wants its 404 to look like
   * its site gives it a catch-all page (`[...path]`) that returns status 404
   * from `render`, which goes through `load`, `head`, `render` and `document`
   * like any other page. Mallok does exactly that.
   *
   * What is left for this hook is the genuinely route-less case: a manifest
   * with no catch-all, where a plain 404 is the honest answer.
   */
  readonly notFound?: (scope: RequestScope<Env>) => Promise<Response | null>;
  /** Optional last resort for assets, when not served ahead of the Worker. */
  readonly assets?: (env: Env) => AssetsBinding | undefined;
}

/** Storage for rendered pages. Implementations are swappable on purpose. */
export interface PageCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/**
 * The Cache API, in a named cache of its own.
 *
 * `caches.default` is shared with everything else the zone does; a named
 * cache keeps the runtime's page entries separate, so purging or reasoning
 * about them does not involve the rest of the traffic.
 */
export function workersPageCache(name = 'fobstack-pages'): PageCache {
  let opened: Promise<Cache> | undefined;
  const open = (): Promise<Cache> => {
    opened ??= caches.open(name);
    return opened;
  };
  return {
    async match(request) {
      return await (await open()).match(request);
    },
    async put(request, response) {
      await (await open()).put(request, response);
    },
  };
}

/**
 * Builds a `fetch` handler for public pages.
 *
 * Create it once at module scope and call it per request; `env` is passed in
 * rather than captured.
 */
const STORED_CACHE_CONTROL = 'x-mallok-stored-cache-control';

export function createPageHandler<Env, Locals>(
  options: AdapterOptions<Env, Locals>,
): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  const statusHeader = options.cacheStatusHeader ?? 'x-runtime-cache';
  return async function handle(request, env, ctx) {
    const scope: RequestScope<Env> = { request, env, ctx };
    const cache = options.cache;

    // Judged on the request as it arrived. Doing this after `cacheKey` would
    // let a key that rebuilds the request launder its credentials away.
    const isHead = request.method.toUpperCase() === 'HEAD';
    const ignoredCookies = options.ignoredCookies ?? [];
    const eligible =
      cache !== undefined && isCacheableRequest(request, ignoredCookies);
    // A HEAD is answered from the entry a GET stored, so its key has to be the
    // key a GET would have produced — otherwise every page would occupy two
    // cache entries and a HEAD would never hit one.
    const key = !eligible
      ? undefined
      : asGet(options.cacheKey?.(request) ?? request);

    if (cache !== undefined && key !== undefined) {
      const hit = await cache.match(key);
      if (hit !== undefined) {
        const headers = new Headers(hit.headers);
        const policy = headers.get(STORED_CACHE_CONTROL);
        // Cache storage can raise max-age to the zone's browser TTL. Keep
        // the policy separately and restore it only on the outgoing copy.
        // Old entries have no metadata: revalidate them in the browser.
        headers.set(
          'cache-control',
          policy ?? 'public, max-age=0, must-revalidate',
        );
        headers.delete(STORED_CACHE_CONTROL);
        const restored = new Response(hit.body, {
          status: hit.status,
          statusText: hit.statusText,
          headers,
        });
        return withoutBodyIfHead(tagged(restored, 'HIT', statusHeader), isHead);
      }
    }

    // Declared-inert cookies are taken off the request before any page sees
    // it. The declaration is a claim that the HTML does not depend on them;
    // enforcing it here is what keeps the claim from being quietly untrue.
    const forPage =
      classifyCookies(request.headers.get('cookie'), ignoredCookies) ===
      'ignorable'
        ? withoutCookies(request)
        : request;

    const pageScope: RequestScope<Env> = { ...scope, request: forPage };
    // Built once, after the cache has been asked, and shared with the locale
    // resolver so a product never has to deduplicate the work itself.
    const locals = (await options.locals?.(pageScope)) as Locals;
    const result = await options.runtime.handle(forPage, {
      ...(options.locals === undefined ? {} : { locals }),
      ...(options.document === undefined ? {} : { document: options.document }),
      ...(options.locale === undefined
        ? {}
        : { locale: await options.locale(locals, pageScope) }),
    });

    if (result === null) {
      const handled = await options.notFound?.(scope);
      if (handled !== null && handled !== undefined) {
        return handled;
      }
      const asset = await tryAssets(options.assets?.(env), request);
      return asset ?? new Response('Not found.', { status: 404 });
    }

    // Judged on the page's *own* response, before the policy rewrites its
    // headers: a page that answered `private` or `no-store` has overruled the
    // policy it declared, and checking afterwards would only ever see the
    // policy talking to itself.
    const storable =
      key !== undefined && isStorable(result.cache, result.response).storable;
    const response = applyPolicy(result, storable, options.onRejectedTag);
    // Only a GET writes: a HEAD's response has no body, and storing it would
    // poison the entry that later GETs are served from.
    if (cache !== undefined && key !== undefined && storable && !isHead) {
      const stored = response.clone();
      stored.headers.set(
        STORED_CACHE_CONTROL,
        response.headers.get('cache-control') ?? 'no-store',
      );
      ctx.waitUntil(cache.put(key, stored));
      return tagged(response, 'MISS', statusHeader);
    }
    // A cold HEAD is a MISS, not a BYPASS: the page was rendered rather than
    // served from cache, and it was cacheable — it simply has no body to store.
    return withoutBodyIfHead(
      tagged(response, storable ? 'MISS' : 'BYPASS', statusHeader),
      isHead,
    );
  };
}

/**
 * Turns the neutral policy into Cloudflare's headers.
 *
 * `Cache-Tag` is written before the response is stored, because the stored
 * copy is what a later purge has to match against — and only when the
 * response is actually being stored, since a tag on an uncached response is a
 * purge target that will never match anything.
 *
 * A response that is not being stored never leaves with `public`. Two very
 * different things end up here — a page that refused to be shared, and a
 * perfectly ordinary page answering a request that carried credentials — and
 * in both cases telling an intermediary it may keep the response is exactly
 * the mistake this adapter exists to prevent.
 */
function applyPolicy(
  result: PageResult,
  storable: boolean,
  onRejected: ((tag: string, reason: string) => void) | undefined,
): Response {
  const policy: CachePolicy = result.cache;
  const headers = new Headers(result.response.headers);
  headers.delete(STORED_CACHE_CONTROL);
  const { tags, rejected } = validateTags(policy.tags ?? []);
  for (const reject of rejected) {
    onRejected?.(reject.tag, reject.reason);
  }

  if (storable) {
    headers.set('cache-control', cacheControlFor(policy));
    if (tags.length > 0) {
      headers.set('cache-tag', tags.join(','));
    }
  } else {
    headers.delete('cache-tag');
    // Keeping the page's own header is only safe when it already refuses a
    // shared cache. A page that declared `public, max-age=3600` and is being
    // bypassed for some *other* reason — the request carried credentials, the
    // response sets a cookie — would otherwise leave with that permission
    // intact, and a browser or an intermediary would keep it. Counting
    // `put()` calls does not catch this: nothing was written here, and the
    // page still leaked.
    //
    // A header saying both — `public, private, max-age=60` — is contradictory
    // and is replaced too: which half an intermediary honours is not something
    // to leave to chance.
    const own = headers.get('cache-control');
    const keepOwn =
      own !== null && forbidsSharedCaching(own) && !grantsSharedCaching(own);
    if (!keepOwn) {
      headers.set('cache-control', 'private, no-store');
    }
  }

  return new Response(result.response.body, {
    status: result.response.status,
    statusText: result.response.statusText,
    headers,
  });
}

async function tryAssets(
  assets: AssetsBinding | undefined,
  request: Request,
): Promise<Response | null> {
  if (assets === undefined || request.method !== 'GET') {
    return null;
  }
  const response = await assets.fetch(request);
  return response.status === 404 ? null : response;
}

/** The same request with no `Cookie` header at all. */
function withoutCookies(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  return new Request(request, { headers });
}

/** The same request as a GET, so HEAD and GET share one cache entry. */
function asGet(request: Request): Request {
  return request.method.toUpperCase() === 'GET'
    ? request
    : new Request(request.url, { method: 'GET' });
}

/** A HEAD carries every header a GET would, and no body. */
function withoutBodyIfHead(response: Response, isHead: boolean): Response {
  if (!isHead) {
    return response;
  }
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function tagged(
  response: Response,
  status: 'HIT' | 'MISS' | 'BYPASS',
  header: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(header, status);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
