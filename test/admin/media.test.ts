import { afterEach, describe, expect, it, vi } from 'vitest';
import { relativePathFor, uploadFile } from '../../src/admin/media.js';
import type { MediaItem } from '../../src/admin/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('the browser media API contract', () => {
  it('checks, uploads the original and uploads each rendered variant through the shared endpoints', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 200, height: 100, close })),
    );

    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
        callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
      }),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => canvas),
    });

    const fetch = vi.fn(
      async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = String(input);
        if (url === '/_mallok/api/media/check') {
          return Response.json({ existing: [] });
        }
        if (init.method === 'PUT') {
          return new Response('', { status: 200 });
        }
        const sha = url.split('/').at(-1) ?? '';
        return Response.json(
          item({
            sha256: sha,
            originalName: 'photo.png',
            width: 200,
            height: 100,
            variants: [100],
          }),
        );
      },
    );
    vi.stubGlobal('fetch', fetch);

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', {
      type: 'image/png',
    });
    await uploadFile(file, { widths: [100], maxEdge: null });

    const check = fetch.mock.calls[0];
    expect(check?.[0]).toBe('/_mallok/api/media/check');
    expect(check?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    });
    const hashes = JSON.parse(String(check?.[1]?.body)) as { hashes: string[] };
    expect(hashes.hashes).toHaveLength(1);
    expect(hashes.hashes[0]).toMatch(/^[a-f0-9]{64}$/);
    const sha = hashes.hashes[0] as string;

    expect(fetch.mock.calls[1]?.[0]).toBe(`/_mallok/api/media/${sha}`);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      credentials: 'same-origin',
    });
    expect(fetch.mock.calls[2]?.[0]).toBe(
      `/_mallok/api/media/${sha}/variants/100`,
    );
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'PUT',
      credentials: 'same-origin',
    });
    expect(fetch.mock.calls[3]?.[0]).toBe(`/_mallok/api/media/${sha}`);
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
