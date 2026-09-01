/**
 * Browser-side media processing (docs/ADMIN.md §8, docs/ARCHITECTURE.md §8).
 *
 * The Worker never touches an image. The browser hashes the original, asks
 * whether that hash already exists, and only then converts and uploads. The
 * deduplication key is the **original** file's hash, so variants produced
 * here and by the CLI's `sharp` need only match in specification, not
 * byte for byte.
 */

import { api, csrf } from './api.js';
import type { MediaItem } from './types.js';

/** Types the API accepts. SVG is deliberately absent. */
const ACCEPTED = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
]);

/** What one upload reports back as it progresses. */
export interface UploadProgress {
  readonly file: string;
  readonly stage:
    | 'hashing'
    | 'checking'
    | 'converting'
    | 'uploading'
    | 'done'
    | 'skipped';
}

/** Hex sha256 of a byte buffer, using the platform's own digest. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** A decoded image plus its intrinsic size. */
async function decode(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/**
 * Renders one WebP variant at `width`, preserving the aspect ratio. Returns
 * null when the source is already narrower — upscaling only wastes bytes.
 */
async function renderVariant(
  bitmap: ImageBitmap,
  width: number,
): Promise<Blob | null> {
  if (bitmap.width <= width) {
    return null;
  }
  const height = Math.round((bitmap.height / bitmap.width) * width);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.82);
  });
}

/** Downscales the original when it exceeds the site's longest-edge limit. */
async function limitOriginal(
  file: File,
  bitmap: ImageBitmap,
  maxEdge: number | null,
): Promise<Blob> {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (maxEdge === null || longest <= maxEdge) {
    return file;
  }
  const scale = maxEdge / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (context === null) {
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), file.type, 0.92);
  });
  return blob ?? file;
}

async function put(
  path: string,
  body: ArrayBuffer,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`/_mallok/api${path}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'x-mallok-csrf': csrf(),
      'content-type': 'application/octet-stream',
      ...headers,
    },
    body,
  });
}

/** Inputs of {@link uploadFile}. */
export interface UploadOptions {
  /** Variant widths the active theme asked for. */
  readonly widths: readonly number[];
  /** Longest edge kept for the original; null keeps the true original. */
  readonly maxEdge: number | null;
  readonly onProgress?: (progress: UploadProgress) => void;
}

/**
 * Processes and uploads one file, returning the stored media row.
 *
 * An unsupported type throws before anything is sent; the server sniffs the
 * bytes again and is the authority (docs/CONTENT_FORMAT.md §4.1).
 */
export async function uploadFile(
  file: File,
  options: UploadOptions,
): Promise<MediaItem> {
  const report = (stage: UploadProgress['stage']): void =>
    options.onProgress?.({ file: file.name, stage });

  if (file.type === 'image/svg+xml') {
    throw new Error(
      'SVG is not accepted: it can carry script. Export a PNG or WebP instead.',
    );
  }
  if (!ACCEPTED.has(file.type)) {
    throw new Error(`"${file.type || 'unknown type'}" is not accepted.`);
  }

  const isImage = file.type.startsWith('image/');
  let original: Blob = file;
  let bitmap: ImageBitmap | null = null;
  if (isImage) {
    bitmap = await decode(file);
    original = await limitOriginal(file, bitmap, options.maxEdge);
  }

  report('hashing');
  const bytes = await original.arrayBuffer();
  const sha = await sha256Hex(bytes);

  report('checking');
  const check = await api<{ existing: string[] }>('/media/check', {
    method: 'POST',
    body: { hashes: [sha] },
  });
  if (check.existing.includes(sha)) {
    // The same original is already stored; re-uploading it would only cost
    // bandwidth (docs/ADMIN.md §8).
    report('skipped');
    bitmap?.close();
    return api<MediaItem>(`/media/${sha}`);
  }

  report('uploading');
  const response = await put(`/media/${sha}`, bytes, {
    'x-mallok-filename': encodeURIComponent(file.name),
  });
  if (!response.ok) {
    bitmap?.close();
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? 'The upload failed.');
  }

  if (bitmap !== null) {
    report('converting');
    for (const width of options.widths) {
      const variant = await renderVariant(bitmap, width);
      if (variant === null) {
        continue;
      }
      await put(
        `/media/${sha}/variants/${width}`,
        await variant.arrayBuffer(),
        {
          'content-type': 'image/webp',
        },
      );
    }
    bitmap.close();
  }

  report('done');
  return api<MediaItem>(`/media/${sha}`);
}

/**
 * The relative path a piece of content should reference for a media item.
 *
 * Content stores paths, never URLs — that is what makes an export portable
 * (docs/CONTENT_FORMAT.md §4). The name is reduced to characters that survive
 * every filesystem and archive format, and leading dots are dropped so the
 * result can never read as a traversal or a hidden file when an export is
 * unpacked.
 */
export function relativePathFor(item: MediaItem): string {
  const folder = item.kind === 'image' ? 'images' : 'files';
  const base =
    item.originalName
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[.-]+/, '')
      .replace(/-{2,}/g, '-') || `file.${item.ext}`;
  return `${folder}/${base}`;
}
