import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SiteClient } from '../../src/cli/client.js';
import { exportSite } from '../../src/cli/export.js';
import {
  existingHashes,
  prepareMedia,
  uploadMedia,
} from '../../src/cli/media.js';
import { CliError, EXIT, makeReporter } from '../../src/cli/output.js';

/**
 * `mallok export` and the media pipeline, driven through a stub site rather
 * than a real one. Both write to disk or upload bytes, so the properties that
 * matter are the ones a live run would only reveal after damage: a manifest
 * path that escapes the export directory, a re-upload of a file the site
 * already has, and the variant widths a theme asked for.
 */

/** A site that answers from fixtures and records what was sent to it. */
function stubSite(
  responses: Record<string, unknown>,
  options: { readonly putStatus?: number } = {},
): SiteClient & {
  puts: { path: string; bytes: number }[];
  posts: { path: string; body: unknown }[];
} {
  const puts: { path: string; bytes: number }[] = [];
  const posts: { path: string; body: unknown }[] = [];
  return {
    origin: 'https://example.com',
    puts,
    posts,
    async get<T>(path: string): Promise<T> {
      if (!(path in responses)) {
        throw new CliError(EXIT.remote, `no fixture for ${path}`);
      }
      return responses[path] as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      posts.push({ path, body });
      return responses[path] as T;
    },
    async patch<T>(): Promise<T> {
      throw new Error('not used');
    },
    async put(path, body) {
      puts.push({ path, bytes: body.byteLength });
      return new Response('', { status: options.putStatus ?? 200 });
    },
    async bytes(path: string): Promise<Uint8Array> {
      return new Uint8Array(Buffer.from(`bytes-for:${path}`));
    },
  };
}

