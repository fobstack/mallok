/**
 * Relative asset references (`images/hero.jpg`, `files/datasheet.pdf`) and
 * their resolution to content-addressed media URLs.
 *
 * Markdown stored in D1 keeps the relative paths exactly as the author wrote
 * them. Only the rendered HTML carries R2 URLs. See docs/CONTENT_FORMAT.md §4.
 */

import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import { exportPathProblem } from './export-path.js';

/** Metadata about one stored media object, as needed for rendering. */
export interface ResolvedAsset {
  /** Content hash; also the R2 key stem. */
  readonly sha256: string;
  readonly kind: 'image' | 'file';
  /** File extension of the original object, without the dot. */
  readonly ext: string;
  /** Pixel dimensions of the original image, when known. */
  readonly width?: number;
  readonly height?: number;
  /** Widths of the WebP variants that exist in R2, ascending. */
  readonly variants: readonly number[];
  /** Fallback alt text, used only when the author gave none. */
  readonly alt?: string;
}

/** Normalized relative path → resolved media. */
export type AssetMap = Readonly<Record<string, ResolvedAsset>>;

/** Options for {@link rehypeResolveAssets}. */
export interface ResolveAssetsOptions {
  readonly assets: AssetMap;
  /**
   * Origin of the media host, e.g. `https://media.example.com`. An empty
   * string yields site-relative `/media/...` URLs served by the Worker proxy.
   */
  readonly mediaBaseUrl: string;
  /** Value of the `sizes` attribute emitted with a `srcset`. */
  readonly sizes?: string;
  /**
   * When true (the default) the first image in the document is marked
   * `loading="eager"` because it is the likely LCP element, and every later
   * image is lazy (docs/SEO_PERFORMANCE.md §9).
   */
  readonly eagerFirstImage?: boolean;
}

/** Result of a resolution pass over a document. */
export interface ResolveAssetsReport {
  /** Relative paths that were referenced, normalized, in document order. */
  readonly refs: string[];
  /** Referenced paths with no entry in the asset map. */
  readonly missing: string[];
}

const ALLOWED_PREFIXES = ['images/', 'files/'] as const;
const DEFAULT_SIZES = '(max-width: 800px) 100vw, 800px';

/**
 * Normalizes a relative reference to the canonical `images/...` or
 * `files/...` form. Returns `null` for anything that is not a valid relative
 * asset reference (absolute URLs, protocol-relative URLs, parent traversal).
 */
export function normalizeRelativePath(raw: string): string | null {
  let path = raw.trim();
  if (path === '') {
    return null;
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.startsWith('./')) {
    path = path.slice(2);
  }
  const segments = path.split('/');
  const hasBadSegment = segments.some(
    (segment) => segment === '..' || segment === '' || segment === '.',
  );
  if (
    path.startsWith('/') ||
    path.includes('://') ||
    path.includes('\\') ||
    hasBadSegment
  ) {
    return null;
  }
  const hasAllowedPrefix = ALLOWED_PREFIXES.some((prefix) =>
    path.startsWith(prefix),
  );
  return hasAllowedPrefix && exportPathProblem(path) === null ? path : null;
}

/** Builds the public URL of the original media object. */
export function mediaUrl(mediaBaseUrl: string, asset: ResolvedAsset): string {
  return `${mediaBaseUrl}/media/${asset.sha256}.${asset.ext}`;
}

/** Builds the public URL of a WebP variant at the given width. */
export function variantUrl(
  mediaBaseUrl: string,
  asset: ResolvedAsset,
  width: number,
): string {
  return `${mediaBaseUrl}/media/${asset.sha256}_${width}.webp`;
}

/**
 * A rehype transformer that rewrites relative `<img src>` and `<a href>`
 * references to their media URLs and records what it saw in `report`.
 *
 * Unresolved references are left untouched: a missing image is a normal state
 * (see docs/CONTENT_FORMAT.md §4), not an error.
 */
