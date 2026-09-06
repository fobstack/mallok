/**
 * Worker entry point. Routes by path prefix (docs/ARCHITECTURE.md §3):
 *
 *   /_mallok/api/*    management API (bearer token)
 *   /_mallok/app/*    admin SPA shell (files come from Static Assets)
 *   /_mallok/setup    first-run wizard page; 404s for good once setup completes
 *   /robots.txt, /sitemap*.xml, /feed.xml   core SEO endpoints
 *   /media/*          R2 proxy for uploaded media
 *   /*                public site
 *
 * Theme assets are not here: Static Assets serves `/theme/<id>/<version>/*`
 * before the Worker is invoked at all. Both `media` and `theme` are reserved
 * prefixes; a content kind may not claim them as its base path.
 */

import { loadSite, loadSiteRenderData } from '../db/queries.js';
import { handleAdmin } from './admin.js';
import { handleApp, isAppPath } from './admin-app.js';
import { boot } from './bootstrap.js';
import type { Env } from './env.js';
import { problem } from './http.js';
import { handleMedia } from './media.js';
import {
  handlePluginRoute,
  registryDeclaresOnRequest,
  runOnRequest,
} from './plugin-runtime.js';
import { handlePublic } from './public.js';
import { handleScheduled } from './scheduled.js';
import { handleSeo, isSeoPath } from './seo-routes.js';
import { handleSetup } from './setup.js';
import { parseSiteSettings } from './site.js';

async function fetchHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  try {
    if (pathname.startsWith('/media/')) {
      return await handleMedia(request, env, pathname);
    }
    await boot(env);
    if (pathname.startsWith('/_mallok/api/setup')) {
      const step = pathname
        .slice('/_mallok/api/setup'.length)
        .replace(/^\//, '');
      return await handleSetup(
        request,
        env,
        ctx,
        step === '' ? 'status' : step,
      );
    }
    if (pathname.startsWith('/_mallok/api/')) {
      return await handleAdmin(request, env, ctx, pathname);
    }
    if (isAppPath(pathname)) {
      return await handleApp(request, env);
    }
    if (pathname.startsWith('/_mallok/setup')) {
      // The pretty top-level URL for the wizard: the admin SPA's own router
      // (src/admin/routes.ts, `SETUP_PATH`) recognises this path and renders
      // the wizard client-side, matching /_mallok/app/setup. The API calls
      // that page makes go through /_mallok/api/setup/* above, which is the
      // only place the 404-once-completed rule actually needs enforcing —
      // but the bare shell must stop rendering too, so a browser cannot find
      // a stale link into a completed site's wizard.
      const site = await loadSite(env.DB);
      if (site !== null && site.setup_completed_at !== null) {
        return problem(404, 'Not found.');
      }
      return await handleApp(request, env);
    }
    if (pathname.startsWith('/_mallok/p/')) {
      const data = await loadSiteRenderData(env.DB);
      if (data.site === null) {
        return problem(503, 'Site is not initialized.');
      }
      return await handlePluginRoute(
        request,
        env,
        ctx,
        pathname,
        data.plugins,
        parseSiteSettings(data.site),
      );
    }
    if (pathname.startsWith('/_mallok/')) {
      return problem(404, 'Not found.');
    }
    if (registryDeclaresOnRequest()) {
      const short = await runOnRequest(request, env, ctx);
      if (short !== undefined) {
        return short;
      }
    }
    if (isSeoPath(pathname)) {
      return await handleSeo(request, env, ctx, pathname);
    }
    return await handlePublic(request, env, ctx);
  } catch (error) {
    // Never leak SQL, bucket names or stack traces to the client.
    console.error(
      JSON.stringify({
        event: 'unhandled_error',
        path: pathname,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return problem(500, 'Internal error.');
  }
}

export default {
  fetch: fetchHandler,
  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(handleScheduled(env, ctx));
  },
} satisfies ExportedHandler<Env>;
