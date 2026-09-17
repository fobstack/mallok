import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExportZip } from '../../src/admin/export.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function manifest(body: Record<string, unknown>): Response {
  return Response.json({
    generatedFor: 'Example',
    files: [],
    counts: { content: 0, files: 0, media: 0 },
    pluginExportFailures: [],
    ...body,
  });
}

describe('the browser export', () => {
  it('requests the shared export manifest endpoint first', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => manifest({}));
    vi.stubGlobal('fetch', fetch);

    await buildExportZip();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/_mallok/api/export');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
    });
  });

  it('does not create a backup when a plugin export failed', async () => {
    const fetch = vi.fn(async () =>
      manifest({
        files: [{ path: 'site.json', text: '{}' }],
        counts: { content: 0, files: 1, media: 0 },
        pluginExportFailures: [
          { plugin: 'inquiry', error: 'database unavailable' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(buildExportZip()).rejects.toThrow(/inquiry.*no backup/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a listed media object that cannot be fetched as a failure', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        manifest({
          files: [
            {
              path: 'media/file.bin',
              url: '/media/file.bin',
              sha256: 'a'.repeat(64),
            },
          ],
          counts: { content: 0, files: 1, media: 1 },
        }),
      )
      .mockResolvedValueOnce(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetch);

    await expect(buildExportZip()).rejects.toThrow(/could not fetch/i);
  });

  it('refuses an archive key that object-backed ZIP readers can lose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        manifest({
          files: [{ path: '__proto__', text: 'kept' }],
          counts: { content: 0, files: 1, media: 0 },
        }),
      ),
    );

    await expect(buildExportZip()).rejects.toThrow(/reserved archive key/i);
  });

  it('refuses portable-path aliases before fetching any media', async () => {
    const fetch = vi.fn(async () =>
      manifest({
        files: [
          { path: 'File.txt', text: 'one' },
          { path: 'file.txt', url: '/media/file.txt' },
        ],
        counts: { content: 0, files: 2, media: 1 },
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(buildExportZip()).rejects.toThrow(/conflicts/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
