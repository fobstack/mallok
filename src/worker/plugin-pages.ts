/**
 * Pages a plugin renders through the theme (docs/PLUGIN_API.md §7.2,
 * docs/THEME_FORMAT.md §16), and the cross-site check on plugin routes.
 *
 * The division of labour is the one the rest of Mallok keeps: the plugin owns
 * the route and the data, the theme owns the look. A route handler returns a
 * view; the theme's layout for it, if the theme has one, turns that into a
 * page that carries the site's own header, navigation and language switcher.
 */

import { escapeHtml } from '../core/index.js';
import type { PluginPageResult } from '../plugins/types.js';
import { renderPluginPageHtml } from './render.js';
import { type SiteSettings, siteOrigin } from './site.js';
import { getCompiledTheme } from './theme-cache.js';

/**
 * Says why a request must not reach a plugin route's handler, or `null`.
 *
 * Only state-changing requests are checked. A cross-site `GET` is a link —
 * from an order email, from a search result — and refusing it would break
 * every such link; what must not cross sites is a submission, because the
 * visitor's cookies travel with it.
 *
 * `Sec-Fetch-Site` is the browser's own verdict and is used when present.
 * Older browsers send `Origin` on a cross-origin POST, which is compared with
 * the host that was asked. A request with neither header is not one a
 * current browser makes for a form or a `fetch`, so it is a script or a
 * server — which holds no visitor's cookies — and is let through.
 */
export function crossSiteProblem(request: Request): string | null {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return null;
  }
  const verdict = request.headers.get('sec-fetch-site');
  if (verdict !== null) {
    return verdict === 'cross-site' ? REFUSAL : null;
  }
  const origin = request.headers.get('origin');
  if (origin === null) {
    return null;
  }
  try {
    return new URL(origin).host === new URL(request.url).host ? null : REFUSAL;
  } catch {
    // `Origin: null`, which a sandboxed frame or a cross-origin redirect
    // sends, is not this site.
    return REFUSAL;
  }
}

const REFUSAL = 'This form can only be submitted from the site itself.';

/** Whether a handler returned a view to render rather than a response. */
export function isPageResult(value: unknown): value is PluginPageResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Response) &&
    typeof (value as { view?: unknown }).view === 'object' &&
    (value as { view?: unknown }).view !== null &&
    !Array.isArray((value as { view?: unknown }).view)
  );
}

/** What is needed to render one plugin page. */
export interface PluginPageRequest {
  readonly request: Request;
  readonly site: SiteSettings;
  readonly locale: string;
  readonly pluginId: string;
  /** The layout name the route declares, e.g. `shop/cart`. */
  readonly layout: string;
  /** The requested path under the plugin, without any locale segment. */
  readonly segments: readonly string[];
  readonly result: PluginPageResult;
}

/**
 * Renders a plugin's view as a page of the site.
 *
 * The response is always private and never indexed: it is one visitor's
 * cart or order, built per request. `/_mallok/` is already disallowed in
 * `robots.txt`; the header covers a crawler that got the address elsewhere.
 */
export async function renderPluginPage(
  page: PluginPageRequest,
): Promise<Response> {
  const { request, site, locale, pluginId, result } = page;
  const theme = getCompiledTheme();
  const pathname = new URL(request.url).pathname;
  // Plain data only, as for `renderData`: whatever is not JSON never reaches
  // the template engine.
  const view = JSON.parse(JSON.stringify(result.view)) as Record<
    string,
    unknown
  >;
  const title =
    typeof result.title === 'string' && result.title !== ''
      ? result.title
      : site.name;
  const input = {
    title,
    description:
      typeof result.description === 'string' ? result.description : '',
    path: pathname,
    alternates: site.locales.map((candidate) => ({
      locale: candidate,
      path: pluginPagePath(
        pluginId,
        candidate,
        site.defaultLocale,
        page.segments,
      ),
    })),
    view,
  };
  const context = {
    settings: site,
    theme,
    origin: siteOrigin(site, request),
    locale,
    path: pathname,
  };

  const layoutPath = theme.manifest.pluginLayouts[page.layout];
  let html: string;
  if (layoutPath === undefined) {
    // A standing property of the build — this theme was not written for this
    // plugin — and the admin's plugin page says so as well.
    console.warn(
      JSON.stringify({
        event: 'plugin_layout_missing',
        plugin: pluginId,
        layout: page.layout,
        theme: theme.manifest.id,
      }),
    );
    html = builtInPage(locale, site.name, title, page.layout, view);
  } else {
    html = await renderPluginPageHtml(context, layoutPath, input);
  }

  const headers = new Headers(result.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('x-robots-tag', 'noindex');
  const status =
    typeof result.status === 'number' &&
    Number.isInteger(result.status) &&
    result.status >= 200 &&
    result.status <= 599
      ? result.status
      : 200;
  return new Response(html, { status, headers });
}

/**
 * The address of a plugin page in one locale: the default locale has no
 * segment, as on the rest of the site.
 */
export function pluginPagePath(
  pluginId: string,
  locale: string,
  defaultLocale: string,
  segments: readonly string[],
): string {
  const prefix = locale === defaultLocale ? '' : `${locale}/`;
  return `/_mallok/p/${pluginId}/${prefix}${segments
    .map(encodeURIComponent)
    .join('/')}`;
}

/**
 * The page shown when the theme has no layout for a plugin page.
 *
 * It cannot know what the view means, so it does not pretend to: it names
 * what is missing and lists the view's plain top-level values, which is
 * enough to see that the route works and not enough to be a shop. A site
 * that uses the plugin needs a theme that provides the layout.
 */
function builtInPage(
  locale: string,
  siteName: string,
  title: string,
  layout: string,
  view: Readonly<Record<string, unknown>>,
): string {
  const rows = Object.entries(view)
    .filter(
      ([, value]) =>
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
    )
    .map(
      ([key, value]) =>
        `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`,
    )
    .join('');
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(locale)}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)} — ${escapeHtml(siteName)}</title></head>`,
    '<body>',
    `<p><a href="/">${escapeHtml(siteName)}</a></p>`,
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>This site’s theme has no layout named <code>${escapeHtml(layout)}</code>, so this page is shown without one.</p>`,
    rows === '' ? '' : `<dl>${rows}</dl>`,
    '</body></html>',
  ].join('\n');
}
