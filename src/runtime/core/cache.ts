/**
 * Cache semantics, kept platform-neutral.
 *
 * A `CachePolicy` says what a page is willing to have happen; nothing here
 * stores anything. The Cloudflare adapter reads a policy and decides how to
 * act on it, so the rules a reviewer needs to check — what may be stored,
 * what must never be — live in one file that has no platform API in it.
 */

import type { CachePolicy } from './types.js';

/**
 * Cloudflare's limits for the `Cache-Tag` header
 * (developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/):
 * printable ASCII only, no spaces, and 16 KB for the whole header. An
 * individual tag has no documented length limit, but a purge API call caps a
 * tag at 1024 characters, so a longer one is useless — it could be written
 * but never purged.
 */
export const TAG_MAX_LENGTH = 1024;
export const TAG_HEADER_MAX_BYTES = 16 * 1024;

const PRINTABLE_ASCII_NO_SPACE = /^[\x21-\x7e]+$/;

export interface TagValidation {
  readonly tags: readonly string[];
  readonly rejected: readonly { tag: string; reason: string }[];
}

/**
 * Filters a policy's tags to the ones Cloudflare will actually accept.
 *
 * Rejects rather than throws: one malformed tag on one page should not turn
 * a working page into a 500. The caller decides whether to log the rejects —
 * silently dropping them is how a purge quietly stops working months later.
 */
export function validateTags(tags: readonly string[]): TagValidation {
  const accepted: string[] = [];
  const rejected: { tag: string; reason: string }[] = [];
  let bytes = 0;
  for (const tag of tags) {
    if (tag.length === 0) {
      rejected.push({ tag, reason: 'empty' });
      continue;
    }
    if (tag.length > TAG_MAX_LENGTH) {
      rejected.push({
        tag,
        reason: `longer than ${TAG_MAX_LENGTH} characters`,
      });
      continue;
    }
    if (!PRINTABLE_ASCII_NO_SPACE.test(tag)) {
      rejected.push({
        tag,
        reason: 'must be printable ASCII with no spaces or commas',
      });
      continue;
    }
    if (tag.includes(',')) {
      rejected.push({ tag, reason: 'contains a comma, the header separator' });
      continue;
    }
    if (accepted.includes(tag)) {
      continue;
    }
    // +1 for the separating comma once there is more than one tag.
    const cost = tag.length + (accepted.length === 0 ? 0 : 1);
    if (bytes + cost > TAG_HEADER_MAX_BYTES) {
      rejected.push({ tag, reason: 'would exceed the 16 KB header limit' });
      continue;
    }
    bytes += cost;
    accepted.push(tag);
  }
  return { tags: accepted, rejected };
}

/**
 * The `Cache-Control` a policy implies.
 *
 * `browserSeconds` defaults to 0 on purpose: a page can live in the edge
 * cache for an hour and still be re-fetched by a browser on reload, which is
 * what makes an edit look immediate to the person who made it. Inheriting the
 * edge lifetime instead would leave editors staring at their own stale page.
 *
 * `s-maxage` is written only when it would say something `max-age` does not.
 * A shared cache already honours `max-age`, so repeating the same number as
 * `s-maxage` adds a header field and no meaning.
 */
export function cacheControlFor(policy: CachePolicy): string {
  if (policy.mode === 'no-store') {
    return 'no-store';
  }
  const browser = policy.browserSeconds ?? 0;
  const edge = policy.edgeSeconds ?? 0;
  const parts = [`public, max-age=${browser}`];
  if (edge > 0 && edge !== browser) {
    parts.push(`s-maxage=${edge}`);
  }
  return parts.join(', ');
}

/**
 * Whether a `Cache-Control` value rules out a shared cache.
 *
 * Matched case-insensitively, because HTTP field values are: `Private` and
 * `No-Store` are what plenty of frameworks actually emit, and a case-sensitive
 * check would quietly store every one of them. The surrounding delimiters stop
 * `no-store-hint` or a token ending in `private` from counting.
 */
