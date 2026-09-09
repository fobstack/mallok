/**
 * The public site, served by the page runtime in `src/runtime`.
 *
 * Three things about this file are deliberate:
 *
 * 1. **The manifest is written out, not generated.** The runtime's Vite plugin
 *    scans a file tree, and Mallok's Worker is bundled by Wrangler, not Vite.
 *    The manifest is only data, so listing three routes here costs nothing and
 *    avoids adding a second bundler to the Worker build.
 * 2. **The document renderer returns the theme's own HTML.** Mallok's themes
 *    already produce a whole document in `layouts/base.liquid`, so the runtime
 *    must not wrap it in a second one. Exactly one component writes the
 *    `<html>`, and for Mallok that is the theme — which is also why pages set
 *    SEO directives as headers rather than through the head descriptor.
 * 3. **Pages share `caches.default` with the SEO endpoints.** A named cache
 *    would be tidier, but `src/worker/seo-routes.ts` and the purge path both
 *    work against the default cache; splitting the site across two caches to
 *    serve one migration is how a purge quietly stops covering half the site.
 */

import {
  createPageHandler,
  type PageCache,
} from '../../runtime/cloudflare/index.js';
import type { DocumentRenderer, PageData } from '../../runtime/core/index.js';
import { Runtime } from '../../runtime/core/index.js';
import { CACHE_STATUS_HEADER, cacheKeyFor } from '../cache.js';
import type { Env } from '../env.js';
import { problem } from '../http.js';
import contentPage from './content.page.js';
import {
  buildLocals,
  localeResolution,
  type PublicLocals,
  SiteNotReady,
} from './context.js';
import homePage from './home.page.js';
import tagPage from './tag.page.js';

const runtime = new Runtime<PublicLocals>({
  routes: [
    { pattern: '/', load: () => Promise.resolve(homePage) },
    { pattern: '/tags/[...tag]', load: () => Promise.resolve(tagPage) },
    // Everything else: a content item at its own path, a kind's list page, a
    // redirect, or the themed 404. Mallok resolves those from D1, not files.
    { pattern: '/[...path]', load: () => Promise.resolve(contentPage) },
  ],
  // Locales live in D1 and the admin can change them, so they are supplied per
  // request instead; these only apply before the site row has been read.
  locales: [],
  defaultLocale: 'en',
});

/** The Cache API's default cache, which is where the rest of Mallok caches. */
const pageCache: PageCache = {
  async match(request) {
    return await caches.default.match(request);
  },
  async put(request, response) {
    await caches.default.put(request, response);
  },
};

/**
 * The theme wrote the document already; hand it back with the island scripts
 * placed inside it.
 *
 * A page that used no island gets its document back untouched, which is what
 * keeps "this page ships no JavaScript" a property that can be checked rather
 * than hoped for.
 */
export const renderDocument: DocumentRenderer<PageData, PublicLocals> = ({
  body,
  islands,
}) => (islands === '' ? body : insertBeforeBodyClose(body, islands));

/**
 * Puts markup just before the document's closing `</body>`.
 *
 * Appending to the end of the string instead would put the scripts after
 * `</html>`, outside the document: browsers recover from that, but it is
 * invalid, and anything that parses the page properly — a validator, a
 * scraper, a strict CSP report — sees markup that escaped the document.
 *
 * The last `</body>` is the document's own; an earlier one could only come
 * from escaped text in the content.
 */
function insertBeforeBodyClose(document: string, markup: string): string {
  const at = document.lastIndexOf('</body>');
  if (at === -1) {
    // A theme layout with no `</body>` is malformed, but dropping the scripts
    // would break the page silently. Append, and say why in the log.
    console.warn(
      JSON.stringify({ event: 'island_placement_fallback', reason: 'no_body' }),
    );
    return `${document}\n${markup}`;
  }
  return `${document.slice(0, at)}${markup}\n${document.slice(at)}`;
}

const pages = createPageHandler<Env, PublicLocals>({
  runtime,
  cache: pageCache,
  cacheKey: cacheKeyFor,
  cacheStatusHeader: CACHE_STATUS_HEADER,
  document: renderDocument,
  locals: async ({ request, env, ctx }) => await buildLocals(request, env, ctx),
  locale: (locals) => localeResolution(locals),
  onRejectedTag: (tag, reason) => {
    console.warn(JSON.stringify({ event: 'cache_tag_rejected', tag, reason }));
  },
});

/**
 * Handles a request for a public page.
 *
 * The two conditions handled here are the ones the lifecycle has no place for:
 * a method no page can answer, and a site whose row does not exist yet. Both
 * are decided before any page runs, and both keep the responses the previous
 * handler returned.
 */
export async function handlePublicPage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return problem(405, 'Method not allowed.');
  }
  try {
    return await pages(request, env, ctx);
  } catch (error) {
    if (error instanceof SiteNotReady) {
      return problem(503, 'Site is not initialized.');
    }
    throw error;
  }
}
