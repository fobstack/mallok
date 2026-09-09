import { describe, expect, it } from 'vitest';
import {
  compareSpecificity,
  matchSegments,
  parsePattern,
  shapeKey,
  splitPath,
} from '../../src/runtime/core/route.js';
import { Router } from '../../src/runtime/core/router.js';

/** Sorts patterns the way the router does, most specific first. */
function rank(patterns: readonly string[]): string[] {
  return [...patterns].sort((left, right) =>
    compareSpecificity(parsePattern(left), parsePattern(right)),
  );
}

describe('parsePattern', () => {
  it('reads the three segment kinds', () => {
    expect(parsePattern('/products/[slug]')).toEqual([
      { kind: 'static', value: 'products' },
      { kind: 'param', name: 'slug' },
    ]);
    expect(parsePattern('/docs/[...path]')).toEqual([
      { kind: 'static', value: 'docs' },
      { kind: 'rest', name: 'path' },
    ]);
    expect(parsePattern('/')).toEqual([]);
  });

  it('refuses a rest segment that is not last', () => {
    expect(() => parsePattern('/[...rest]/edit')).toThrow(/must be last/);
  });

  it('refuses a malformed segment rather than treating it as literal text', () => {
    expect(() => parsePattern('/products/[slug')).toThrow(/Malformed/);
    expect(() => parsePattern('/products/slug]')).toThrow(/Malformed/);
  });
});

describe('specificity ranking', () => {
  // The cases below are the ones a scalar score got wrong: any positional
  // weighting makes a longer pattern outrank a shorter one, so a nullable
  // catch-all stole traffic from exact routes.
  it('puts / ahead of a root catch-all', () => {
    expect(rank(['/[...path]', '/'])[0]).toBe('/');
  });

  it('puts an exact route ahead of param-plus-catch-all', () => {
    expect(rank(['/[x]/[...rest]', '/foo'])[0]).toBe('/foo');
  });

  it('puts /blog/feed ahead of /blog/[slug]/[...rest]', () => {
    expect(rank(['/blog/[slug]/[...rest]', '/blog/feed'])[0]).toBe(
      '/blog/feed',
    );
  });

  it('ranks static above param above rest at the same position', () => {
    expect(rank(['/blog/[...rest]', '/blog/[slug]', '/blog/feed'])).toEqual([
      '/blog/feed',
      '/blog/[slug]',
      '/blog/[...rest]',
    ]);
  });

  it('prefers an exact ending over a rest that would match nothing', () => {
    expect(rank(['/blog/[...rest]', '/blog'])[0]).toBe('/blog');
  });
});

describe('shapeKey', () => {
  it('erases parameter names, so [id] and [slug] collide', () => {
    expect(shapeKey(parsePattern('/[id]'))).toBe(
      shapeKey(parsePattern('/[slug]')),
    );
  });

  it('keeps different shapes apart', () => {
    expect(shapeKey(parsePattern('/[id]'))).not.toBe(
      shapeKey(parsePattern('/[...id]')),
    );
    expect(shapeKey(parsePattern('/blog'))).not.toBe(
      shapeKey(parsePattern('/[blog]')),
    );
  });
});

describe('matchSegments', () => {
  it('captures a parameter', () => {
    expect(
      matchSegments(
        parsePattern('/products/[slug]'),
        splitPath('/products/gr5'),
      ),
    ).toEqual({ slug: 'gr5' });
  });

  it('captures the remainder of a rest route, including nothing', () => {
    const segments = parsePattern('/docs/[...path]');
    expect(matchSegments(segments, splitPath('/docs/a/b/c'))).toEqual({
      path: 'a/b/c',
    });
    expect(matchSegments(segments, splitPath('/docs'))).toEqual({ path: '' });
  });

  it('does not match a path of the wrong length', () => {
    const segments = parsePattern('/products/[slug]');
    expect(matchSegments(segments, splitPath('/products'))).toBeNull();
    expect(matchSegments(segments, splitPath('/products/a/b'))).toBeNull();
  });

  it('decodes an escaped segment, and survives a malformed one', () => {
    const segments = parsePattern('/tags/[name]');
    expect(matchSegments(segments, splitPath('/tags/b%C3%BCro'))).toEqual({
      name: 'büro',
    });
    expect(matchSegments(segments, splitPath('/tags/%E0%A4%A'))).toEqual({
      name: '%E0%A4%A',
    });
  });
});

describe('the locale prefix policy', () => {
  const manifest = {
    locales: ['en', 'de'],
    defaultLocale: 'en',
    routes: [
      {
        pattern: '/products',
        load: () => Promise.resolve({ render: () => 'list' }),
      },
      {
        pattern: '/products/[slug]',
        load: () => Promise.resolve({ render: () => 'one' }),
      },
    ],
  };

  it('leaves the default locale unprefixed by default', () => {
    const router = new Router(manifest);
    expect(router.match('/products')?.locale).toBe('en');
    expect(router.match('/de/products')?.locale).toBe('de');
  });

  it('can require a prefix on every locale, the default included', () => {
    // Some storefronts give every language a prefix, so `/products` is not a
    // page at all. Without this the default locale silently answers it, and
    // the same content lives at two URLs — which is a duplicate-content
    // problem no canonical tag fully repairs.
    const router = new Router({ ...manifest, localePrefix: 'always' });

    expect(router.match('/en/products')?.locale).toBe('en');
    expect(router.match('/en/products')?.pathname).toBe('/products');
    expect(router.match('/de/products')?.locale).toBe('de');

    // Unprefixed and unknown-locale paths are not routes.
    expect(router.match('/products')).toBeNull();
    expect(router.match('/products/widget')).toBeNull();
    expect(router.match('/it/products')).toBeNull();
    expect(router.match('/')).toBeNull();
  });

  it('takes the policy per request as well, for data-driven locales', () => {
    const router = new Router(manifest);
    expect(
      router.match('/products', {
        locales: ['en', 'de'],
        localePrefix: 'always',
      }),
    ).toBeNull();
    expect(
      router.match('/en/products', {
        locales: ['en', 'de'],
        localePrefix: 'always',
      })?.locale,
    ).toBe('en');
  });
});
