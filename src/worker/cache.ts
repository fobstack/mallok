/**
 * Edge cache (Cache API) and global invalidation (Cache Purge API).
 * See docs/ARCHITECTURE.md §6.
 */

import { clearPurgeFailure, recordPurgeFailure } from '../db/queries.js';
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

/** The tag every public page carries; purging it purges the site. */
const SITE_TAG = 'site';

/**
 * A plugin's tag as it appears in `Cache-Tag` and in a purge call
 * (docs/PLUGIN_API.md §9). The prefix is what keeps one plugin's tags apart
 * from another's and from the core's own.
 */
export function pluginCacheTag(pluginId: string, tag: string): string {
  return `p:${pluginId}:${tag}`;
}

/**
 * The tags a plugin's `ctx.purgeTags` call may purge.
 *
 * Everything lands in the plugin's own namespace, so a plugin cannot name
 * another plugin's tag or one of the core's, whatever it passes. The one
 * exception is `site`, which every page carries: a plugin whose change can
 * touch any page needs a way to say so.
 */
export function pluginPurgeTags(
  pluginId: string,
  tags: readonly string[],
): string[] {
  return tags.map((tag) =>
    tag === SITE_TAG ? SITE_TAG : pluginCacheTag(pluginId, tag),
  );
}

/**
 * How many tags one purge call may carry. Cloudflare's limit for every plan
 * (developers.cloudflare.com/cache/how-to/purge-cache/, read 2026-10-05).
 */
const PURGE_TAGS_PER_CALL = 100;

let pendingTags = new Set<string>();
let pendingSources = new Set<string>();
let pendingFlush: Promise<PurgeResult> | undefined;

/**
 * What asked for a purge, as the admin shows it when one fails: `manual`,
 * `content`, `settings`, `plugins`, `setup`, `scheduled`, `fragments`, or
 * `plugin:<id>` for a plugin's own `ctx.purgeTags`.
 */
export type PurgeSource = string;

/** Outcome of a purge call, for logging and diagnostics. */
export interface PurgeResult {
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly status?: number;
  readonly tags: readonly string[];
  readonly detail?: string;
}

/** A failed purge as it is stored on the site row and shown in the admin. */
export interface PurgeFailure {
  readonly at: string;
  readonly source: string;
  readonly status?: number;
  readonly tags: number;
  readonly detail: string;
}

/**
 * Schedules a purge-by-tag call. Calls within a short window are coalesced
 * into one request to keep purge volume down under heavy edit traffic.
 *
 * Cloudflare documents the limit for tag purges as five requests a minute
 * per account on the Free plan, with a bucket of 25, shared by every zone of
 * the account (developers.cloudflare.com/cache/how-to/purge-cache/, updated
 * 2026-09-29, read 2026-10-25). A burst of 16 direct calls succeeded on a
 * Free account on 2026-09-03 (docs/ARCHITECTURE.md §18 item 3), which the
 * bucket explains. Coalescing keeps a run of saves or webhooks inside it.
 */
export function purgeTags(
  env: Env,
  tags: readonly string[],
  source: PurgeSource,
): Promise<PurgeResult> {
  for (const tag of tags) {
    pendingTags.add(tag);
  }
  pendingSources.add(source);
  if (pendingFlush === undefined) {
    pendingFlush = new Promise<PurgeResult>((resolve) => {
      setTimeout(() => {
        const batch = [...pendingTags];
        const sources = [...pendingSources].sort().join(',');
        pendingTags = new Set();
        pendingSources = new Set();
        pendingFlush = undefined;
        resolve(purgeNow(env, batch, sources));
      }, PURGE_DEBOUNCE_MS);
    });
  }
  return pendingFlush;
}

/** Calls the Cloudflare purge API immediately. */
export async function purgeNow(
  env: Env,
  tags: readonly string[],
  source: PurgeSource,
): Promise<PurgeResult> {
  if (env.CF_API_TOKEN === undefined || env.CF_ZONE_ID === undefined) {
    return {
      attempted: false,
      ok: false,
      tags,
      detail: 'purge not configured',
    };
  }
  // More tags than one call may carry are sent as several calls. Each one
  // counts against the plan's purge rate, so the first failure stops the rest
  // and is what the caller is told about.
  let last: PurgeResult = { attempted: true, ok: true, tags };
  for (let start = 0; start < tags.length; start += PURGE_TAGS_PER_CALL) {
    last = await purgeCall(
      env.CF_ZONE_ID,
      env.CF_API_TOKEN,
      tags.slice(start, start + PURGE_TAGS_PER_CALL),
    );
    if (!last.ok) {
      break;
    }
  }
  const result = { ...last, tags };
  await remember(env, result, source);
  return result;
}

/**
 * Keeps the outcome where an operator can find it.
 *
 * A purge that fails leaves every page it named stale for a whole cache
 * lifetime, and most callers run it in the background where nobody is told.
 * So a failure is logged and stored on the site row for the admin's
 * diagnostics; a successful purge of `site` — every page — forgets it,
 * because nothing an earlier failure left stale can have survived that.
 * Neither step may turn a purge into an error of its own.
 */
async function remember(
  env: Env,
  result: PurgeResult,
  source: PurgeSource,
): Promise<void> {
  try {
    if (!result.ok) {
      const failure: PurgeFailure = {
        at: new Date().toISOString(),
        source,
        ...(result.status === undefined ? {} : { status: result.status }),
        tags: result.tags.length,
        detail: (result.detail ?? '').slice(0, 300),
      };
      console.error(JSON.stringify({ event: 'purge_failed', ...failure }));
      await recordPurgeFailure(env.DB, JSON.stringify(failure));
    } else if (result.tags.includes(SITE_TAG)) {
      await clearPurgeFailure(env.DB);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'purge_record_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** Reads the stored failure back; null when there is none or it is unreadable. */
export function parsePurgeFailure(json: string | null): PurgeFailure | null {
  if (json === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as Partial<PurgeFailure>;
    return typeof parsed.at === 'string' && typeof parsed.source === 'string'
      ? {
          at: parsed.at,
          source: parsed.source,
          ...(typeof parsed.status === 'number'
            ? { status: parsed.status }
            : {}),
          tags: typeof parsed.tags === 'number' ? parsed.tags : 0,
          detail: typeof parsed.detail === 'string' ? parsed.detail : '',
        }
      : null;
  } catch {
    return null;
  }
}

async function purgeCall(
  zoneId: string,
  token: string,
  tags: readonly string[],
): Promise<PurgeResult> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tags }),
      },
    );
    const text = await response.text();
    // Cloudflare's envelope carries its own verdict. A 200 whose body says
    // `"success": false` is a refusal, and is treated as one.
    const ok = response.ok && !/"success"\s*:\s*false/.test(text);
    const detail = ok ? undefined : text;
    return {
      attempted: true,
      ok,
      status: response.status,
      tags,
      ...(detail === undefined ? {} : { detail: detail.slice(0, 500) }),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { attempted: true, ok: false, tags, detail };
  }
}
