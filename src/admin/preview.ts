/**
 * The live preview (docs/ADMIN.md §6.3).
 *
 * It calls `renderFragment` and `renderPage` from `src/core` — the same
 * functions the Worker runs — so what the editor shows is what the site will
 * serve, byte for byte (docs/ARCHITECTURE.md §5). That is the whole reason
 * `src/core` is free of Cloudflare types: it has to run here too.
 */

import type { AssetMap } from '../core/index.js';
import {
  buildContentPageView,
  type CompiledTheme,
  compileTheme,
  renderFragment,
  renderPage,
  splitFrontmatter,
  themeLanguageNames,
  themeStrings,
} from '../core/index.js';
import type { MediaItem, Settings, ThemeInfo } from './types.js';

let compiled: CompiledTheme | null = null;
let compiledFor = '';

/** Compiles the active theme once and reuses it across keystrokes. */
function themeFor(theme: ThemeInfo): CompiledTheme {
  const key = `${theme.id}@${theme.version}`;
  if (compiled === null || compiledFor !== key) {
    compiled = compileTheme(
      {
        id: theme.id,
        themeApi: 1,
        name: theme.name,
        version: theme.version,
        home: 'layouts/home.liquid',
        kinds: theme.kinds,
        options: theme.options,
        locales: [...theme.locales],
        defaultLocale: theme.defaultLocale,
        imageWidths: [...theme.imageWidths],
        clientScripts: [...theme.clientScripts],
        ...(theme.description === '' ? {} : { description: theme.description }),
      },
      theme.files,
      1,
    );
    compiledFor = key;
  }
  return compiled;
}

/** Inputs of {@link renderPreview}. */
export interface PreviewInput {
  readonly theme: ThemeInfo;
  readonly settings: Settings;
  readonly markdown: string;
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly path: string;
  /** Relative path → media hash, as the editor knows them. */
  readonly assets: Readonly<Record<string, string>>;
  /** Resolved media rows for those hashes, as the API returns them. */
  readonly media: Readonly<Record<string, MediaItem>>;
}

/** What a preview render produced. */
export interface PreviewResult {
  readonly html: string;
  /** Relative paths the body references but the assets map does not resolve. */
  readonly missing: readonly string[];
}

/** Renders one preview. Throws only on a broken template. */
export async function renderPreview(
  input: PreviewInput,
): Promise<PreviewResult> {
  const { body, data } = splitFrontmatter(input.markdown);
  const assets: Record<string, AssetMap[string]> = {};
  for (const [path, sha] of Object.entries(input.assets)) {
    const row = input.media[sha];
    if (row === undefined) {
      continue;
    }
    // The API models "unknown" as null; the renderer models it as absent.
    assets[path] = {
      sha256: row.sha256,
      kind: row.kind,
      ext: row.ext,
      variants: row.variants,
      ...(row.width === null ? {} : { width: row.width }),
      ...(row.height === null ? {} : { height: row.height }),
      ...(row.alt === null ? {} : { alt: row.alt }),
    };
  }

  const fragment = await renderFragment({
    body,
    frontmatter: data,
    assets,
    mediaBaseUrl: input.settings.mediaBaseUrl ?? '',
  });

  const theme = themeFor(input.theme);
  const now = new Date().toISOString();
  const view = buildContentPageView(
    {
      settings: {
        name: input.settings.name,
        tagline: input.settings.tagline ?? '',
        defaultLocale: input.settings.defaultLocale,
        locales: input.settings.locales,
        kinds: input.settings.kinds,
        nav: input.settings.nav,
        themeOptions: input.settings.themeOptions,
        mediaBaseUrl: input.settings.mediaBaseUrl ?? '',
      },
      manifest: theme.manifest,
      origin: window.location.origin,
      locale: input.locale,
      path: input.path,
      strings: themeStrings(theme.manifest, input.theme.files, input.locale),
      languageNames: themeLanguageNames(theme.manifest, input.theme.files),
    },
    {
      id: 'preview',
      kind: input.kind,
      locale: input.locale,
      slug: input.slug,
      path: input.path,
      title: typeof data.title === 'string' ? data.title : '',
      description: typeof data.description === 'string' ? data.description : '',
      publishedAt: now,
      updatedAt: now,
      frontmatter: data,
      cover: '',
    },
    { html: fragment.html, meta: fragment.meta },
    [{ locale: input.locale, path: input.path }],
  );

  const layout =
    theme.manifest.kinds[input.kind]?.layout ??
    theme.manifest.kinds.page?.layout ??
    'layouts/page.liquid';
  return {
    html: withBase(await renderPage(theme, layout, view)),
    missing: fragment.meta.missing,
  };
}

/**
 * Gives the preview document a base URL.
 *
 * The preview renders in a `sandbox=""` iframe, which is what keeps untrusted
 * content away from the admin's DOM. The cost is an opaque origin: the
 * theme's `/theme/<id>/<version>/style.css` has no host to resolve against,
 * and the page would render unstyled. A `<base>` restores subresource loading
 * without granting the frame same-origin access.
 */
function withBase(html: string): string {
  const base = `<base href="${window.location.origin}/">`;
  return html.includes('<head>')
    ? html.replace('<head>', `<head>\n  ${base}`)
    : `${base}${html}`;
}
