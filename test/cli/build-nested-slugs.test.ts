import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStatic, outputPath } from '../../src/cli/build.js';
import { CliError, makeReporter } from '../../src/cli/output.js';

/**
 * `mallok build` and slugs of several segments (Task 50): a nested slug is a
 * nested directory in the output, whether the bundle states it in front
 * matter or an export recorded it in `mallok.json` beside a flattened folder.
 */

const ORIGIN = 'https://docs.example';

async function put(root: string, path: string, text: string): Promise<void> {
  const full = join(root, ...path.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, text, 'utf8');
}

describe('mallok build with nested slugs', () => {
  it('writes each nested item at its full path and lists it in the sitemap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mallok-nested-'));
    const out = await mkdtemp(join(tmpdir(), 'mallok-nested-out-'));
    await put(
      root,
      'site.json',
      JSON.stringify({
        name: 'Docs',
        defaultLocale: 'en',
        locales: ['en', 'zh-cn'],
        prefixDefaultLocale: true,
        kinds: { page: { base: '' }, article: { base: 'rest-api' } },
        themeOptions: {},
      }),
    );
    await put(
      root,
      'content/article/symbol-list/index.md',
      '---\ntitle: Symbol list\nslug: basics/symbol-list\ndate: 2026-01-01T00:00:00Z\n---\n\nAll.',
    );
    await put(
      root,
      'content/article/crypto-crypto-quote/index.md',
      '---\ntitle: Crypto quote\ndate: 2026-01-01T00:00:00Z\n---\n\n## Request\n\nLatest.',
    );
    await put(
      root,
      'content/article/crypto-crypto-quote/index.zh-cn.md',
      '---\ntitle: 加密货币报价\ndate: 2026-01-01T00:00:00Z\n---\n\n最新。',
    );
    await put(
      root,
      'content/article/crypto-crypto-quote/mallok.json',
      JSON.stringify({
        translation_group: 'g1',
        items: {
          en: {
            id: 'a',
            created_at: 't',
            path: '/en/rest-api/crypto/crypto-quote',
            slug: 'crypto/crypto-quote',
          },
          'zh-cn': {
            id: 'b',
            created_at: 't',
            path: '/zh-cn/rest-api/crypto/crypto-quote',
            slug: 'crypto/crypto-quote',
          },
        },
      }),
    );
    await buildStatic(
      {
        root,
        themeDir: 'src/themes/manual',
        outDir: out,
        origin: ORIGIN,
        now: new Date('2026-06-01T00:00:00Z'),
      },
      makeReporter(false, true),
    );

    const read = (path: string) => readFile(join(out, path), 'utf8');
    const quote = await read('en/rest-api/crypto/crypto-quote/index.html');
    expect(quote).toContain(
      `<link rel="canonical" href="${ORIGIN}/en/rest-api/crypto/crypto-quote">`,
    );
    // The heading ids of Task 48 reach a static build too.
    expect(quote).toContain('<h2 id="request">Request</h2>');
    expect(
      existsSync(join(out, 'zh-cn/rest-api/crypto/crypto-quote/index.html')),
    ).toBe(true);
    expect(
      existsSync(join(out, 'en/rest-api/basics/symbol-list/index.html')),
    ).toBe(true);
    // The flattened folder name is not an address.
    expect(
      existsSync(join(out, 'en/rest-api/crypto-crypto-quote/index.html')),
    ).toBe(false);

    const sitemap = await read('sitemap.xml');
    expect(sitemap).toContain(
      `<loc>${ORIGIN}/en/rest-api/crypto/crypto-quote</loc>`,
    );
    expect(sitemap).toContain(
      `<loc>${ORIGIN}/en/rest-api/basics/symbol-list</loc>`,
    );
  });

  it('refuses, writing nothing, a slug the Worker would refuse', async () => {
    // The build turns a slug into folders: `../../x` would write outside the
    // output, `page/2` over a list's second page, `Products` to an address
    // that, imported, the Worker never serves.
    const root = await mkdtemp(join(tmpdir(), 'mallok-badslug-'));
    const parent = await mkdtemp(join(tmpdir(), 'mallok-badslug-out-'));
    const out = join(parent, 'site');
    await put(
      root,
      'site.json',
      JSON.stringify({
        name: 'Docs',
        defaultLocale: 'en',
        locales: ['en', 'zh'],
        kinds: { page: { base: '' }, article: { base: 'notes' } },
      }),
    );
    const article = (slug: string) =>
      `---\ntitle: T\nslug: ${slug}\ndate: 2026-01-01T00:00:00Z\n---\n\nBody.`;
    await put(
      root,
      'content/article/escape/index.md',
      article('../../escaped'),
    );
    await put(root, 'content/article/paged/index.md', article('page/2'));
    await put(root, 'content/article/upper/index.md', article('Products'));
    await put(
      root,
      'content/page/clash/index.md',
      '---\ntitle: T\nslug: zh/about\n---\n\nBody.',
    );
    await put(root, 'content/article/fine/index.md', article('fine'));

    const attempt = buildStatic(
      {
        root,
        themeDir: 'src/themes/manual',
        outDir: out,
        origin: ORIGIN,
        now: new Date('2026-06-01T00:00:00Z'),
      },
      makeReporter(false, true),
    );
    await expect(attempt).rejects.toBeInstanceOf(CliError);
    const message = await attempt.catch((caught: Error) => caught.message);
    expect(message).toContain('4 slugs cannot be built');
    expect(message).toContain('article "../../escaped" (en)');
    expect(message).toContain('article "page/2" (en)');
    expect(message).toContain(
      'article "Products" (en): The slug must use lowercase',
    );
    expect(message).toContain('page "zh/about" (en)');
    expect(message).not.toContain('"fine"');
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(parent, 'escaped'))).toBe(false);
  });

  it('never writes outside the output, whatever becomes a path', () => {
    // A tag named `..` is an archive at `/tags/..`, which is the folder
    // above it: the site's home page.
    for (const path of ['/tags/..', '/tags/.', '/../x', '/a/../../b']) {
      expect(() => outputPath('/out', path), path).toThrow(CliError);
    }
    expect(outputPath('/out', '/')).toBe(join('/out', 'index.html'));
    expect(outputPath('/out', '/tags/a%2F..')).toBe(
      join('/out', 'tags', 'a%2F..', 'index.html'),
    );
  });
});
