/**
 * Media endpoints: dedupe check, upload of an original and its WebP variants,
 * listing, alt text and deletion.
 *
 * The Worker never processes images (docs/ARCHITECTURE.md §8). It receives
 * bytes that the browser or the CLI already converted, verifies what they
 * really are, and stores them under a content-addressed key. Two consequences
 * follow: the same file uploaded twice costs one object, and a client cannot
 * disguise one file type as another by renaming it.
 */

import { z } from 'zod';
import {
  findType,
  mediaObjectKey,
  readImageSize,
  sha256HexOfBytes,
  sniffMediaType,
  variantObjectKey,
} from '../core/index.js';
import {
  deleteUnreferencedMedia,
  existingMedia,
  findMedia,
  insertMedia,
  listMedia,
  setMediaAlt,
  setVariants,
} from '../db/media.js';
import type { Env } from './env.js';
import { json, problem, readJson } from './http.js';

/**
 * Largest object accepted in one request. Chosen to stay well inside the
 * Worker's memory while covering product photography and datasheets; raising
 * it means holding that many bytes in an isolate limited to 128 MB.
 */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/** Widest variant worth storing. */
const MAX_VARIANT_WIDTH = 4096;

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const checkSchema = z.object({
  hashes: z.array(z.string().regex(SHA_PATTERN)).max(500),
});

const altSchema = z.object({ alt: z.string().max(500).nullable() });

/** Reports which of the given hashes are already stored. */
export async function checkMedia(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = checkSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(400, 'Provide a list of sha256 hashes.');
  }
  const existing = await existingMedia(env.DB, parsed.data.hashes);
  return json({ existing });
}

/**
 * Stores an original object under `sha256`.
 *
 * The hash in the path is not a name the client chose: the body is hashed and
 * must match it, which is what makes the key content-addressed and lets a
 * repeated upload be a no-op.
 */
export async function putMedia(
  request: Request,
  env: Env,
  sha256: string,
  now: Date,
): Promise<Response> {
  if (!SHA_PATTERN.test(sha256)) {
    return problem(400, 'The media id must be a sha256 hex digest.');
  }
  const body = await readBody(request);
  if (body === null) {
    return problem(
      413,
      `Media objects are limited to ${MAX_MEDIA_BYTES} bytes.`,
    );
  }
  if (body.byteLength === 0) {
    return problem(400, 'The request body is empty.');
  }

  const actual = await sha256HexOfBytes(body);
  if (actual !== sha256) {
    return problem(400, 'The body does not match the sha256 in the path.');
  }

  const filename = decodeHeader(request, 'x-mallok-filename') ?? 'upload';
  const declaredExt = filename.split('.').pop()?.toLowerCase();
  const type = sniffMediaType(body, declaredExt);
  if (type === null) {
    return problem(
      415,
      'Unsupported file type. Accepted: jpg, png, gif, webp, avif, pdf, xlsx, docx, zip.',
    );
  }

  const existing = await findMedia(env.DB, sha256);
  if (existing !== null) {
    return json({ ...describe(existing), deduplicated: true });
  }

  const size = type.kind === 'image' ? readImageSize(body) : null;
  await env.MEDIA.put(mediaObjectKey(sha256, type.ext), body, {
    httpMetadata: { contentType: type.mime, cacheControl: IMMUTABLE },
  });
  await insertMedia(env.DB, {
    sha256,
    kind: type.kind,
    mime: type.mime,
    ext: type.ext,
    bytes: body.byteLength,
    width: size?.width ?? null,
    height: size?.height ?? null,
    originalName: filename,
    alt: decodeHeader(request, 'x-mallok-alt'),
    now: now.toISOString(),
  });

  const stored = await findMedia(env.DB, sha256);
  return json(stored === null ? { sha256 } : describe(stored), {
    status: 201,
  });
}