export function rehypeResolveAssets(
  options: ResolveAssetsOptions,
  report: { refs: string[]; missing: string[] },
): (tree: Root) => void {
  const sizes = options.sizes ?? DEFAULT_SIZES;
  const eagerFirst = options.eagerFirstImage ?? true;
  return (tree) => {
    let imageIndex = 0;
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'img') {
        const isFirst = imageIndex === 0;
        imageIndex++;
        rewriteImage(node, options, sizes, report, eagerFirst && isFirst);
      } else if (node.tagName === 'a') {
        rewriteLink(node, options, report);
      }
    });
  };
}

function rewriteImage(
  node: Element,
  options: ResolveAssetsOptions,
  sizes: string,
  report: { refs: string[]; missing: string[] },
  eager: boolean,
): void {
  const src = node.properties.src;
  if (typeof src !== 'string') {
    return;
  }
  const path = normalizeRelativePath(src);
  if (path === null) {
    return;
  }
  report.refs.push(path);
  const asset = options.assets[path];
  if (asset === undefined) {
    report.missing.push(path);
    return;
  }

  const base = options.mediaBaseUrl;
  const largest = asset.variants[asset.variants.length - 1];
  node.properties.src =
    largest === undefined
      ? mediaUrl(base, asset)
      : variantUrl(base, asset, largest);

  if (asset.variants.length > 1) {
    node.properties.srcSet = asset.variants
      .map((width) => `${variantUrl(base, asset, width)} ${width}w`)
      .join(', ');
    node.properties.sizes = sizes;
  }
  if (asset.width !== undefined && asset.height !== undefined) {
    node.properties.width = asset.width;
    node.properties.height = asset.height;
  }
  node.properties.loading = eager ? 'eager' : 'lazy';
  node.properties.decoding = 'async';
  if (
    (node.properties.alt === undefined || node.properties.alt === '') &&
    asset.alt !== undefined
  ) {
    node.properties.alt = asset.alt;
  }
}

function rewriteLink(
  node: Element,
  options: ResolveAssetsOptions,
  report: { refs: string[]; missing: string[] },
): void {
  const href = node.properties.href;
  if (typeof href !== 'string') {
    return;
  }
  const path = normalizeRelativePath(href);
  if (path === null) {
    return;
  }
  report.refs.push(path);
  const asset = options.assets[path];
  if (asset === undefined) {
    report.missing.push(path);
    return;
  }
  node.properties.href = mediaUrl(options.mediaBaseUrl, asset);
}

/** One resolved image as a template consumes it. */
export interface ImageView {
  readonly url: string;
  readonly srcset: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly alt: string;
}

/**
 * Builds the template-facing URLs for every asset in `assets`, keyed by the
 * relative path a front-matter field holds.
 *
 * The chosen URL and srcset mirror what {@link rehypeResolveAssets} writes
 * into the body, so a front-matter image and an in-body image of the same
 * file are served identically. `width`/`height` travel with it because a
 * theme must be able to reserve the box (docs/SEO_PERFORMANCE.md §9).
 */
export function buildImageViews(
  assets: AssetMap,
  mediaBaseUrl: string,
): Record<string, ImageView> {
  const out: Record<string, ImageView> = {};
  for (const [path, asset] of Object.entries(assets)) {
    if (asset.kind !== 'image') {
      continue;
    }
    const largest = asset.variants[asset.variants.length - 1];
    out[path] = {
      url:
        largest === undefined
          ? mediaUrl(mediaBaseUrl, asset)
          : variantUrl(mediaBaseUrl, asset, largest),
      srcset:
        asset.variants.length > 1
          ? asset.variants
              .map(
                (width) =>
                  `${variantUrl(mediaBaseUrl, asset, width)} ${width}w`,
              )
              .join(', ')
          : '',
      width: asset.width ?? null,
      height: asset.height ?? null,
      alt: asset.alt ?? '',
    };
  }
  return out;
}

/**
 * Public URLs of the non-image assets in `assets` (datasheets, drawings),
 * keyed by their relative path. Front-matter `file` fields resolve through
 * this the way `image` fields resolve through {@link buildImageViews}.
 */
export function buildFileUrls(
  assets: AssetMap,
  mediaBaseUrl: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, asset] of Object.entries(assets)) {
    if (asset.kind === 'image') {
      continue;
    }
    out[path] = mediaUrl(mediaBaseUrl, asset);
  }
  return out;
}
