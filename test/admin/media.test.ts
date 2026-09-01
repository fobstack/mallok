import { describe, expect, it } from 'vitest';
import { relativePathFor } from '../../src/admin/media.js';
import type { MediaItem } from '../../src/admin/types.js';

function item(overrides: Partial<MediaItem>): MediaItem {
  return {
    sha256: 'a'.repeat(64),
    kind: 'image',
    mime: 'image/jpeg',
    ext: 'jpg',
    bytes: 1000,
    width: 1600,
    height: 900,
    variants: [480, 960],
    originalName: 'photo.jpg',
    alt: null,
    refCount: 0,
    url: 'https://media.example/x.jpg',
    ...overrides,
  };
}

describe('relativePathFor', () => {
  it('files images under images/ and everything else under files/', () => {
    expect(relativePathFor(item({}))).toBe('images/photo.jpg');
    expect(
      relativePathFor(
        item({ kind: 'file', ext: 'pdf', originalName: 'sheet.pdf' }),
      ),
    ).toBe('files/sheet.pdf');
  });

  it('strips characters that would break a relative path', () => {
    // The value is written into front matter and into an export folder, so
    // it has to be a plain, portable path (docs/CONTENT_FORMAT.md §4).
    expect(relativePathFor(item({ originalName: 'my photo (1).jpg' }))).toBe(
      'images/my-photo-1-.jpg',
    );
    // No leading dots, no slashes: an export must unpack to a plain file.
    expect(relativePathFor(item({ originalName: '../../etc/passwd' }))).toBe(
      'images/etc-passwd',
    );
    expect(relativePathFor(item({ originalName: '.hidden.png' }))).toBe(
      'images/hidden.png',
    );
    // A name with nothing usable left still yields a valid path.
    expect(relativePathFor(item({ originalName: '产品图' }))).toBe(
      'images/file.jpg',
    );
  });

  it('never produces a URL', () => {
    const path = relativePathFor(item({}));
    expect(path).not.toContain('://');
    expect(path.startsWith('/')).toBe(false);
  });
});
