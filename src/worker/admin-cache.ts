/**
 * Cache maintenance (docs/ADMIN.md §11).
 *
 * Two different things live behind the word "cache", and conflating them
 * would make one of these buttons look dangerous and the other useless:
 *
 * - **the edge cache** holds finished pages. Clearing it is a purge call and
 *   costs nothing but a re-render;
 * - **`render_cache`** holds stage-one fragments in D1. It is derived data —
 *   every row can be rebuilt from the Markdown that produced it
 *   (docs/DATA_MODEL.md §4) — so emptying the table is safe, and the only
 *   cost is one stage-one render per page afterwards.
 */

import { clearRenderCache } from '../db/queries.js';
import { purgeNow } from './cache.js';
import type { Env } from './env.js';
import { json } from './http.js';

/** Purges every cached page at the edge. */
export async function postPurgeAll(env: Env): Promise<Response> {
  // `site` is on every page, list, feed and sitemap response
  // (see `tagsForContent`), so one tag clears the lot.
  const result = await purgeNow(env, ['site']);
  return json({
    purged: result.ok,
    attempted: result.attempted,
    // Honest about the degraded case: with no token the pages simply expire
    // on their own (docs/CLOUDFLARE_RESOURCES.md §6).
    ...(result.attempted
      ? {}
      : {
          note: 'No cache-purge token is configured, so nothing was purged. Cached pages expire on their own.',
        }),
    ...(result.detail === undefined ? {} : { detail: result.detail }),
  });
}

/** Empties the stage-one fragment cache. */
export async function postClearFragments(
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const removed = await clearRenderCache(env.DB);
  // The pages at the edge still hold the old HTML, so they go too.
  ctx.waitUntil(purgeNow(env, ['site']));
  return json({
    cleared: removed,
    note: 'Fragments are derived from your Markdown and are rebuilt on the next request.',
  });
}
