import { describe, expect, it } from 'vitest';
import {
  cacheControlFor,
  isCacheableRequest,
  isStorable,
  validateTags,
} from '../../src/runtime/core/cache.js';
import type { CachePolicy } from '../../src/runtime/core/types.js';

const PUBLIC: CachePolicy = { mode: 'public', edgeSeconds: 300 };

describe('cacheControlFor', () => {
  it('keeps the browser lifetime at zero unless asked otherwise', () => {
    // An editor reloading their own page must see the edit, even while the
    // edge copy is still warm for everyone else.
    expect(cacheControlFor(PUBLIC)).toBe('public, max-age=0, s-maxage=300');
    expect(cacheControlFor({ ...PUBLIC, browserSeconds: 60 })).toBe(
      'public, max-age=60, s-maxage=300',
    );
  });

  it('says no-store when the page did not opt in', () => {
    expect(cacheControlFor({ mode: 'no-store' })).toBe('no-store');
  });

  it('omits s-maxage when it would repeat max-age', () => {
    // A shared cache already honours max-age, so the same number again says
    // nothing. Products that want one lifetime everywhere get one directive.
    expect(
      cacheControlFor({
        mode: 'public',
        edgeSeconds: 300,
        browserSeconds: 300,
      }),
    ).toBe('public, max-age=300');
  });
});

describe('validateTags', () => {
  it('accepts ordinary tags and drops duplicates', () => {
    expect(validateTags(['product:1', 'nav', 'product:1']).tags).toEqual([
      'product:1',
      'nav',
    ]);
  });

  it('rejects what Cloudflare will not accept, and says why', () => {
    const { tags, rejected } = validateTags([
      'has space',
      'has,comma',
      '',
      'ok',
      'é-not-ascii',
    ]);
    expect(tags).toEqual(['ok']);
    expect(rejected.map((entry) => entry.tag)).toEqual([
      'has space',
      'has,comma',
      '',
      'é-not-ascii',
    ]);
  });

  it('stops before the 16 KB header limit rather than emitting a broken header', () => {
    const many = Array.from(
      { length: 40 },
      (_, index) => `${String(index).padStart(4, '0')}${'t'.repeat(1000)}`,
    );
    const { tags, rejected } = validateTags(many);
    const headerBytes = tags.join(',').length;
    expect(headerBytes).toBeLessThanOrEqual(16 * 1024);
    expect(rejected.length).toBeGreaterThan(0);
  });

  it('rejects a tag too long for a purge call to ever name', () => {
    expect(validateTags(['x'.repeat(1025)]).tags).toEqual([]);
  });
});

describe('isStorable', () => {
  const ok = new Response('hi', { status: 200 });

  it('stores only what a page marked public with an edge lifetime', () => {
    expect(isStorable(PUBLIC, ok).storable).toBe(true);
    expect(isStorable({ mode: 'no-store' }, ok).storable).toBe(false);
    expect(isStorable({ mode: 'public' }, ok).storable).toBe(false);
  });

  it('never stores a response that carries a cookie', () => {
    // The failure this prevents is serving one visitor's session to the next.
    const response = new Response('hi', {
      status: 200,
      headers: { 'set-cookie': 'session=abc' },
    });
    expect(isStorable(PUBLIC, response)).toEqual({
      storable: false,
      reason: 'response sets a cookie',
    });
  });

  it('respects private, no-store and vary: *', () => {
    for (const headers of [
      { 'cache-control': 'private' },
      { 'cache-control': 'no-store' },
      { vary: '*' },
      { authorization: 'Bearer x' },
    ]) {
      expect(
        isStorable(PUBLIC, new Response('hi', { status: 200, headers }))
          .storable,
      ).toBe(false);
    }
  });

  it('does not store a non-200', () => {
    expect(
      isStorable(PUBLIC, new Response('nope', { status: 404 })).storable,
    ).toBe(false);
  });
});

describe('isCacheableRequest', () => {
  it('only ever caches a plain GET', () => {
    const url = 'https://example.com/';
    expect(isCacheableRequest(new Request(url))).toBe(true);
    expect(isCacheableRequest(new Request(url, { method: 'POST' }))).toBe(
      false,
    );
  });

  it('bypasses anything that looks signed in', () => {
    const url = 'https://example.com/';
    expect(
      isCacheableRequest(new Request(url, { headers: { cookie: 'a=b' } })),
    ).toBe(false);
    expect(
      isCacheableRequest(
        new Request(url, { headers: { authorization: 'Bearer x' } }),
      ),
    ).toBe(false);
  });
});
