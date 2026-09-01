/**
 * A valid theme directory, as the build script would read it off disk.
 *
 * Themes are source now, so a fixture is just a list of files — no archive to
 * assemble (docs/THEME_FORMAT.md §3).
 */

import type { ThemeSourceFile } from '../../src/core/theme-package.js';

const encoder = new TextEncoder();

/** Builds one file entry. */
export function file(path: string, body: string): ThemeSourceFile {
  return { path, bytes: encoder.encode(body) };
}

/** The files of a theme that passes every rule in `THEME_FORMAT.md §3`. */
export function themeSource(
  id: string,
  version: string,
  extra: readonly ThemeSourceFile[] = [],
): ThemeSourceFile[] {
  const manifest = {
    id,
    name: `${(id[0] ?? '').toUpperCase()}${id.slice(1)}`,
    version,
    home: 'layouts/home.liquid',
    kinds: {
      page: { layout: 'layouts/page.liquid', label: 'Page' },
      article: {
        layout: 'layouts/article.liquid',
        listLayout: 'layouts/list.liquid',
        base: 'news',
      },
    },
    locales: ['en'],
    defaultLocale: 'en',
  };
  return [
    file('theme.json', JSON.stringify(manifest)),
    file('index.ts', '// bundled by src/themes/index.ts'),
    file(
      'layouts/home.liquid',
      `<!doctype html><html><head><link rel="stylesheet" href="{{ theme.asset_base }}/style.css">{{ page.head }}</head><body><h1>${id} home</h1></body></html>`,
    ),
    file(
      'layouts/page.liquid',
      `<!doctype html><html><head><link rel="stylesheet" href="{{ theme.asset_base }}/style.css">{{ page.head }}</head><body><h1>{{ content.title }}</h1>{{ content.html }}<p>${id} page</p></body></html>`,
    ),
    file(
      'layouts/article.liquid',
      `<!doctype html><html><head><link rel="stylesheet" href="{{ theme.asset_base }}/style.css">{{ page.head }}</head><body><article><h1>{{ content.title }}</h1>{{ content.html }}</article><p>${id} article</p></body></html>`,
    ),
    file(
      'layouts/list.liquid',
      '<!doctype html><html><body>{% for item in list.items %}<a href="{{ item.path }}">{{ item.title }}</a>{% endfor %}</body></html>',
    ),
    file('locales/en.json', JSON.stringify({ article: 'News' })),
    file('assets/style.css', `body { color: #123456; } /* ${id} */`),
    ...extra,
  ];
}

/** Replaces the manifest of a fixture after mutating it. */
export function withManifest(
  files: readonly ThemeSourceFile[],
  mutate: (manifest: Record<string, unknown>) => void,
): ThemeSourceFile[] {
  return files.map((entry) => {
    if (entry.path !== 'theme.json') {
      return entry;
    }
    const manifest = JSON.parse(
      new TextDecoder().decode(entry.bytes),
    ) as Record<string, unknown>;
    mutate(manifest);
    return file('theme.json', JSON.stringify(manifest));
  });
}

/** Replaces the body of one file in a fixture. */
export function withFile(
  files: readonly ThemeSourceFile[],
  path: string,
  body: string,
): ThemeSourceFile[] {
  return files.map((entry) => (entry.path === path ? file(path, body) : entry));
}

/** Removes one file from a fixture. */
export function without(
  files: readonly ThemeSourceFile[],
  path: string,
): ThemeSourceFile[] {
  return files.filter((entry) => entry.path !== path);
}