const silent = makeReporter(false, true);

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mallok-export-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('mallok export', () => {
  it('writes inline text verbatim and fetches media by URL', async () => {
    const mediaUrl = '/media/original/abc.jpg';
    const mediaSha = createHash('sha256')
      .update(`bytes-for:${mediaUrl}`)
      .digest('hex');
    const client = stubSite({
      '/export': {
        files: [
          { path: 'articles/one/index.md', text: '---\ntitle: One\n---\n\nA' },
          {
            path: 'articles/one/images/photo.jpg',
            url: mediaUrl,
            sha256: mediaSha,
          },
        ],
        counts: { content: 1, files: 2, media: 1 },
      },
    });

    const result = await exportSite(client, dir, silent);

    expect(result).toEqual({ files: 2, media: 1, content: 1 });
    expect(await readFile(join(dir, 'articles/one/index.md'), 'utf8')).toBe(
      '---\ntitle: One\n---\n\nA',
    );
    expect(
      await readFile(join(dir, 'articles/one/images/photo.jpg'), 'utf8'),
    ).toBe('bytes-for:/media/original/abc.jpg');
  });

  it('rejects a manifest entry that carries neither text nor a URL', async () => {
    const client = stubSite({
      '/export': {
        files: [
          { path: 'articles/one/index.md', text: 'A' },
          { path: 'articles/one/ghost.md' },
        ],
        counts: { content: 1, files: 2, media: 0 },
      },
    });

    await expect(exportSite(client, dir, silent)).rejects.toThrow(
      /exactly one of text or url/i,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a path that would escape the export directory', async () => {
    for (const path of [
      '../escape.md',
      'a/../../escape.md',
      '/etc/passwd',
      '..\\escape.md',
      'folder\\escape.md',
      'C:\\Windows\\system.ini',
      'C:/Windows/system.ini',
      'articles/./escape.md',
      'articles//escape.md',
      'articles/bad:name.md',
      'articles/trailing-dot.',
      'articles/CON',
      'articles/COM¹.txt',
      `articles/bad-${String.fromCharCode(0xd800)}.txt`,
    ]) {
      const client = stubSite({
        '/export': {
          files: [{ path, text: 'x' }],
          counts: { content: 1, files: 1, media: 0 },
        },
      });
      const error = await exportSite(client, dir, silent).catch(
        (cause) => cause,
      );
      expect(error, path).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe(EXIT.remote);
    }
  });

  it('validates every path before writing the first file', async () => {
    const client = stubSite({
      '/export': {
        files: [
          { path: 'safe/first.md', text: 'would otherwise be written' },
          { path: '..\\outside.md', text: 'unsafe' },
        ],
        counts: { content: 1, files: 2, media: 0 },
      },
    });

    await expect(exportSite(client, dir, silent)).rejects.toBeInstanceOf(
      CliError,
    );
    await expect(readFile(join(dir, 'safe/first.md'))).rejects.toThrow();
  });

  it('refuses duplicate paths before either can overwrite the other', async () => {
    const client = stubSite({
      '/export': {
        files: [
          { path: 'Site.json', text: 'first' },
          { path: 'site.json', text: 'second' },
        ],
        counts: { content: 0, files: 2, media: 0 },
      },
    });

    const error = await exportSite(client, dir, silent).catch((cause) => cause);
    expect(error).toBeInstanceOf(CliError);
    expect((error as Error).message).toMatch(/more than once/i);
    await expect(readFile(join(dir, 'Site.json'))).rejects.toThrow();
    await expect(readFile(join(dir, 'site.json'))).rejects.toThrow();
  });

  it('refuses an incomplete backup when any plugin export failed', async () => {
    const client = stubSite({
      '/export': {
        files: [{ path: 'site.json', text: '{}' }],
        counts: { content: 0, files: 1, media: 0 },
        pluginExportFailures: [
          { plugin: 'inquiry', error: 'unsafe export path' },
        ],
      },
    });

    await expect(exportSite(client, dir, silent)).rejects.toThrow(
      /could not export data.*inquiry/i,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps the destination untouched when a later download fails', async () => {
    const base = stubSite({
      '/export': {
        files: [
          { path: 'site.json', text: '{}' },
          {
            path: 'media/file.bin',
            url: '/media/file.bin',
            sha256: 'a'.repeat(64),
          },
        ],
        counts: { content: 0, files: 2, media: 1 },
      },
    });
    const client: SiteClient = {
      ...base,
      async bytes() {
        throw new CliError(EXIT.remote, 'download failed');
      },
    };

    await expect(exportSite(client, dir, silent)).rejects.toThrow(
      /download failed/i,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a non-empty or symbolic-link destination', async () => {
    await writeFile(join(dir, 'keep.txt'), 'do not replace', 'utf8');
    const client = stubSite({
      '/export': {
        files: [{ path: 'site.json', text: '{}' }],
        counts: { content: 0, files: 1, media: 0 },
      },
    });

    await expect(exportSite(client, dir, silent)).rejects.toThrow(/not empty/i);
    await expect(readFile(join(dir, 'keep.txt'), 'utf8')).resolves.toBe(
      'do not replace',
    );

    const outside = await mkdtemp(join(tmpdir(), 'mallok-export-outside-'));
    try {
      await rm(dir, { recursive: true, force: true });
      await symlink(
        outside,
        dir,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(exportSite(client, dir, silent)).rejects.toThrow(
        /new or empty directory/i,
      );
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('the CLI media pipeline', () => {
  /** A real 40×20 PNG, so `sharp` has something genuine to read. */
  async function samplePng(width = 40, height = 20): Promise<string> {
    const { default: sharp } = await import('sharp');
    const file = join(dir, `sample-${width}x${height}.png`);
    await writeFile(
      file,
      await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 200, g: 40, b: 40 },
        },
      })
        .png()
        .toBuffer(),
    );
    return file;
  }

  it('rejects a type the media API does not accept', async () => {
    const file = join(dir, 'logo.svg');
    await writeFile(file, '<svg/>');

    const error = await prepareMedia(file, 'images/logo.svg', 1600).catch(
      (cause) => cause,
    );

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe(EXIT.user);
    expect((error as CliError).hint).toContain('SVG is not accepted');
  });

  it('caps an oversized image and hashes what will actually be stored', async () => {
    const file = await samplePng(200, 100);
    const { default: sharp } = await import('sharp');

    const capped = await prepareMedia(file, 'images/wide.png', 80);
    const uncapped = await prepareMedia(file, 'images/wide.png', null);

    const meta = await sharp(capped.bytes).metadata();
    expect(meta.width).toBe(80);
    // The hash is taken after capping — otherwise the same picture would
    // upload twice under two different limits.
    expect(capped.sha256).not.toBe(uncapped.sha256);
    expect(capped.fileName).toBe('wide.png');
    expect(capped.isImage).toBe(true);
  });

  it('leaves an image already inside the cap untouched', async () => {
    const file = await samplePng(40, 20);

    const prepared = await prepareMedia(file, 'images/small.png', 1600);

    expect(prepared.bytes.byteLength).toBe((await readFile(file)).byteLength);
  });

  it('accepts a document without treating it as an image', async () => {
    const file = join(dir, 'spec.pdf');
    await writeFile(file, '%PDF-1.4 not really');

    const prepared = await prepareMedia(file, 'files/spec.pdf', 1600);

    expect(prepared.isImage).toBe(false);
  });

  it('uploads the original and one WebP variant per width above the source', async () => {
    const client = stubSite({});
    const media = await prepareMedia(await samplePng(200, 100), 'a.png', null);

    await uploadMedia(client, media, [100, 320, 800]);

    // 320 and 800 are wider than the source, so only 100 is rendered.
    expect(client.puts.map((put) => put.path)).toEqual([
      `/media/${media.sha256}`,
      `/media/${media.sha256}/variants/100`,
    ]);
  });

  it('does not render variants for a document', async () => {
    const client = stubSite({});
    const file = join(dir, 'spec.pdf');
    await writeFile(file, '%PDF-1.4');
    const media = await prepareMedia(file, 'files/spec.pdf', null);

    await uploadMedia(client, media, [320]);

    expect(client.puts).toHaveLength(1);
  });

  it('reports a rejected upload with the right exit code', async () => {
    const media = await prepareMedia(await samplePng(), 'a.png', null);

    for (const [status, expected] of [
      [401, EXIT.auth],
      [403, EXIT.auth],
      [500, EXIT.remote],
    ] as const) {
      const client = stubSite({}, { putStatus: status });
      const error = await uploadMedia(client, media, []).catch(
        (cause) => cause,
      );
      expect(error, String(status)).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe(expected);
    }
  });

  it('asks about existing hashes in bounded batches', async () => {
    const hashes = Array.from({ length: 95 }, (_, index) => `hash-${index}`);
    const client = stubSite({ '/media/check': { existing: ['hash-3'] } });

    const found = await existingHashes(client, hashes);

    // 95 hashes must not become one request that D1 would refuse.
    expect(client.posts).toHaveLength(3);
    for (const call of client.posts) {
      expect(
        (call.body as { hashes: string[] }).hashes.length,
      ).toBeLessThanOrEqual(40);
    }
    expect([...found]).toEqual(['hash-3']);
  });

  it('asks nothing when there is nothing to ask about', async () => {
    const client = stubSite({});

    expect((await existingHashes(client, [])).size).toBe(0);
    expect(client.posts).toHaveLength(0);
  });
});
