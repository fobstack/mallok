/**
 * The request lifecycle.
 *
 *   match → load | action → head → render → document → cache policy
 *
 * Any step may return a `Response` instead of data and the rest is skipped;
 * that is how a page redirects, 404s or answers a form post with a
 * `303 See Other`. There is no separate middleware pipeline: a step that
 * wants to intervene returns a response, one that does not returns data.
 *
 * Exactly one component writes the `<html>`. The runtime owns the lifecycle,
 * the head, the cache semantics and which islands a page used; the product's
 * document renderer turns those into the final document. The built-in shell
 * is only used when a product supplies none.
 */

import { renderHead } from './head.js';
import { type LocaleResolution, Router } from './router.js';
import type {
  CachePolicy,
  DocumentRenderer,
  HeadDescriptor,
  IslandUse,
  PageContext,
  PageData,
  PageModule,
  RenderResult,
  RouteManifest,
} from './types.js';

/** What the adapter supplies per request beyond the request itself. */
export interface HandleOptions<Locals = unknown> {
  readonly locals?: Locals;
  /** The product's document renderer. Falls back to a minimal shell. */
  readonly document?: DocumentRenderer<PageData, Locals>;
  /** Locale settings resolved for this request (§ request-time locales). */
  readonly locale?: LocaleResolution;
}

/** The runtime's answer, before any platform concern touches it. */
export interface PageResult {
  readonly response: Response;
  /**
   * How the response may be cached. The adapter decides what to do with it;
   * the core never touches a cache itself.
   */
  readonly cache: CachePolicy;
}

const DEFAULT_DOCUMENT: DocumentRenderer = ({ head, body, locale, islands }) =>
  `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${body}
${islands}
</body>
</html>`;

/** Marks an island in rendered markup, with the id holding its props. */
/**
 * Marks an island in rendered markup.
 *
 * Only the name is needed: the props live inside the placeholder rather than
 * in a separate element addressed by id, so there is nothing else to correlate.
 * `data-island="` cannot match `data-island-strategy="`, which is what keeps
 * this from counting an island twice.
 */
const ISLAND_MARKER = /data-island="([^"]+)"/g;

const NO_STORE: CachePolicy = { mode: 'no-store' };

/** A page runtime bound to one manifest. Create it once per isolate. */
export class Runtime<Locals = unknown> {
  private readonly router: Router<Locals>;
  private readonly manifest: RouteManifest<Locals>;

  constructor(manifest: RouteManifest<Locals>) {
    this.manifest = manifest;
    this.router = new Router(manifest);
  }

  /**
   * Runs one request through the lifecycle.
   *
   * Returns `null` when no route matched, so the caller can fall through to
   * its own 404 — which for a themed site is itself a page, rendered by this
   * same lifecycle with a 404 status.
   */
  async handle(
    request: Request,
    options: HandleOptions<Locals> = {},
  ): Promise<PageResult | null> {
    const url = new URL(request.url);
    const matched = this.router.match(url.pathname, options.locale ?? {});
    if (matched === null) {
      return null;
    }

    const module: PageModule<PageData, Locals> = await matched.entry.load();
    const context: PageContext<Locals> = {
      request,
      url,
      params: matched.params,
      route: matched.pattern,
      locale: matched.locale,
      pathname: matched.pathname,
      locals: options.locals as Locals,
    };

    const method = request.method.toUpperCase();
    const isRead = method === 'GET' || method === 'HEAD';
    const produced = isRead
      ? await runLoad(module, context)
      : await runAction(module, context);
    if (produced instanceof Response) {
      // A response a page built itself is opaque to the runtime: it may carry
      // a session cookie or a redirect, so it is never cacheable by default.
      return { response: produced, cache: NO_STORE };
    }

    const head: HeadDescriptor =
      module.head === undefined ? {} : await module.head(produced, context);
    const output = normalise(await module.render(produced, context));
    const uses = this.islandUses(output.body);
    const document =
      options.document ??
      (DEFAULT_DOCUMENT as DocumentRenderer<PageData, Locals>);
    const html = await document({
      head: renderHead(head),
      body: output.body,
      islands: this.islandTags(uses),
      islandUses: uses,
      locale: matched.locale,
      data: produced,
      context,
    });

    const policy: CachePolicy =
      module.cache === undefined ? NO_STORE : module.cache(produced, context);
    return {
      response: htmlResponse(html, output.status ?? 200, output.headers),
      cache: policy,
    };
  }

  /** Islands a rendered body actually used, in document order. */
  private islandUses(body: string): readonly IslandUse[] {
    const islands = this.manifest.islands ?? {};
    const uses: IslandUse[] = [];
    for (const match of body.matchAll(ISLAND_MARKER)) {
      const name = match[1];
      if (name !== undefined && islands[name] !== undefined) {
        uses.push({ name });
      }
    }
    return uses;
  }

  /**
   * The scripts a page with islands needs.
   *
   * One bootstrap, however many islands the page used: it is the only module
   * that calls `mountIslands`, and it pulls each component in on demand
   * through the registry. Linking the component chunks directly instead would
   * download them and mount nothing.
   *
   * The components a page did use are preloaded, so the round trip the
   * bootstrap is about to make has already started.
   *
   * A page that rendered no island gets nothing, which is what keeps "this
   * page ships no JavaScript" a property you can check rather than hope for.
   */
  private islandTags(uses: readonly IslandUse[]): string {
    const bootstrap = this.manifest.islandBootstrap;
    if (uses.length === 0 || bootstrap === undefined) {
      return '';
    }
    const islands = this.manifest.islands ?? {};
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const use of uses) {
      if (seen.has(use.name)) {
        continue;
      }
      seen.add(use.name);
      const entry = islands[use.name];
      if (entry === undefined) {
        continue;
      }
      for (const preload of [entry.src, ...(entry.imports ?? [])]) {
        tags.push(`<link rel="modulepreload" href="${preload}">`);
      }
    }
    tags.push(`<script type="module" src="${bootstrap}"></script>`);
    return tags.join('\n');
  }
}

function normalise(result: RenderResult): {
  body: string;
  status?: number;
  headers?: Readonly<Record<string, string>>;
} {
  return typeof result === 'string' ? { body: result } : result;
}

async function runLoad<Locals>(
  module: PageModule<PageData, Locals>,
  context: PageContext<Locals>,
): Promise<PageData | Response> {
  if (module.load === undefined) {
    return {};
  }
  return await module.load(context);
}

async function runAction<Locals>(
  module: PageModule<PageData, Locals>,
  context: PageContext<Locals>,
): Promise<PageData | Response> {
  if (module.action === undefined) {
    return new Response('Method not allowed.', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  return await module.action(context);
}

function htmlResponse(
  html: string,
  status: number,
  extra: Readonly<Record<string, string>> | undefined,
): Response {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  for (const [name, value] of Object.entries(extra ?? {})) {
    headers.set(name, value);
  }
  return new Response(html, { status, headers });
}
