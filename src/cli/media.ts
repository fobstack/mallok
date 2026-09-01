/**
 * The CLI's image pipeline (docs/CLI.md §6.2, docs/ARCHITECTURE.md §8).
 *
 * Same specification as the browser's Canvas pipeline: the original is
 * capped at the site's longest edge, variants are WebP at the theme's
 * declared widths. The two are **not** required to be byte-identical — the
 * deduplication key is the original's sha256, so a file uploaded from either
 * end resolves to the same media row.
 *
 * `sharp` is a native module and lives only here; nothing in this file can be
 * imported by the Worker (docs/TECH_STACK.md §5).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SiteClient } from './client.js';
import { CliError, EXIT } from './output.js';

/** Extensions the media API accepts (docs/CONTENT_FORMAT.md §4.1). */
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const FILE_EXT = new Set(['pdf', 'xlsx', 'docx', 'zip']);

/** What one prepared upload carries. */
export interface PreparedMedia {
  readonly sha256: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly isImage: boolean;
  readonly fileName: string;
}

function extensionOf(path: string): string {
  return basename(path).split('.').pop()?.toLowerCase() ?? '';
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Reads a file and, for an image, caps its longest edge.
 *
 * The hash is taken **after** capping, because that is the object that gets
 * stored — hashing the untouched file would make the same picture upload
 * twice under two different limits.
 */
export async function prepareMedia(
  absolutePath: string,
  relativePath: string,
  maxEdge: number | null,
): Promise<PreparedMedia> {
  const ext = extensionOf(relativePath);
  const isImage = IMAGE_EXT.has(ext);
  if (!isImage && !FILE_EXT.has(ext)) {
    throw new CliError(
      EXIT.user,
      `"${relativePath}" has an unsupported type (.${ext}).`,
      'Images: jpg, png, webp, gif, avif. Files: pdf, xlsx, docx, zip. SVG is not accepted.',
    );
  }

  let bytes = new Uint8Array(await readFile(absolutePath));
  if (isImage && maxEdge !== null && ext !== 'gif') {
    const { default: sharp } = await import('sharp');
    const image = sharp(bytes, { animated: false });
    const meta = await image.metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longest > maxEdge) {
      bytes = new Uint8Array(
        await image
          .resize({ width: maxEdge, height: maxEdge, fit: 'inside' })
          .toBuffer(),
      );
    }
  }

  return {
    sha256: sha256Of(bytes),
    path: relativePath,
    bytes,
    isImage,
    fileName: basename(relativePath),
  };
}

/** Renders one WebP variant, or null when the source is already narrower. */
async function renderVariant(
  bytes: Uint8Array,
  width: number,
): Promise<Uint8Array | null> {
  const { default: sharp } = await import('sharp');
  const image = sharp(bytes, { animated: false });
  const meta = await image.metadata();
  if ((meta.width ?? 0) <= width) {
    return null;
  }
  return new Uint8Array(
    await image.resize({ width }).webp({ quality: 82 }).toBuffer(),
  );
}

/** Uploads one prepared object and its variants. */
export async function uploadMedia(
  client: SiteClient,
  media: PreparedMedia,
  widths: readonly number[],
): Promise<void> {
  const response = await client.put(`/media/${media.sha256}`, media.bytes, {
    'x-mallok-filename': encodeURIComponent(media.fileName),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new CliError(
      response.status === 401 || response.status === 403
        ? EXIT.auth
        : EXIT.remote,
      `Could not upload "${media.path}": ${body?.error ?? response.status}.`,
    );
  }
  if (!media.isImage) {
    return;
  }
  for (const width of widths) {
    const variant = await renderVariant(media.bytes, width);
    if (variant === null) {
      continue;
    }
    await client.put(`/media/${media.sha256}/variants/${width}`, variant, {
      'content-type': 'image/webp',
    });
  }
}

/** Asks which hashes the site already stores. */
export async function existingHashes(
  client: SiteClient,
  hashes: readonly string[],
): Promise<Set<string>> {
  if (hashes.length === 0) {
    return new Set();
  }
  const found = new Set<string>();
  // Bounded batches: a check request must stay well inside D1's per-call
  // query limits (docs/CLI.md §6.5).
  for (let index = 0; index < hashes.length; index += 40) {
    const slice = hashes.slice(index, index + 40);
    const result = await client.post<{ existing: string[] }>('/media/check', {
      hashes: slice,
    });
    for (const sha of result.existing) {
      found.add(sha);
    }
  }
  return found;
}
