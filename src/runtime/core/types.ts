/**
 * The page contract.
 *
 * A page module exports some of `load`, `action`, `head`, `render` and
 * `cache`. Only `render` is required — a page with nothing else is a static
 * one, which is the common case and should cost nothing to declare.
 *
 * The lifecycle runs in that order, and each step can stop it by returning a
 * `Response`: a `load` that returns a redirect never reaches `render`. That
 * is the whole control-flow story; there is no separate "middleware returns
 * next()" convention to learn.
 */

import type { RouteParams } from './route.js';

/** What a page's own data step produced. Opaque to the runtime. */
export type PageData = Record<string, unknown>;

/** Everything a lifecycle step is given about the request. */
export interface PageContext<Locals = unknown> {
  readonly request: Request;
  readonly url: URL;
  readonly params: RouteParams;
  /** The pattern that matched, for logging and cache keys. */
  readonly route: string;
  /** Locale resolved from the URL prefix, or supplied by the product. */
  readonly locale: string;
  /** The path with any locale prefix removed. */
  readonly pathname: string;
  /** Whatever the adapter chose to pass through: bindings, a db handle. */
  readonly locals: Locals;
}

/**
 * What `render` returns.
 *
 * A bare string is the common case and stays allowed. The object form exists
 * because a themed 404 has to be all of: status 404, a `noindex` head, the
 * theme's own Liquid output and the theme's document — returning a string
 * would force the status to be decided somewhere that cannot see the theme.
 */
export interface PageOutput {
  readonly body: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export type RenderResult = string | PageOutput;

/** A `<head>` description. The runtime serialises it; pages never write tags. */
export interface HeadDescriptor {
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string;
  /** `hreflang` alternates, keyed by locale; `x-default` is allowed. */
  readonly alternates?: Readonly<Record<string, string>>;
  /** `<meta name=... content=...>` pairs. */
  readonly meta?: Readonly<Record<string, string>>;
  /** `<meta property=... content=...>` pairs, for Open Graph. */
  readonly property?: Readonly<Record<string, string>>;
  /** JSON-LD objects, serialised into `<script type="application/ld+json">`. */
  readonly jsonLd?: readonly Record<string, unknown>[];
  /** `<link>` tags beyond canonical and alternates. */
  readonly links?: readonly Readonly<Record<string, string>>[];
}

/**
 * How a response may be cached, in platform-neutral terms.
 *
 * `edgeSeconds` and `browserSeconds` are separate because they are separate
 * decisions: a product page can sit in the edge cache for an hour while
 * browsers are told not to keep it at all, so an edit is visible on reload.
 * `browserSeconds` therefore defaults to 0 rather than inheriting the edge
 * lifetime.
 *
 * `tags` belong to the data the page read, not to its URL: a product's tag on
 * every page that displayed it is what makes one purge drop all of them.
 */
export interface CachePolicy {
  readonly mode: 'no-store' | 'public';
  readonly edgeSeconds?: number;
  readonly browserSeconds?: number;
  readonly tags?: readonly string[];
}

/** A page module, as the route manifest imports it. */
export interface PageModule<
  Data extends PageData = PageData,
  Locals = unknown,
> {
  readonly load?: (
    context: PageContext<Locals>,
  ) => Promise<Data | Response> | Data | Response;
  readonly action?: (
    context: PageContext<Locals>,
  ) => Promise<Data | Response> | Data | Response;
  readonly head?: (
    data: Data,
    context: PageContext<Locals>,
  ) => HeadDescriptor | Promise<HeadDescriptor>;
  readonly render: (
    data: Data,
    context: PageContext<Locals>,
  ) => RenderResult | Promise<RenderResult>;
  readonly cache?: (data: Data, context: PageContext<Locals>) => CachePolicy;
}

/**
 * One entry in the build-time route manifest.
 *
 * The page's own data shape is erased here, because a manifest holds pages
 * that have nothing in common: every one has its own `load` return type, and
 * no single type describes them all. `definePage` infers that shape inside a
 * page — which is where it is useful — and hands back the erased type, which
 * is what a manifest can actually store.
 */
export interface RouteEntry<Locals = unknown> {
  /** `/products/[slug]`, as `parsePattern` accepts it. */
  readonly pattern: string;
  /** Imports the page module. Dynamic, so a route costs nothing until used. */
  readonly load: () => Promise<PageModule<PageData, Locals>>;
}

/** What the Vite plugin emits and the adapter hands to the runtime. */
export interface RouteManifest<Locals = unknown> {
  readonly routes: readonly RouteEntry<Locals>[];
  /** Default locale prefixes; a product may override these per request. */
  readonly locales?: readonly string[];
  /** The locale with no URL prefix. */
  readonly defaultLocale?: string;
  /**
   * Whether the default locale carries a prefix too. Default `except-default`.
   */
  readonly localePrefix?: 'always' | 'except-default';
  /** Islands the build found, keyed by the name templates refer to them by. */
  readonly islands?: Readonly<Record<string, IslandEntry>>;
  /**
   * Hashed URL of the client bootstrap — the module that calls `mountIslands`.
   *
   * A page with islands loads this one file. It is not an island's own chunk:
   * those are imported by the bootstrap on demand, through the registry, so a
   * page downloads only the components it actually used.
   */
  readonly islandBootstrap?: string;
}

/** A client component the build compiled and will mount. */
export interface IslandEntry {
  /** Public URL of the built module, e.g. `/_islands/cart-BQ4x.js`. */
  readonly src: string;
  /** Modules to preload with it, if the build split any out. */
  readonly imports?: readonly string[];
}

/** One island occurrence found in rendered markup. */
export interface IslandUse {
  readonly name: string;
}

/**
 * Everything the document renderer is given.
 *
 * The theme owns the final `<html>`: the runtime supplies the parts and the
 * semantics, and exactly one component writes the document. `data` and
 * `context` are included because a theme's shell usually needs the page's own
 * data — the site name, the active locale's alternates, a body class.
 */
export interface DocumentParts<
  Data extends PageData = PageData,
  Locals = unknown,
> {
  /** Serialised head tags from the page's `head` export. */
  readonly head: string;
  /** The page's rendered body. */
  readonly body: string;
  /** Script and preload tags for the islands this page used. */
  readonly islands: string;
  /** The islands themselves, for a theme that places them differently. */
  readonly islandUses: readonly IslandUse[];
  readonly locale: string;
  readonly data: Data;
  readonly context: PageContext<Locals>;
}

/** Assembles the final HTML document. May be async: themes load templates. */
export type DocumentRenderer<
  Data extends PageData = PageData,
  Locals = unknown,
> = (parts: DocumentParts<Data, Locals>) => string | Promise<string>;