/** Stores one WebP variant of an existing image. */
export async function putVariant(
  request: Request,
  env: Env,
  sha256: string,
  width: number,
): Promise<Response> {
  if (!SHA_PATTERN.test(sha256)) {
    return problem(400, 'The media id must be a sha256 hex digest.');
  }
  if (!Number.isInteger(width) || width < 1 || width > MAX_VARIANT_WIDTH) {
    return problem(400, `Variant width must be 1..${MAX_VARIANT_WIDTH}.`);
  }
  const parent = await findMedia(env.DB, sha256);
  if (parent === null) {
    return problem(404, 'Upload the original before its variants.');
  }
  if (parent.kind !== 'image') {
    return problem(400, 'Only images have variants.');
  }

  const body = await readBody(request);
  if (body === null) {
    return problem(
      413,
      `Media objects are limited to ${MAX_MEDIA_BYTES} bytes.`,
    );
  }
  const type = sniffMediaType(body);
  if (type === null || type.ext !== 'webp') {
    return problem(415, 'Variants must be WebP.');
  }

  const webp = findType('webp');
  await env.MEDIA.put(variantObjectKey(sha256, width), body, {
    httpMetadata: {
      contentType: webp?.mime ?? 'image/webp',
      cacheControl: IMMUTABLE,
    },
  });
  const widths = parseWidths(parent.variants);
  widths.push(width);
  await setVariants(env.DB, sha256, widths);

  const updated = await findMedia(env.DB, sha256);
  return json(updated === null ? { sha256, width } : describe(updated));
}

/** Lists the media library. */
export async function getMediaList(env: Env, url: URL): Promise<Response> {
  const kind = url.searchParams.get('kind');
  if (kind !== null && kind !== 'image' && kind !== 'file') {
    return problem(400, 'Unknown kind filter.');
  }
  const limit = clamp(
    Number(url.searchParams.get('limit') ?? DEFAULT_PAGE_SIZE),
    1,
    MAX_PAGE_SIZE,
  );
  const offset = clamp(Number(url.searchParams.get('offset') ?? 0), 0, 1e6);
  const result = await listMedia(env.DB, {
    ...(kind === null ? {} : { kind }),
    ...(url.searchParams.get('unused') === '1' ? { unusedOnly: true } : {}),
    limit,
    offset,
  });
  return json({
    items: result.items.map(describe),
    hasNext: result.hasNext,
    limit,
    offset,
  });
}

/** Returns one media object. */
export async function getMediaItem(
  env: Env,
  sha256: string,
): Promise<Response> {
  const row = await findMedia(env.DB, sha256);
  if (row === null) {
    return problem(404, 'Not found.');
  }
  return json(describe(row));
}

/** Sets the default alt text of an image. */
export async function patchMedia(
  request: Request,
  env: Env,
  sha256: string,
): Promise<Response> {
  const parsed = altSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return problem(400, 'Provide an "alt" string or null.');
  }
  const updated = await setMediaAlt(env.DB, sha256, parsed.data.alt);
  if (!updated) {
    return problem(404, 'Not found.');
  }
  return getMediaItem(env, sha256);
}

/**
 * Deletes a media object, but only while no content references it. Deleting a
 * referenced object would leave a broken image with no way to find out which
 * page lost it, so the request is refused with the count instead.
 */
export async function removeMedia(env: Env, sha256: string): Promise<Response> {
  const row = await findMedia(env.DB, sha256);
  if (row === null) {
    return problem(404, 'Not found.');
  }
  if (row.ref_count > 0) {
    return problem(
      409,
      `This file is used by ${row.ref_count} item(s). Remove those references first.`,
    );
  }
  const deleted = await deleteUnreferencedMedia(env.DB, sha256);
  if (!deleted) {
    return problem(409, 'This file is in use.');
  }
  await deleteObjects(env, row.sha256, row.ext, parseWidths(row.variants));
  return json({ ok: true, sha256 });
}

/** Removes an original and every variant from R2. */
export async function deleteObjects(
  env: Env,
  sha256: string,
  ext: string,
  widths: readonly number[],
): Promise<void> {
  const keys = [
    mediaObjectKey(sha256, ext),
    ...widths.map((width) => variantObjectKey(sha256, width)),
  ];
  await env.MEDIA.delete(keys);
}

/** Shapes a media row for the API. */
function describe(row: {
  readonly sha256: string;
  readonly kind: string;
  readonly mime: string;
  readonly ext: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly variants: string;
  readonly original_name: string;
  readonly alt: string | null;
  readonly ref_count: number;
  readonly unreferenced_since: string | null;
  readonly created_at: string;
}) {
  return {
    sha256: row.sha256,
    kind: row.kind,
    mime: row.mime,
    ext: row.ext,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    variants: parseWidths(row.variants),
    originalName: row.original_name,
    alt: row.alt,
    refCount: row.ref_count,
    unreferencedSince: row.unreferenced_since,
    createdAt: row.created_at,
  };
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_MEDIA_BYTES) {
    return null;
  }
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    return null;
  }
  return new Uint8Array(buffer);
}

function decodeHeader(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (raw === null || raw === '') {
    return null;
  }
  try {
    return decodeURIComponent(raw).slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

function parseWidths(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is number => typeof value === 'number' && value > 0,
    );
  } catch {
    return [];
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}
