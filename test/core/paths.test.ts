import { describe, expect, it } from 'vitest';
import {
  buildHomePath,
  buildPublicPath,
  canonicalSlug,
  localePrefix,
  parsePublicPath,
  slugify,
  slugPlacementProblem,
  slugProblem,
} from '../../src/core/index.js';

describe('buildPublicPath', () => {
  it('omits the prefix for the default locale', () => {
    expect(
      buildPublicPath({
        kind: 'article',
        locale: 'en',
        defaultLocale: 'en',
        slug: 'a',
        base: 'news',
      }),
    ).toBe('/news/a');
  });

  it('prefixes other locales and drops the base for pages', () => {
    expect(
      buildPublicPath({
        kind: 'page',
        locale: 'de',
        defaultLocale: 'en',
        slug: 'about',
        base: '',
      }),
    ).toBe('/de/about');
  });

  it('builds home paths', () => {
    expect(buildHomePath('en', 'en')).toBe('/');
    expect(buildHomePath('de', 'en')).toBe('/de/');
  });
});

describe('parsePublicPath', () => {
  const locales = ['en', 'de', 'zh'];

  it('detects enabled locale prefixes', () => {
    expect(parsePublicPath('/de/news/a', locales, 'en')).toEqual({
      locale: 'de',
      rest: '/news/a',
      prefixed: true,
    });
    expect(parsePublicPath('/de', locales, 'en')).toEqual({
      locale: 'de',
      rest: '/',
      prefixed: true,
    });
  });

  it('keeps unknown prefixes in the default locale', () => {
    expect(parsePublicPath('/fr/news', locales, 'en')).toEqual({
      locale: 'en',
      rest: '/fr/news',
      prefixed: true,
    });
    expect(parsePublicPath('/news/a', locales, 'en')).toEqual({
      locale: 'en',
      rest: '/news/a',
      prefixed: true,
    });
  });
});

describe('the default locale prefixed too (Task 49)', () => {
  const locales = ['en', 'zh-cn'];

  it('puts every locale under its prefix', () => {
    const path = (locale: string, kind = 'rest-api', base = 'rest-api') =>
      buildPublicPath({
        kind,
        locale,
        defaultLocale: 'en',
        prefixDefaultLocale: true,
        slug: 'quote',
        base,
      });
    expect(path('en')).toBe('/en/rest-api/quote');
    expect(path('zh-cn')).toBe('/zh-cn/rest-api/quote');
    expect(path('en', 'page', '')).toBe('/en/quote');
  });

  it('makes each home the bare prefix, without a trailing slash', () => {
    expect(buildHomePath('en', 'en', true)).toBe('/en');
    expect(buildHomePath('zh-cn', 'en', true)).toBe('/zh-cn');
    // Off, the paths every existing site has stay as they were.
    expect(buildHomePath('en', 'en', false)).toBe('/');
    expect(buildHomePath('zh-cn', 'en')).toBe('/zh-cn/');
  });

  it("names a locale's prefix in one place", () => {
    expect(localePrefix('en', { defaultLocale: 'en' })).toBe('');
    expect(
      localePrefix('en', { defaultLocale: 'en', prefixDefaultLocale: true }),
    ).toBe('/en');
    expect(localePrefix('zh-cn', { defaultLocale: 'en' })).toBe('/zh-cn');
  });

  it('reads the default locale as a prefix, and marks a path without one', () => {
    expect(parsePublicPath('/en/faq/renewal', locales, 'en', true)).toEqual({
      locale: 'en',
      rest: '/faq/renewal',
      prefixed: true,
    });
    expect(parsePublicPath('/en', locales, 'en', true)).toEqual({
      locale: 'en',
      rest: '/',
      prefixed: true,
    });
    expect(parsePublicPath('/faq/renewal', locales, 'en', true)).toEqual({
      locale: 'en',
      rest: '/faq/renewal',
      prefixed: false,
    });
    expect(parsePublicPath('/', locales, 'en', true)).toEqual({
      locale: 'en',
      rest: '/',
      prefixed: false,
    });
  });

  it('leaves the default code an ordinary path segment when off', () => {
    expect(parsePublicPath('/en/faq', locales, 'en')).toEqual({
      locale: 'en',
      rest: '/en/faq',
      prefixed: true,
    });
  });
});

