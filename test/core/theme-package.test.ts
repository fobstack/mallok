import { describe, expect, it } from 'vitest';
import {
  readThemePackage,
  ThemePackageError,
  type ThemeSourceFile,
} from '../../src/core/theme-package.js';
import {
  file,
  themeSource,
  withFile,
  withManifest,
  without,
} from '../fixtures/theme-source.js';

function expectRejected(
  files: readonly ThemeSourceFile[],
  pattern: RegExp,
  directoryName?: string,
): void {
  expect(() => readThemePackage(files, directoryName)).toThrow(
    ThemePackageError,
  );
  expect(() => readThemePackage(files, directoryName)).toThrow(pattern);
}

describe('readThemePackage', () => {
  it('accepts a well-formed theme and splits it by destination', () => {
    const pkg = readThemePackage(themeSource('trade', '1.0.0'), 'trade');
    expect(pkg.manifest.id).toBe('trade');
    expect(pkg.manifest.version).toBe('1.0.0');
    // Templates and locales are bundled into the Worker...
    expect(Object.keys(pkg.files).sort()).toEqual([
      'layouts/article.liquid',
      'layouts/home.liquid',
      'layouts/list.liquid',
      'layouts/page.liquid',
      'locales/en.json',
    ]);
    // ...assets are copied to Static Assets.
    expect(Object.keys(pkg.assets)).toEqual(['assets/style.css']);
  });

  it('rejects a directory name that disagrees with the id', () => {
    expectRejected(
      themeSource('trade', '1.0.0'),
      /named "not-trade" but theme\.json declares id "trade"/,
      'not-trade',
    );
  });

  it('rejects a theme without theme.json', () => {
    expectRejected(
      without(themeSource('trade', '1.0.0'), 'theme.json'),
      /no theme\.json/,
    );
  });

  it('rejects invalid JSON in the manifest', () => {
    expectRejected(
      withFile(themeSource('trade', '1.0.0'), 'theme.json', '{ nope'),
      /not valid JSON/,
    );
  });

  it('rejects a path outside the allowed set', () => {
    expectRejected(
      [...themeSource('trade', '1.0.0'), file('README.md', '# hi')],
      /not an allowed path/,
    );
  });

  it('rejects an unsafe path', () => {
    expectRejected(
      [...themeSource('trade', '1.0.0'), file('../escape.liquid', 'x')],
      /not a safe path/,
    );
  });

  it('rejects an asset extension it cannot serve, including svg', () => {
    expectRejected(
      [
        ...themeSource('trade', '1.0.0'),
        file('assets/logo.svg', '<svg></svg>'),
      ],
      /unsupported extension/,
    );
  });

  it('rejects a layout the manifest names but the directory lacks', () => {
    expectRejected(
      without(themeSource('trade', '1.0.0'), 'layouts/article.liquid'),
      /missing: layouts\/article\.liquid/,
    );
  });

  it('requires a page kind, because it is the fallback layout', () => {
    expectRejected(
      withManifest(themeSource('trade', '1.0.0'), (manifest) => {
        delete (manifest.kinds as Record<string, unknown>).page;
      }),
      /"page" kind/,
    );
  });

  it('rejects a declared locale with no bundle', () => {
    expectRejected(
      withManifest(themeSource('trade', '1.0.0'), (manifest) => {
        manifest.locales = ['en', 'de'];
      }),
      /locales without a bundle: de/,
    );
  });

  it('rejects a locale bundle that is not valid JSON', () => {
    expectRejected(
      withFile(themeSource('trade', '1.0.0'), 'locales/en.json', 'not json'),
      /locales\/en\.json is not valid JSON/,
    );
  });

  it('rejects an undeclared script tag', () => {
    expectRejected(
      withFile(
        themeSource('trade', '1.0.0'),
        'layouts/home.liquid',
        '<html><script>alert(1)</script></html>',
      ),
      /<script> tag but theme\.json declares/,
    );
  });

  it('rejects an undeclared inline event handler', () => {
    expectRejected(
      withFile(
        themeSource('trade', '1.0.0'),
        'layouts/home.liquid',
        '<html><body onload="go()"></body></html>',
      ),
      /inline event handler/,
    );
  });

  it('allows scripts once the manifest declares them', () => {
    const declared = withFile(
      withManifest(themeSource('trade', '1.0.0'), (manifest) => {
        manifest.clientScripts = [
          { path: 'assets/x.js', purpose: 'gallery', bytes: 100 },
        ];
      }),
      'layouts/home.liquid',
      '<html><script>go()</script></html>',
    );
    expect(readThemePackage(declared).manifest.clientScripts).toHaveLength(1);
  });

  it('refuses a theme built for a newer contract version', () => {
    expectRejected(
      withManifest(themeSource('trade', '1.0.0'), (manifest) => {
        manifest.themeApi = 99;
      }),
      /needs theme API 99/,
    );
  });

  it('accepts field declarations for a content kind', () => {
    const withFields = withManifest(
      themeSource('trade', '1.0.0'),
      (manifest) => {
        const kinds = manifest.kinds as Record<string, Record<string, unknown>>;
        kinds.article = {
          ...kinds.article,
          fields: {
            sku: { type: 'string', label: 'SKU' },
            gallery: { type: 'image[]', label: 'Gallery', max: 8 },
            category: { type: 'reference', kind: 'page' },
          },
        };
      },
    );
    const pkg = readThemePackage(withFields);
    expect(pkg.manifest.kinds.article?.fields?.sku?.type).toBe('string');
    expect(pkg.manifest.kinds.article?.fields?.category?.kind).toBe('page');
  });

  it('rejects a select field with no choices', () => {
    expectRejected(
      withManifest(themeSource('trade', '1.0.0'), (manifest) => {
        const kinds = manifest.kinds as Record<string, Record<string, unknown>>;
        kinds.article = {
          ...kinds.article,
          fields: { size: { type: 'select', label: 'Size' } },
        };
      }),
      /theme\.json is invalid/,
    );
  });

  it('ignores the entry module, which is code rather than theme data', () => {
    const pkg = readThemePackage(themeSource('trade', '1.0.0'));
    expect(pkg.files['index.ts']).toBeUndefined();
    expect(pkg.assets['index.ts']).toBeUndefined();
  });
});
