/**
 * Edge cache (Cache API) and global invalidation (Cache Purge API).
 * See docs/ARCHITECTURE.md §6.
 */

import type { Env } from './env.js';

/** Header that tells operators (and tests) whether a request hit the cache. */
export const CACHE_STATUS_HEADER = 'x-mallok-cache';

const PURGE_DEBOUNCE_MS = 2_000;

/**
 * Builds the cache key for a public request: same origin and path, no query
 * string, no headers. Query strings never change what Mallok renders.
 */
export function cacheKeyFor(request: Request): Request {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  return new Request(url.toString(), { method: 'GET' });
}

/** Looks up a cached response and marks it as a hit. */
export async function matchCached(
  request: Request,
): Promise<Response | undefined> {
  const hit = await caches.default.match(cacheKeyFor(request));
  if (hit === undefined) {
    return undefined;
  }
  const response = new Response(hit.body, hit);
  response.headers.set(CACHE_STATUS_HEADER, 'HIT');
  return response;
}

/** Cache tags attached to a rendered page. */
export interface CacheTags {
  readonly tags: readonly string[];
}

/**
 * Decorates a rendered response with caching headers and stores a copy in
 * the edge cache without blocking the response.
 */
export function storeCached(
  ctx: ExecutionContext,
  request: Request,
  response: Response,
  ttlSeconds: number,
  { tags }: CacheTags,
): Response {
  response.headers.set('cache-control', `public, max-age=${ttlSeconds}`);
  response.headers.set('cache-tag', tags.join(','));
  response.headers.set(CACHE_STATUS_HEADER, 'MISS');
  ctx.waitUntil(caches.default.put(cacheKeyFor(request), response.clone()));
  return response;
}

/** Tags for one content item and the pages that list it. */
export function tagsForContent(
  contentId: string,
  kind: string,
  locale: string,
): string[] {
  return [
    'site',
    `c:${contentId}`,
    `k:${kind}:${locale}`,
    `home:${locale}`,
    `feed:${locale}`,
    // Tag archives list across kinds, so any content change can affect one.
    `tag:${locale}`,
    'sitemap',
  ];
}

let pendingTags = new Set<string>();
let pendingFlush: Promise<PurgeResult> | undefined;

/** Outcome of a purge call, for logging and diagnostics. */
export interface PurgeResult {
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly status?: number;
  readonly tags: readonly string[];
  readonly detail?: string;
}

/**
 * Schedules a purge-by-tag call. Calls within a short window are coalesced
 * into one request to keep purge volume down under heavy edit traffic.
 *
 * The "five tag purges per minute" Free-plan ceiling this comment used to
 * cite was not confirmed against a real account: 16 direct purge calls (six
 * spaced two seconds apart, then ten back-to-back) all succeeded with no
 * throttling observed (docs/ARCHITECTURE.md §18 item 3, 2026-09-03). The
 * debounce here is still worth keeping — it reduces call volume regardless
 * of where the real ceiling turns out to be — but do not cite a specific
 * number without measuring it again.
 */
export function purgeTags(
  env: Env,
  tags: readonly string[],
): Promise<PurgeResult> {
  for (const tag of tags) {
    pendingTags.add(tag);
  }
  if (pendingFlush === undefined) {
    pendingFlush = new Promise<PurgeResult>((resolve) => {
      setTimeout(() => {
        const batch = [...pendingTags];
        pendingTags = new Set();
        pendingFlush = undefined;
        resolve(purgeNow(env, batch));
      }, PURGE_DEBOUNCE_MS);
    });
  }
  return pendingFlush;
}

/** Calls the Cloudflare purge API immediately. */
export async function purgeNow(
  env: Env,
  tags: readonly string[],
): Promise<PurgeResult> {
  if (env.CF_API_TOKEN === undefined || env.CF_ZONE_ID === undefined) {
    return {
      attempted: false,
      ok: false,
      tags,
      detail: 'purge not configured',
    };
  }
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.CF_API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tags }),
      },
    );
    const detail = response.ok ? undefined : await response.text();
    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      tags,
      ...(detail === undefined ? {} : { detail: detail.slice(0, 500) }),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { attempted: true, ok: false, tags, detail };
  }
}
