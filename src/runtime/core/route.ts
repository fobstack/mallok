/**
 * Route patterns, matching and ranking.
 *
 * A route pattern is the file path the build found, with the extension and
 * the pages prefix stripped: `/products/[slug]`, `/docs/[...path]`, `/about`.
 * Three segment kinds, in the order they win a tie:
 *
 *   static  `/about`          — literal text
 *   param   `/[slug]`         — exactly one segment, captured
 *   rest    `/[...path]`      — the remainder, captured, may be empty
 *
 * Ranking is a left-to-right comparison, not a score. A single number cannot
 * express this: any positional weighting makes a longer pattern outrank a
 * shorter one, so `/[...path]` beat `/` and `/blog/[slug]/[...rest]` beat
 * `/blog/feed`. Specificity is decided by the first segment where two
 * patterns disagree, exactly as a reader would decide it.
 */

/** One piece of a route pattern, between two slashes. */
export type Segment =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'rest'; readonly name: string };

/** Parameters captured from a matched path. A rest segment joins with `/`. */
export type RouteParams = Readonly<Record<string, string>>;

const PARAM = /^\[([^.\]][^\]]*)\]$/;
const REST = /^\[\.\.\.([^\]]+)\]$/;

/** How much a segment kind narrows the set of paths that can match. */
const RANK: Readonly<Record<Segment['kind'], number>> = {
  static: 3,
  param: 2,
  rest: 1,
};

/**
 * Parses `/products/[slug]` into segments.
 *
 * Throws on a pattern the build cannot have meant: a rest segment that is not
 * last, or a malformed bracket. Failing here — at build time, where this
 * runs — is better than a route that silently never matches.
 */
export function parsePattern(pattern: string): readonly Segment[] {
  const raw = pattern.split('/').filter((part) => part !== '');
  const segments: Segment[] = [];
  for (const [index, part] of raw.entries()) {
    const rest = REST.exec(part);
    if (rest !== null) {
      if (index !== raw.length - 1) {
        throw new Error(`Rest segment "${part}" must be last in "${pattern}".`);
      }
      segments.push({ kind: 'rest', name: rest[1] as string });
      continue;
    }
    const param = PARAM.exec(part);
    if (param !== null) {
      segments.push({ kind: 'param', name: param[1] as string });
      continue;
    }
    if (part.includes('[') || part.includes(']')) {
      throw new Error(`Malformed segment "${part}" in "${pattern}".`);
    }
    segments.push({ kind: 'static', value: part });
  }
  return segments;
}

/**
 * Orders two patterns most-specific-first, for `Array.prototype.sort`.
 *
 * Walks both segment lists together and returns at the first difference:
 *
 *   static beats param beats rest at the same position;
 *   a pattern that ends beats one that continues with a rest, so `/` wins
 *     over `/[...path]` and `/blog` wins over `/blog/[...rest]`;
 *   otherwise the longer pattern sorts first, which only affects patterns
 *     that can never match the same path anyway.
 */
export function compareSpecificity(
  left: readonly Segment[],
  right: readonly Segment[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined && b === undefined) {
      return 0;
    }
    if (a === undefined) {
      // `left` ended here. Ending beats an optional rest that matches
      // nothing; against a concrete segment the two never collide, so the
      // longer one sorts first for a stable order.
      return b?.kind === 'rest' ? -1 : 1;
    }
    if (b === undefined) {
      return a.kind === 'rest' ? 1 : -1;
    }
    if (a.kind !== b.kind) {
      return RANK[b.kind] - RANK[a.kind];
    }
  }
  return 0;
}

/**
 * A pattern's shape, with parameter names erased.
 *
 * `/[id]` and `/[slug]` have the same shape and so can never be told apart
 * at request time — one would silently shadow the other. The build uses this
 * to reject the pair instead.
 */
export function shapeKey(segments: readonly Segment[]): string {
  return segments
    .map((segment) =>
      segment.kind === 'static' ? segment.value : `<${segment.kind}>`,
    )
    .join('/');
}

/** Splits a request pathname the same way `parsePattern` splits a pattern. */
export function splitPath(pathname: string): readonly string[] {
  return pathname.split('/').filter((part) => part !== '');
}

/**
 * Matches one pattern against an already-split path. Returns the captured
 * parameters, or `null` when the pattern does not apply.
 */
export function matchSegments(
  segments: readonly Segment[],
  parts: readonly string[],
): RouteParams | null {
  const params: Record<string, string> = {};
  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'rest') {
      params[segment.name] = parts
        .slice(index)
        .map((part) => safeDecode(part))
        .join('/');
      return params;
    }
    const part = parts[index];
    if (part === undefined) {
      return null;
    }
    if (segment.kind === 'static') {
      if (segment.value !== part) {
        return null;
      }
      continue;
    }
    params[segment.name] = safeDecode(part);
  }
  return parts.length === segments.length ? params : null;
}

/**
 * `decodeURIComponent` throws on a malformed escape, and a bad URL is a
 * request problem, not a crash: fall back to the raw text so the route can
 * still decide what to do with it.
 */
function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
