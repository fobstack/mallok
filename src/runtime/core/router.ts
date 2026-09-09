/**
 * Turning a request URL into a route, a locale and parameters.
 *
 * Routes are sorted once, when the router is created, so a request walks the
 * list only until the first match. Two routes that can never be told apart —
 * `blog.ts` and `blog/index.ts`, or `[id].ts` and `[slug].ts` — are rejected
 * there too: one would silently shadow the other, and which one wins would
 * depend on the order the file scanner happened to produce.
 */

import {
  compareSpecificity,
  matchSegments,
  parsePattern,
  type RouteParams,
  type Segment,
  shapeKey,
  splitPath,
} from './route.js';
import type { RouteEntry, RouteManifest } from './types.js';

interface CompiledRoute<Locals> {
  readonly entry: RouteEntry<Locals>;
  readonly segments: readonly Segment[];
}

/** A resolved request: which route, which locale, which parameters. */
export interface RouteMatch<Locals = unknown> {
  readonly entry: RouteEntry<Locals>;
  readonly pattern: string;
  readonly params: RouteParams;
  readonly locale: string;
  /** The path with any locale prefix removed, always starting with `/`. */
  readonly pathname: string;
}

/**
 * Locale settings for one request.
 *
 * Mallok keeps its locales in D1 and lets the admin change them, so they
 * cannot be baked into the build. A product may pass the resolved values per
 * request; the manifest's values are only the default.
 */
/**
 * Whether the default locale carries a URL prefix.
 *
 * `except-default` — `/products` is the default locale, `/de/products` is
 * German. One URL per page per language, nothing to canonicalise away.
 *
 * `always` — every language is prefixed and `/products` is not a page at all.
 * Storefronts that never want an unmarked URL choose this; the cost of getting
 * it wrong is the same content answering at two URLs.
 */
export type LocalePrefix = 'always' | 'except-default';

export interface LocaleResolution {
  readonly locales?: readonly string[];
  readonly defaultLocale?: string;
  readonly localePrefix?: LocalePrefix;
  /**
   * A pathname the product already stripped itself, when it resolves locales
   * its own way. Given this, the router does no prefix handling at all.
   */
  readonly pathname?: string;
  readonly locale?: string;
}

export class Router<Locals = unknown> {
  private readonly compiled: readonly CompiledRoute<Locals>[];
  private readonly locales: readonly string[];
  private readonly defaultLocale: string;
  private readonly localePrefix: LocalePrefix;

  constructor(manifest: RouteManifest<Locals>) {
    const compiled = manifest.routes.map((entry) => ({
      entry,
      segments: parsePattern(entry.pattern),
    }));
    assertNoConflicts(compiled);
    this.compiled = [...compiled].sort((left, right) =>
      compareSpecificity(left.segments, right.segments),
    );
    this.locales = manifest.locales ?? [];
    this.defaultLocale = manifest.defaultLocale ?? 'en';
    this.localePrefix = manifest.localePrefix ?? 'except-default';
  }

  /**
   * Resolves a pathname. Returns `null` when nothing matches, which the
   * caller turns into a 404 — the router does not invent an error page.
   */
  match(
    pathname: string,
    resolution: LocaleResolution = {},
  ): RouteMatch<Locals> | null {
    const resolved = this.resolveLocale(pathname, resolution);
    if (resolved === null) {
      // Under `always`, a path with no recognised locale prefix is not a
      // route at all — not the default locale's copy of one.
      return null;
    }
    const parts = splitPath(resolved.rest);
    for (const route of this.compiled) {
      const params = matchSegments(route.segments, parts);
      if (params !== null) {
        return {
          entry: route.entry,
          pattern: route.entry.pattern,
          params,
          locale: resolved.locale,
          pathname: resolved.rest,
        };
      }
    }
    return null;
  }

  /**
   * Splits `/zh/products/x` into the `zh` locale and `/products/x`.
   *
   * The default locale never carries a prefix, so `/products/x` resolves to
   * it — one URL per page per language, with no `/en/` duplicate to
   * canonicalise away later. A product that resolved the locale itself
   * passes both values and this does nothing.
   */
  private resolveLocale(
    pathname: string,
    resolution: LocaleResolution,
  ): { locale: string; rest: string } | null {
    if (resolution.pathname !== undefined && resolution.locale !== undefined) {
      return { locale: resolution.locale, rest: resolution.pathname };
    }
    const locales = resolution.locales ?? this.locales;
    const fallback = resolution.defaultLocale ?? this.defaultLocale;
    const prefix = resolution.localePrefix ?? this.localePrefix;
    const parts = splitPath(pathname);
    const first = parts[0];
    if (first !== undefined && locales.includes(first)) {
      return { locale: first, rest: `/${parts.slice(1).join('/')}` };
    }
    return prefix === 'always' ? null : { locale: fallback, rest: pathname };
  }
}

/**
 * Rejects routes that cannot be told apart at request time.
 *
 * Reported together rather than one at a time: a scanner that produced one
 * collision has usually produced several, and fixing them one build at a
 * time is miserable.
 */
function assertNoConflicts<Locals>(
  routes: readonly CompiledRoute<Locals>[],
): void {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const route of routes) {
    const key = shapeKey(route.segments);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, route.entry.pattern);
      continue;
    }
    clashes.push(`"${first}" and "${route.entry.pattern}"`);
  }
  if (clashes.length > 0) {
    throw new Error(
      `Routes collide and cannot both be reachable: ${clashes.join('; ')}.`,
    );
  }
}