describe('slugify', () => {
  it('normalizes text to a safe slug', () => {
    expect(slugify('  Grade 5 Titanium — Bars! ')).toBe(
      'grade-5-titanium-bars',
    );
    expect(slugify('Ünïcödé')).toBe('unicode');
  });
});

describe('slugs of several segments (Task 50)', () => {
  const site = {
    locales: ['en', 'zh-cn'],
    kinds: {
      page: { base: '' },
      'rest-api': { base: 'rest-api' },
      faq: { base: 'faq' },
    },
  };

  it('accepts one to four canonical segments', () => {
    for (const slug of ['quote', 'crypto/quote', 'a/b/c/d', 'page/billing']) {
      expect(slugProblem(slug)).toBeNull();
    }
  });

  it('builds the path from the base and every segment', () => {
    expect(
      buildPublicPath({
        kind: 'rest-api',
        locale: 'en',
        defaultLocale: 'en',
        prefixDefaultLocale: true,
        slug: 'crypto/crypto-quote',
        base: 'rest-api',
      }),
    ).toBe('/en/rest-api/crypto/crypto-quote');
  });

  it.each([
    ['a/b/c/d/e', /at most 4/, 'a/b/c/d'],
    ['a//b', /empty segment/, 'a/b'],
    ['/a', /empty segment/, 'a'],
    ['a/', /empty segment/, 'a'],
    ['Crypto/Quote', /Segment 1 \("Crypto"\)/, 'crypto/quote'],
    ['crypto/行情', /Segment 2 \("行情"\).*Latin/, 'crypto'],
  ])('refuses %j and suggests what would do', (slug, message, suggestion) => {
    const problem = slugProblem(slug);
    expect(problem?.message).toMatch(message);
    expect(problem?.suggestion).toBe(suggestion);
  });

  it('refuses page/<number>, the address of a list page', () => {
    expect(slugProblem('page/2')?.message).toContain('list');
    expect(slugProblem('page/2/x')?.message).toContain('list');
  });

  it('refuses a slug over the length limit', () => {
    const tooLong = `${'a'.repeat(80)}/`.repeat(3);
    expect(slugProblem(`${tooLong}b`)).not.toBeNull();
  });

  it('keeps the words a one-segment slug has always been refused with', () => {
    expect(slugProblem('Hello World')?.message).toBe(
      'The slug must use lowercase Latin letters, digits and single dashes. Use "hello-world".',
    );
    expect(slugProblem('你好')?.message).toBe(
      'The slug "你好" has no Latin letters or digits to build a folder name from. Provide one written in Latin characters.',
    );
  });

  it('canonicalises segment by segment', () => {
    expect(canonicalSlug(' Crypto / Crypto Quote ')).toBe(
      'crypto/crypto-quote',
    );
    expect(canonicalSlug('a/b/c/d/e')).toBe('a/b/c/d');
  });

  it('keeps a nested slug of a kind with no base off addresses the site answers', () => {
    expect(slugPlacementProblem('tags/x', '', site)?.message).toContain(
      'answers that address itself',
    );
    expect(slugPlacementProblem('faq/x', '', site)?.message).toContain(
      'the kind "faq"',
    );
    expect(slugPlacementProblem('zh-cn/x', '', site)?.message).toContain(
      'the language "zh-cn"',
    );
    expect(slugPlacementProblem('guides/x', '', site)).toBeNull();
    // Under a base, or in one segment, nothing is held to these rules.
    expect(slugPlacementProblem('tags/x', 'rest-api', site)).toBeNull();
    expect(slugPlacementProblem('faq', '', site)).toBeNull();
  });
});
