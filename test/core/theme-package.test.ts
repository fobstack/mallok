import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('takes plugin layouts, each a template the theme really has', () => {
    const declared = withManifest(themeSource('trade', '1.0.0'), (manifest) => {
      manifest.pluginLayouts = { 'shop/cart': 'layouts/shop-cart.liquid' };
    });
    const pkg = readThemePackage(
      [...declared, file('layouts/shop-cart.liquid', '<p>cart</p>')],
      'trade',
    );
    expect(pkg.manifest.pluginLayouts).toEqual({
      'shop/cart': 'layouts/shop-cart.liquid',
    });
    // A theme that declares none provides none; it is not an error.
    expect(
      readThemePackage(themeSource('trade', '1.0.0'), 'trade').manifest
        .pluginLayouts,
    ).toEqual({});

    expectRejected(
      declared,
      /missing: layouts\/shop-cart\.liquid \(plugin layout "shop\/cart"\)/,
    );
    for (const [name, path] of [
      ['Shop/Cart', 'layouts/page.liquid'],
      ['shop cart', 'layouts/page.liquid'],
      ['shop/cart', 'partials/cart.liquid'],
      ['shop/cart', 'layouts/plugins/cart.liquid'],
    ] as const) {
      expect(() =>
        readThemePackage(
          withManifest(themeSource('trade', '1.0.0'), (manifest) => {
            manifest.pluginLayouts = { [name]: path };
          }),
          'trade',
        ),
      ).toThrow();
    }
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

  it('rejects a JavaScript asset unless its exact path is declared', () => {
    expectRejected(
      [...themeSource('trade', '1.0.0'), file('assets/x.js', 'void 0;')],
      /must be declared/,
    );
    const source = withManifest(themeSource('trade', '1.0.0'), (manifest) => {
      manifest.clientScripts = [{ path: 'assets/x.js', purpose: 'carousel' }];
    });
    expect(
      readThemePackage([...source, file('assets/x.js', 'void 0;')]).assets[
        'assets/x.js'
      ],
    ).toBeDefined();
    expectRejected(
      [...source, file('assets/other.js', 'void 0;')],
      /must be declared/,
    );
  });

  describe('a theme that declares a script', () => {
    // Declaring one script used to switch every script check off: any inline
    // `<script>` and any `on…=` attribute then passed, which made the list
    // the admin shows the owner a list of *some* of what the theme runs.
    const declaring = (home: string, extra: ThemeSourceFile[] = []) => [
      ...withFile(
        withManifest(themeSource('trade', '1.0.0'), (manifest) => {
          manifest.clientScripts = [
            { path: 'assets/x.js', purpose: 'gallery', bytes: 100 },
            'assets/vendor/y.js',
          ];
        }),
        'layouts/home.liquid',
        home,
      ),
      file('assets/x.js', 'void 0;'),
      file('assets/vendor/y.js', 'void 0;'),
      ...extra,
    ];
    const page = (body: string) =>
      `<!doctype html><html><head>{{ page.head }}</head><body>${body}</body></html>`;

    it('may load exactly the files it declares, through the asset prefix', () => {
      for (const tag of [
        '<script src="{{ theme.asset_base }}/x.js" defer></script>',
        "<script defer src='{{theme.asset_base}}/x.js'></script>",
        '<script type="module" src="{{- theme.asset_base -}}/vendor/y.js">\n</script>',
        '<SCRIPT SRC="{{ theme.asset_base }}/x.js"></SCRIPT>',
        '<script src="{{ theme.asset_base }}/x.js"></script><script src="{{ theme.asset_base }}/vendor/y.js"></script>',
        // No script at all is fine too: declaring is not an obligation to load.
        '<p>nothing</p>',
      ]) {
        expect(
          readThemePackage(declaring(page(tag)), 'trade').manifest
            .clientScripts,
          tag,
        ).toHaveLength(2);
      }
    });

    it('may not contain inline script, a data block included', () => {
      for (const tag of [
        '<script>go()</script>',
        '<script type="module">import "./x.js"</script>',
        '<script type="application/ld+json">{"@type":"Product"}</script>',
        '<script defer></script>',
      ]) {
        expectRejected(declaring(page(tag)), /contains an inline <script>/);
      }
    });

    it('may not load a script it did not declare, however it is spelled', () => {
      for (const tag of [
        '<script src="{{ theme.asset_base }}/other.js"></script>',
        '<script src="https://cdn.example/x.js"></script>',
        '<script src="//cdn.example/x.js"></script>',
        '<script src="/theme/trade/1.0.0/x.js"></script>',
        '<script src="assets/x.js"></script>',
        '<script src="{{ theme.asset_base }}/../x.js"></script>',
        '<script src="{{ theme.options.script }}"></script>',
        '<script src="{{ theme.asset_base }}/x.js?{{ content.slug }}"></script>',
        '<script src="data:text/javascript,alert(1)"></script>',
        '<script src=""></script>',
      ]) {
        expectRejected(
          declaring(page(tag)),
          /which is not one of the files declared in clientScripts/,
        );
      }
    });

    it('may not put code inside a tag that also has a src', () => {
      expectRejected(
        declaring(
          page('<script src="{{ theme.asset_base }}/x.js">go()</script>'),
        ),
        /puts code inside a <script src> tag/,
      );
      expectRejected(
        declaring(page('<script src="{{ theme.asset_base }}/x.js">')),
        /puts code inside a <script src> tag/,
      );
    });

    it('may not use event-handler attributes', () => {
      for (const body of [
        '<button onclick="go()">x</button>',
        '<body onload="go()">',
        '<img src="a.png" ONERROR = "go()">',
      ]) {
        expectRejected(
          declaring(
            page(`${body}<script src="{{ theme.asset_base }}/x.js"></script>`),
          ),
          /inline event handler/,
        );
      }
    });

    it('is checked in partials as well as layouts', () => {
      expectRejected(
        declaring(page('{% render "partials/extra" %}'), [
          file('partials/extra.liquid', '<script>go()</script>'),
        ]),
        /"partials\/extra\.liquid" contains an inline <script>/,
      );
    });
  });

  it('keeps every official theme passing, the one with a script included', () => {
    // Read from the directories as the build reads them, not from the
    // already-parsed manifests.
    for (const id of ['atelier', 'folio', 'gazette', 'journal', 'manual']) {
      const root = fileURLToPath(
        new URL(`../../src/themes/${id}/`, import.meta.url),
      );
      const entries = readdirSync(root, {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const full = join(entry.parentPath, entry.name);
          return {
            path: relative(root, full).split(sep).join('/'),
            bytes: new Uint8Array(readFileSync(full)),
          };
        });
      const pkg = readThemePackage(entries, id);
      expect(pkg.manifest.id, id).toBe(id);
      if (id === 'atelier') {
        expect(pkg.manifest.clientScripts).toHaveLength(1);
        expect(pkg.files['layouts/home.liquid']).toContain(
          '<script src="{{ theme.asset_base }}/hero-carousel.js" defer></script>',
        );
      } else {
        expect(pkg.manifest.clientScripts, id).toEqual([]);
      }
    }
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
