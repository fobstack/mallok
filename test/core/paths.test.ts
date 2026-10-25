import { describe, expect, it } from 'vitest';
import {
  buildHomePath,
  buildPublicPath,
  localePrefix,
  parsePublicPath,
  slugify,
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
