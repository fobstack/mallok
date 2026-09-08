/**
 * What every public page is given, built once per request.
 *
 * Mallok's routing is data-driven: the path is looked up in D1 rather than
 * matched against a file tree, and the site row, the plugin rows and the
 * content row all come back in one speculative batch
 * (docs/ARCHITECTURE.md §4). That batch has to happen before routing, not
 * inside each page, or the D1 round-trip budget (`AC-INV-05`, at most 4)
 * would grow by one for every page module that re-queried.
 *
 * So the runtime's `locals` is where it happens, and the pages read what it
 * found.
 */

import { parsePublicPath } from '../../core/index.js';
import type { ContentRenderData } from '../../db/queries.js';
import { loadContentRenderData } from '../../db/queries.js';
import type { Env } from '../env.js';
import type { RenderContext } from '../render.js';
import { parseSiteSettings, type SiteSettings, siteOrigin } from '../site.js';
import { getCompiledTheme } from '../theme-cache.js';

export const LIST_PAGE_SIZE = 20;
export const HOME_RECENT = 10;

/** The per-request state the page modules share. */
export interface PublicLocals {
  readonly env: Env;
  readonly ctx: ExecutionContext;
  readonly settings: SiteSettings;
  /** The speculative batch: site, plugins, and the content row if the path is one. */
  readonly data: ContentRenderData;
  /** Path with the locale prefix removed, as Mallok's own parser sees it. */
  readonly rest: string;
  readonly locale: string;
  /** Normalised request path, including any locale prefix. */
  readonly pathname: string;
  readonly now: string;
  /** Everything `src/worker/render.ts` needs, already assembled. */
  readonly render: RenderContext;
  /**
   * True when this response must carry `x-robots-tag: noindex`.
   *
   * A page served from any host but the bound domain must not be indexed: a
   * `.workers.dev` copy in search results competes with the real site
   * (docs/SEO_PERFORMANCE.md §10). Decided here, before the response is
   * cached, and safe to cache because the cache key includes the origin.
   */
  readonly noindex: boolean;
}

/** The response headers every public page carries, plus anything it adds. */
export function publicHeaders(
  locals: PublicLocals,
  extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return locals.noindex ? { 'x-robots-tag': 'noindex', ...extra } : extra;
}

/** Raised when the site row is missing, i.e. setup has not run. */
export class SiteNotReady extends Error {}

/**
 * Builds the request's locals.
 *
 * Called once per request by the adapter, which then hands the result to the
 * locale resolver as well — so the speculative batch happens exactly once and
 * the D1 round-trip budget (`AC-INV-05`, at most 4) is unaffected.
 *
 * Throws {@link SiteNotReady} rather than returning a response, because the
 * adapter builds locals before routing and has nowhere to put a response yet;
 * the Worker turns it into the 503 the previous handler returned.
 */
export async function buildLocals(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<PublicLocals> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const now = new Date().toISOString();

  const data = await loadContentRenderData(env.DB, pathname);
  if (data.site === null) {
    throw new SiteNotReady('Site is not initialized.');
  }
  const settings = parseSiteSettings(data.site);
  const parsed = parsePublicPath(
    pathname,
    settings.locales,
    settings.defaultLocale,
  );
  const theme = getCompiledTheme();
  return {
    env,
    ctx,
    settings,
    data,
    rest: parsed.rest,
    locale: parsed.locale,
    pathname,
    now,
    noindex: settings.domain === null || url.host !== settings.domain,
    render: {
      settings,
      theme,
      origin: siteOrigin(settings, request),
      locale: parsed.locale,
      path: pathname,
    },
  };
}

/**
 * Locale settings for the router, read from D1 rather than the build.
 *
 * The admin can add a language at any time, and the public site has to serve
 * it on the next request — not after a redeploy.
 */
export function localeResolution(locals: PublicLocals): {
  locales: readonly string[];
  defaultLocale: string;
  pathname: string;
  locale: string;
} {
  return {
    locales: locals.settings.locales,
    defaultLocale: locals.settings.defaultLocale,
    // Mallok already stripped the prefix its own way; handing both back keeps
    // one parser in charge rather than two that can disagree.
    pathname: locals.rest,
    locale: locals.locale,
  };
}

/** Trailing slashes are not distinct URLs (docs/SEO_PERFORMANCE.md). */
function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}