export function forbidsSharedCaching(value: string): boolean {
  return /(^|[\s,])(private|no-store)([\s,;=]|$)/i.test(value);
}

/** Whether a `Cache-Control` value grants shared caching. */
export function grantsSharedCaching(value: string): boolean {
  return /(^|[\s,])public([\s,;=]|$)/i.test(value);
}

/**
 * Whether a response may be written to a shared cache at all.
 *
 * The checks that are not about the page's own wishes live here: a response
 * carrying a cookie, marked private, or varying on everything is not safe in
 * a shared cache no matter what the page asked for. Getting this wrong serves
 * one visitor's session to the next one, so it is deliberately a separate,
 * testable function rather than a condition inside the adapter.
 */
export function isStorable(
  policy: CachePolicy,
  response: Response,
): { storable: boolean; reason?: string } {
  if (policy.mode !== 'public') {
    return { storable: false, reason: 'policy is not public' };
  }
  if ((policy.edgeSeconds ?? 0) <= 0) {
    return { storable: false, reason: 'no edge lifetime' };
  }
  if (response.status !== 200) {
    return { storable: false, reason: `status ${response.status}` };
  }
  if (response.headers.has('set-cookie')) {
    return { storable: false, reason: 'response sets a cookie' };
  }
  if (forbidsSharedCaching(response.headers.get('cache-control') ?? '')) {
    return { storable: false, reason: 'cache-control forbids it' };
  }
  if ((response.headers.get('vary') ?? '').trim() === '*') {
    return { storable: false, reason: 'vary: *' };
  }
  if (response.headers.has('authorization')) {
    return { storable: false, reason: 'response is authorization-dependent' };
  }
  return { storable: true };
}

/**
 * What a request's `Cookie` header means for shared caching.
 *
 * `none`      — no cookies at all.
 * `ignorable` — every cookie present was declared inert by the product.
 * `blocking`  — anything else: an undeclared name, or a header that does not
 *               parse. Both are treated the same on purpose, because a header
 *               we cannot read is a header we cannot vouch for.
 */
export type CookieVerdict = 'none' | 'ignorable' | 'blocking';

export function classifyCookies(
  header: string | null,
  ignored: readonly string[],
): CookieVerdict {
  if (header === null) {
    return 'none';
  }
  // A header that was sent but carries nothing parsable is malformed, not
  // absent. Treating it as absent would make an empty `Cookie:` a way past
  // the check.
  if (header.trim() === '' || ignored.length === 0) {
    return 'blocking';
  }
  const allowed = new Set(ignored);
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    if (trimmed === '') {
      // A stray separator: the header is malformed, so nothing in it counts.
      return 'blocking';
    }
    const equals = trimmed.indexOf('=');
    if (equals <= 0) {
      return 'blocking';
    }
    if (!allowed.has(trimmed.slice(0, equals).trim())) {
      return 'blocking';
    }
  }
  return 'ignorable';
}

/**
 * Whether a request may be served from, or written to, a shared cache.
 *
 * A request carrying credentials is the other half of the same problem: the
 * response to it is very likely personalised even when the page did not
 * think to say so.
 */
export function isCacheableRequest(
  request: Request,
  ignoredCookies: readonly string[] = [],
): boolean {
  // HEAD is included because it must be answerable from the entry a GET
  // stored: it is the same response without the body, and a monitor checking
  // headers with HEAD should see what a visitor's GET would see. Writing is a
  // separate question — a HEAD has no body to store.
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }
  if (request.headers.has('authorization')) {
    return false;
  }
  // Sites with a session cookie would otherwise cache the signed-in view of a
  // page and hand it to everyone. A product may declare specific cookies its
  // HTML provably does not depend on; anything else still blocks.
  return (
    classifyCookies(request.headers.get('cookie'), ignoredCookies) !==
    'blocking'
  );
}
