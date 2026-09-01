import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VARIANT_WIDTHS,
  findType,
  mediaObjectKey,
  planVariants,
  readImageSize,
  sniffMediaType,
  themeAssetKey,
  variantObjectKey,
} from '../../src/core/media.js';
import {
  gifBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  svgBytes,
  webpBytes,
  zipBytes,
} from '../fixtures/media-bytes.js';

describe('type sniffing', () => {
  it('identifies each accepted image format from its signature', () => {
    expect(sniffMediaType(pngBytes(10, 10))?.ext).toBe('png');
    expect(sniffMediaType(gifBytes(10, 10))?.ext).toBe('gif');
    expect(sniffMediaType(jpegBytes(10, 10))?.ext).toBe('jpg');
    expect(sniffMediaType(webpBytes(10, 10))?.ext).toBe('webp');
  });

  it('identifies PDF', () => {
    const type = sniffMediaType(pdfBytes());
    expect(type?.ext).toBe('pdf');
    expect(type?.kind).toBe('file');
  });

  it('rejects SVG', () => {
    expect(sniffMediaType(svgBytes(), 'svg')).toBeNull();
  });

  it('ignores a lying extension', () => {
    // A PNG renamed to .pdf is still a PNG.
    expect(sniffMediaType(pngBytes(4, 4), 'pdf')?.ext).toBe('png');
    // Arbitrary text is not rescued by claiming to be a PDF.
    expect(sniffMediaType(new TextEncoder().encode('hello'), 'pdf')).toBeNull();
  });

  it('uses the declared extension only to label a ZIP container', () => {
    expect(sniffMediaType(zipBytes(), 'xlsx')?.ext).toBe('xlsx');
    expect(sniffMediaType(zipBytes(), 'docx')?.ext).toBe('docx');
    expect(sniffMediaType(zipBytes(), 'zip')?.ext).toBe('zip');
    // An extension outside the allow-list falls back to a plain archive.
    expect(sniffMediaType(zipBytes(), 'jar')?.ext).toBe('zip');
    expect(sniffMediaType(zipBytes())?.ext).toBe('zip');
  });

  it('rejects empty and truncated input', () => {
    expect(sniffMediaType(new Uint8Array(0))).toBeNull();
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('exposes accepted types by extension', () => {
    expect(findType('png')?.mime).toBe('image/png');
    expect(findType('svg')).toBeNull();
  });
});

describe('image dimensions', () => {
  it('reads the size out of each format it understands', () => {
    expect(readImageSize(pngBytes(1600, 900))).toEqual({
      width: 1600,
      height: 900,
    });
    expect(readImageSize(gifBytes(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageSize(jpegBytes(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
    expect(readImageSize(webpBytes(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it('returns null rather than guessing', () => {
    expect(readImageSize(pdfBytes())).toBeNull();
    expect(readImageSize(new Uint8Array(4))).toBeNull();
    // A PNG signature with no IHDR payload.
    expect(readImageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('variant planning', () => {
  it('never upscales', () => {
    expect(planVariants(1000)).toEqual([480, 960]);
    expect(planVariants(3000)).toEqual([480, 960, 1440, 1920]);
  });

  it('keeps the original width when every requested width is larger', () => {
    expect(planVariants(300)).toEqual([300]);
  });

  it('accepts a narrowed list from a theme', () => {
    expect(planVariants(2000, [600, 1200])).toEqual([600, 1200]);
  });

  it('handles a degenerate width', () => {
    expect(planVariants(0)).toEqual([]);
  });

  it('uses the documented default widths', () => {
    expect(DEFAULT_VARIANT_WIDTHS).toEqual([480, 960, 1440, 1920]);
  });
});

describe('object keys', () => {
  const sha = 'a'.repeat(64);

  it('addresses originals and variants by content hash', () => {
    expect(mediaObjectKey(sha, 'jpg')).toBe(`media/${sha}.jpg`);
    expect(variantObjectKey(sha, 960)).toBe(`media/${sha}_960.webp`);
  });

  it('versions theme assets by revision', () => {
    expect(themeAssetKey('trade', 3, 'style.css')).toBe(
      'themes/trade/3/style.css',
    );
  });
});
