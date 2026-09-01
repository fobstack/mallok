/**
 * `mallok preview` (docs/CLI.md §8).
 *
 * Renders a bundle with the same `src/core` functions the Worker runs, with
 * no network access at all — which is what makes it usable in a content
 * pipeline before a site exists.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildContentPageView,
  compileTheme,
  parseThemeManifest,
  renderFragment,
  renderPage,
  splitFrontmatter,
  type ThemeFiles,
  type ThemeManifest,
  themeLanguageNames,
  themeStrings,
} from '../core/index.js';
import type { Bundle } from './scan.js';

/** Inputs of {@link previewBundle}. */
export interface PreviewOptions {
  readonly manifest: ThemeManifest;
  readonly files: ThemeFiles;
  readonly siteName: string;
  readonly defaultLocale: string;
  readonly outFile: string;
}

/** Renders one bundle's default-locale document to an HTML file. */
export async function previewBundle(
  bundle: Bundle,
  options: PreviewOptions,
): Promise<string> {
  const document =
    bundle.documents.find((entry) => entry.locale === options.defaultLocale) ??
    bundle.documents[0];
  if (document === undefined) {
    throw new Error(`"${bundle.name}" has no document to preview.`);
  }

  const { data } = splitFrontmatter(document.markdown);
  const fragment = await renderFragment({
    body: splitFrontmatter(document.markdown).body,
    frontmatter: data,
    // No network: a referenced image simply stays a relative path, which is
    // the documented missing-file state.
    assets: {},
    mediaBaseUrl: '',
  });

  const theme = compileTheme(options.manifest, options.files, 1);
  const now = new Date().toISOString();
  const path = `/${bundle.name}`;
  const view = buildContentPageView(
    {
      settings: {
        name: options.siteName,
        tagline: '',
        defaultLocale: options.defaultLocale,
        locales: [options.defaultLocale],
        kinds: { [bundle.kind]: { base: bundle.kind } },
        nav: {},
        themeOptions: {},
        mediaBaseUrl: '',
      },
      manifest: options.manifest,
      origin: 'http://localhost',
      locale: document.locale,
      path,
      strings: themeStrings(options.manifest, options.files, document.locale),
      languageNames: themeLanguageNames(options.manifest, options.files),
    },
    {
      id: bundle.name,
      kind: bundle.kind,
      locale: document.locale,
      slug: bundle.name,
      path,
      title: typeof data.title === 'string' ? data.title : bundle.name,
      description: typeof data.description === 'string' ? data.description : '',
      publishedAt: now,
      updatedAt: now,
      frontmatter: data,
      cover: '',
    },
    { html: fragment.html, meta: fragment.meta },
    [{ locale: document.locale, path }],
  );

  const layout =
    options.manifest.kinds[bundle.kind]?.layout ??
    options.manifest.kinds.page?.layout ??
    'layouts/page.liquid';
  const html = await renderPage(theme, layout, view);
  await writeFile(join(options.outFile), html, 'utf8');
  return html;
}

/**
 * Reads a theme off disk for offline preview.
 *
 * `mallok preview` runs with no network, so it cannot ask a site which theme
 * it uses; the caller points at a theme directory in the source tree.
 */
export async function loadThemeFromDisk(root: string): Promise<{
  manifest: ThemeManifest;
  files: ThemeFiles;
}> {
  const manifest = parseThemeManifest(
    JSON.parse(await readFile(join(root, 'theme.json'), 'utf8')),
  );
  const files: Record<string, string> = {};
  for (const sub of ['layouts', 'partials', 'locales']) {
    let entries: string[] = [];
    try {
      entries = await readdir(join(root, sub));
    } catch {
      continue;
    }
    for (const name of entries) {
      files[`${sub}/${name}`] = await readFile(join(root, sub, name), 'utf8');
    }
  }
  return { manifest, files };
}
