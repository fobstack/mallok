/**
 * Media rules shared by the Worker, the CLI and the admin: which file types
 * are accepted, how their real type is determined, how large images are, and
 * what an object is called in R2.
 *
 * Type detection reads magic bytes rather than trusting a file extension
 * (docs/SECURITY.md §6). Nothing here touches the Workers runtime, so the
 * upload side can apply exactly the same rules before sending anything.
 */

/** What a stored object is used for. */
export type MediaKind = 'image' | 'file';

/** A file type Mallok accepts. */
export interface MediaType {
  readonly kind: MediaKind;
  readonly mime: string;
  /** Canonical extension, without the dot. */
  readonly ext: string;
}

/**
 * Accepted types (docs/CONTENT_FORMAT.md §4.1).
 *
 * SVG is deliberately absent: it can carry script, and sanitizing it safely
 * needs a second allow-list that 0.1 does not have.
 */
const IMAGE_TYPES: readonly MediaType[] = [
  { kind: 'image', mime: 'image/jpeg', ext: 'jpg' },
  { kind: 'image', mime: 'image/png', ext: 'png' },
  { kind: 'image', mime: 'image/gif', ext: 'gif' },
  { kind: 'image', mime: 'image/webp', ext: 'webp' },
  { kind: 'image', mime: 'image/avif', ext: 'avif' },
];

const FILE_TYPES: readonly MediaType[] = [
  { kind: 'file', mime: 'application/pdf', ext: 'pdf' },
  {
    kind: 'file',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  {
    kind: 'file',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  { kind: 'file', mime: 'application/zip', ext: 'zip' },
];

/** Every accepted type, images first. */
export const ACCEPTED_TYPES: readonly MediaType[] = [
  ...IMAGE_TYPES,
  ...FILE_TYPES,
];

/** Extensions that share the ZIP container signature. */
const ZIP_EXTENSIONS = new Set(['xlsx', 'docx', 'zip']);

/**
 * Determines the real type of `bytes`.
 *
 * `declaredExt` is consulted for one case only: OOXML documents and plain
 * archives are all ZIP containers, and telling them apart needs the central
 * directory rather than a signature. For that family the signature decides
 * that it *is* a ZIP and the declared extension only picks the label, which
 * is why the extension is still validated against the allow-list. Every other
 * type is decided by its signature alone.
 */
export function sniffMediaType(
  bytes: Uint8Array,
  declaredExt?: string,
): MediaType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return findType('jpg');
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return findType('png');
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return findType('gif');
  }
  if (isRiff(bytes, 'WEBP')) {
    return findType('webp');
  }
  if (isIsoBmff(bytes, 'avif') || isIsoBmff(bytes, 'avis')) {
    return findType('avif');
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return findType('pdf');
  }
  if (isZip(bytes)) {
    const ext = (declaredExt ?? 'zip').toLowerCase();
    return findType(ZIP_EXTENSIONS.has(ext) ? ext : 'zip');
  }
  return null;
}

/** Looks up an accepted type by its canonical extension. */
export function findType(ext: string): MediaType | null {
  return ACCEPTED_TYPES.find((type) => type.ext === ext) ?? null;
}

/** Pixel dimensions of an image. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Reads the pixel dimensions out of an image header, or returns `null` when
 * the format is not one this reader understands (AVIF) or the header is
 * truncated. Dimensions come from the bytes rather than from the uploader so
 * that a wrong value cannot introduce layout shift.
 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return readPngSize(bytes);
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return readGifSize(bytes);
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return readJpegSize(bytes);
  }
  if (isRiff(bytes, 'WEBP')) {
    return readWebpSize(bytes);
  }
  return null;
}

/** Default variant widths (docs/ARCHITECTURE.md §8). */
export const DEFAULT_VARIANT_WIDTHS: readonly number[] = [480, 960, 1440, 1920];

/**
 * Chooses which variant widths are worth generating for an image of
 * `originalWidth`. Upscaling never helps, so widths at or above the original
 * are dropped, except that the original width itself is kept when no
 * requested width is smaller — otherwise a small image would get no variant
 * at all.
 */
export function planVariants(
  originalWidth: number,
  requested: readonly number[] = DEFAULT_VARIANT_WIDTHS,
): number[] {
  const usable = requested
    .filter((width) => width > 0 && width < originalWidth)
    .sort((a, b) => a - b);
  if (usable.length === 0) {
    return originalWidth > 0 ? [originalWidth] : [];
  }
  return usable;
}

/** R2 key of an original object. */
export function mediaObjectKey(sha256: string, ext: string): string {
  return `media/${sha256}.${ext}`;
}

/** R2 key of a WebP variant. */
export function variantObjectKey(sha256: string, width: number): string {
  return `media/${sha256}_${width}.webp`;
}

/** R2 key prefix of a theme's static assets. */
export function themeAssetKey(
  themeId: string,
  rev: number,
  path: string,
): string {
  return `themes/${themeId}/${rev}/${path}`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) {
    return '';
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(bytes[offset + i] ?? 0);
  }
  return out;
}

function isRiff(bytes: Uint8Array, form: string): boolean {
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === form;
}

function isIsoBmff(bytes: Uint8Array, brand: string): boolean {
  return ascii(bytes, 4, 4) === 'ftyp' && ascii(bytes, 8, 4) === brand;
}

function isZip(bytes: Uint8Array): boolean {
  // Local file header, plus the empty-archive and spanned-archive markers.
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 4) {
    return null;
  }
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function readUint16LE(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 2) {
    return null;
  }
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint16BE(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 2) {
    return null;
  }
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readPngSize(bytes: Uint8Array): ImageSize | null {
  // IHDR is always the first chunk: width and height at bytes 16 and 20.
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return sizeOrNull(width, height);
}

function readGifSize(bytes: Uint8Array): ImageSize | null {
  return sizeOrNull(readUint16LE(bytes, 6), readUint16LE(bytes, 8));
}

function readJpegSize(bytes: Uint8Array): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      return sizeOrNull(
        readUint16BE(bytes, offset + 7),
        readUint16BE(bytes, offset + 5),
      );
    }
    const segmentLength = readUint16BE(bytes, offset + 2);
    if (segmentLength === null || segmentLength < 2) {
      return null;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpSize(bytes: Uint8Array): ImageSize | null {
  const format = ascii(bytes, 12, 4);
  if (format === 'VP8X') {
    // 24-bit little-endian, stored as value - 1.
    const width = readUint24LE(bytes, 24);
    const height = readUint24LE(bytes, 27);
    return width === null || height === null
      ? null
      : sizeOrNull(width + 1, height + 1);
  }
  if (format === 'VP8L') {
    const bits = readUint32LE(bytes, 21);
    if (bits === null) {
      return null;
    }
    return sizeOrNull((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (format === 'VP8 ') {
    const width = readUint16LE(bytes, 26);
    const height = readUint16LE(bytes, 28);
    return width === null || height === null
      ? null
      : sizeOrNull(width & 0x3fff, height & 0x3fff);
  }
  return null;
}

function readUint24LE(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 3) {
    return null;
  }
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number | null {
  if (bytes.length < offset + 4) {
    return null;
  }
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function sizeOrNull(
  width: number | null,
  height: number | null,
): ImageSize | null {
  if (width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}
