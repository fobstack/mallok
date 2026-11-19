import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildThemeView,
  parseThemeManifest,
  type ViewContext,
} from '../../src/core/index.js';
import {
  legacyOptionList,
  legacyOptionPairs,
} from '../../src/core/theme-options.js';

/**
 * Theme options as lists (docs/ADMIN_SIMPLE.md, D10a). Atelier's
 * certifications, stats and capability features were one string with a
 * syntax of their own; they are `string[]` and `keyvalue` now. A site that
 * saved the old strings must render the same home page: its values are
 * read as the lists they meant.
 */

const atelier = parseThemeManifest(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../src/themes/atelier/theme.json'),
      'utf8',
    ),
  ),
);

function view(themeOptions: Record<string, unknown>) {
  const ctx: ViewContext = {
    settings: {
      name: 'Site',
      tagline: '',
      defaultLocale: 'en',
      locales: ['en'],
      kinds: { page: { base: '' } },
      nav: {},
      themeOptions,
      mediaBaseUrl: '',
    },
    manifest: atelier,
    origin: 'https://example.com',
    locale: 'en',
    path: '/',
    strings: {},
  };
  return buildThemeView(ctx).options;
}

describe('list options and the strings saved before them', () => {
  it('reads a comma list and a pair list as what they meant', () => {
    expect(
      legacyOptionList(' Bar & rod, Plate & sheet,, Seamless tube '),
    ).toEqual(['Bar & rod', 'Plate & sheet', 'Seamless tube']);
    expect(
      Object.entries(
        legacyOptionPairs('bar|Precision stock ;; plate|A|B ;; |nameless'),
      ),
    ).toEqual([
      ['bar', 'Precision stock'],
      ['plate', 'A|B'],
    ]);
  });

  it("renders a site's old strings as Atelier's new lists", () => {
    // Exactly the defaults Atelier shipped as strings, saved by a site.
    const old = view({
      stats:
        'Bar|Precision stock ;; Plate|Versatile formats ;; Tube|Hollow sections',
      certifications: 'Bar & rod, Plate & sheet, Seamless tube',
      band_features:
        'Choose the right form|Compare bar, plate and tube for your application. ;; Define the specification|Share the grade, dimensions and documentation needed. ;; Plan the next step|Discuss quantities, processing and delivery requirements.',
    });
    const fresh = view({});
    for (const key of ['stats', 'certifications', 'band_features']) {
      expect(old[key], key).toEqual(fresh[key]);
    }
    expect(fresh.certifications).toEqual([
      'Bar & rod',
      'Plate & sheet',
      'Seamless tube',
    ]);
  });

  it('leaves a value already in the new shape alone', () => {
    expect(view({ certifications: ['ISO 9001'] }).certifications).toEqual([
      'ISO 9001',
    ]);
  });
});
