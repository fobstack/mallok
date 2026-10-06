/**
 * The single per-site Cron Trigger (`* * * * *`). Every minute it publishes
 * due content, purges the affected cache tags, drops expired sessions and
 * collects unreferenced media. Email retries and fragment-cache collection
 * join this loop in later tasks (docs/ARCHITECTURE.md §6.5).
 *
 * Every tick shares one CPU budget, so each step takes a bounded slice and
 * leaves the rest for the next minute.
 */

import { PIPELINE_VERSION } from '../core/index.js';
import { deleteExpiredSessions } from '../db/auth.js';
import { deleteUnreferencedMedia, mediaToCollect } from '../db/media.js';
import {
  cleanupJobs,
  collectRenderCache,
  loadSiteRenderData,
  publishDue,
} from '../db/queries.js';
import { deleteObjects } from './admin-media.js';
import { boot } from './bootstrap.js';
import { purgeNow, tagsForContent } from './cache.js';
import { processEmailJobs } from './email.js';
import type { Env } from './env.js';
import { processPluginJobs, runScheduledHooks } from './plugin-runtime.js';
import { parseSiteSettings } from './site.js';

/** How long an unreferenced object is kept before collection. */
const MEDIA_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Objects collected per tick, so one minute's work stays bounded. */
const MEDIA_PER_TICK = 20;

/** How long finished jobs are kept for inspection. */
const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Runs one scheduler tick. */
export async function handleScheduled(
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  await boot(env);
  const now = new Date().toISOString();

  const sent = await processEmailJobs(env);
  if (sent > 0) {
    console.log(JSON.stringify({ event: 'emails_sent', count: sent }));
  }
  await cleanupJobs(
    env.DB,
    new Date(Date.now() - JOB_RETENTION_MS).toISOString(),
  );

  const siteData = await loadSiteRenderData(env.DB);
  const site = siteData.site === null ? null : parseSiteSettings(siteData.site);
  if (site !== null) {
    // Each plugin's hook is isolated inside; this only guards the loop.
    await runScheduledHooks(env, ctx, siteData.plugins, site);
  }
  const expiredSessions = await deleteExpiredSessions(env.DB, now);
  if (expiredSessions > 0) {
    console.log(
      JSON.stringify({ event: 'sessions_expired', count: expiredSessions }),
    );
  }
  await collectMedia(env, new Date(now));

  const collectedFragments = await collectRenderCache(env.DB, PIPELINE_VERSION);
  if (collectedFragments > 0) {
    console.log(
      JSON.stringify({
        event: 'fragments_collected',
        count: collectedFragments,
      }),
    );
  }

  const published = await publishDue(env.DB, now);
  if (published.length > 0) {
    const tags = new Set<string>();
    for (const row of published) {
      for (const tag of tagsForContent(row.id, row.kind, row.locale)) {
        tags.add(tag);
      }
    }
    const result = await purgeNow(env, [...tags]);
    console.log(
      JSON.stringify({
        event: 'scheduled_publish',
        count: published.length,
        purge: result,
      }),
    );
  }

  // Plugin jobs go last: they are the part of a tick the core did not write,
  // and whatever one of them costs, the site's own housekeeping and scheduled
  // publishing have already happened.
  if (site !== null) {
    try {
      const jobs = await processPluginJobs(env, ctx, siteData.plugins, site);
      if (jobs.done + jobs.failed > 0) {
        console.log(JSON.stringify({ event: 'plugin_jobs', ...jobs }));
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'plugin_jobs_error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

/**
 * Deletes media that nothing has referenced for the grace period. The D1 row
 * goes first: if the R2 delete then fails, the object is orphaned but no page
 * breaks, whereas the reverse order would leave a row pointing at nothing.
 */
async function collectMedia(env: Env, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - MEDIA_GRACE_MS).toISOString();
  const stale = await mediaToCollect(env.DB, cutoff, MEDIA_PER_TICK);
  if (stale.length === 0) {
    return;
  }
  let collected = 0;
  for (const row of stale) {
    if (!(await deleteUnreferencedMedia(env.DB, row.sha256))) {
      // Something referenced it between the query and now; leave it alone.
      continue;
    }
    await deleteObjects(env, row.sha256, row.ext, parseWidths(row.variants));
    collected++;
  }
  console.log(JSON.stringify({ event: 'media_collected', count: collected }));
}

function parseWidths(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is number => typeof value === 'number' && value > 0,
        )
      : [];
  } catch {
    return [];
  }
}
