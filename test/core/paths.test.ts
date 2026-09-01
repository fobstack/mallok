import { describe, expect, it } from 'vitest';
import {
  buildHomePath,
  buildPublicPath,
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
    });
    expect(parsePublicPath('/de', locales, 'en')).toEqual({
      locale: 'de',
      rest: '/',
    });
  });

  it('keeps unknown prefixes in the default locale', () => {
    expect(parsePublicPath('/fr/news', locales, 'en')).toEqual({
      locale: 'en',
      rest: '/fr/news',
    });
    expect(parsePublicPath('/news/a', locales, 'en')).toEqual({
      locale: 'en',
      rest: '/news/a',
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
