import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStatic } from '../../src/cli/build.js';
import { makeReporter } from '../../src/cli/output.js';

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
});
