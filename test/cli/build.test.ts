import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStatic } from '../../src/cli/build.js';
import { makeReporter } from '../../src/cli/output.js';

/**
 * A site built entirely from files, with no database anywhere.
 *
 * This is the path for someone who does not want D1: categories, tags,
 * articles, languages and the SEO endpoints all have to work from a
 * directory (docs/CLI.md §7.1).
 */

const SITE = {
  name: 'File Site',
  tagline: 'No database involved',
  defaultLocale: 'en',
  locales: ['en', 'zh'],
  kinds: {
    page: { base: '' },
    article: { base: 'news' },
    product: { base: 'products' },
    category: { base: 'families' },
  },
  nav: { en: [{ label: 'News', href: '/news' }] },
  themeOptions: {},
};

let out = '';
let warnings: readonly string[] = [];

async function put(root: string, path: string, text: string): Promise<void> {
  const full = join(root, ...path.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, text, 'utf8');
}

async function read(path: string): Promise<string> {
  return readFile(join(out, ...path.split('/')), 'utf8');
}

describe('mallok build', () => {
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'mallok-build-'));
    out = await mkdtemp(join(tmpdir(), 'mallok-out-'));
    await put(root, 'site.json', JSON.stringify(SITE));

    await put(
      root,
      'content/category/alloys/index.md',
      '---\ntitle: Alloys\nsummary: A family.\n---\n\nBody.',
    );
    await put(
      root,
      'content/category/alloys/index.zh.md',
      '---\ntitle: 合金\n---\n\n正文。',
    );
    await put(
      root,
      'content/category/alloys/mallok.json',
      JSON.stringify({
        translation_group: 'g1',
        items: {
          en: { id: 'a', created_at: 't', path: '/families/alloys' },
          zh: {
            id: 'b',
            created_at: 't',
            path: '/zh/families/old-path',
            slug: 'hejin',
          },
        },
      }),
    );
    await put(
      root,
      'content/product/bar/index.md',
      '---\ntitle: A bar\ncategory: alloys\ntags: [metal, stock]\n---\n\nBody.',
    );
    await put(
      root,
      'content/article/note/index.md',
      '---\ntitle: A note\ndate: 2026-01-01T00:00:00Z\ntags: [metal]\n---\n\nBody.',
    );
    await put(
      root,
      'content/article/draft/index.md',
      '---\ntitle: Not published\ndraft: true\n---\n\nBody.',
    );
    await put(
      root,
      'content/article/later/index.md',
      '---\ntitle: Scheduled\ndate: 2099-01-01T00:00:00Z\n---\n\nBody.',
    );
    await put(
      root,
      'content/product/orphan/index.md',
      '---\ntitle: Orphan\ncategory: no-such-family\n---\n\nBody.',
    );

    const result = await buildStatic(
      {
        root,
        themeDir: 'src/themes/atelier',
        outDir: out,
        origin: 'https://example.com',
        now: new Date('2026-06-01T00:00:00Z'),
      },
      makeReporter(false, true),
    );
    warnings = result.warnings;
  });

  it('writes a page per item at its public path', async () => {
    expect(await read('families/alloys/index.html')).toContain('Alloys');
    expect(await read('products/bar/index.html')).toContain('A bar');
    expect(await read('news/note/index.html')).toContain('A note');
  });

  it('uses the translated slug recorded in mallok.json', async () => {
    // The translation's own front matter has no slug, and an export never
    // rewrites source text — so the identity file is the only place it is.
    const zh = await read('zh/families/hejin/index.html');
    expect(zh).toContain('合金');
  });

  it('leaves out drafts and anything not yet due', async () => {
    await expect(read('news/draft/index.html')).rejects.toThrow();
    await expect(read('news/later/index.html')).rejects.toThrow();
  });

  it('resolves references both ways, with no database', async () => {
    // The product names its family…
    expect(await read('products/bar/index.html')).toContain('Alloys');
    // …and the family lists the product.
    expect(await read('families/alloys/index.html')).toContain('/products/bar');
  });

  it('builds tag archives across kinds', async () => {
    const metal = await read('tags/metal/index.html');
    expect(metal).toContain('A bar');
    expect(metal).toContain('A note');
    const stock = await read('tags/stock/index.html');
    expect(stock).toContain('A bar');
    expect(stock).not.toContain('A note');
  });

  it('builds a list page per kind and a home page per language', async () => {
    expect(await read('news/index.html')).toContain('A note');
    expect(await read('products/index.html')).toContain('A bar');
    expect(await read('index.html')).toContain('File Site');
    expect(await read('zh/index.html')).toContain('File Site');
  });

  it('writes the SEO endpoints', async () => {
    const sitemap = await read('sitemap.xml');
    expect(sitemap).toContain('https://example.com/products/bar');
    // hreflang for the pair that has two languages.
    expect(sitemap).toContain('hreflang="zh"');
    expect(sitemap).toContain('hreflang="x-default"');
    expect(await read('feed.xml')).toContain('A note');
    expect(await read('zh/feed.xml')).toContain('<language>zh</language>');
    expect(await read('robots.txt')).toContain('Sitemap: https://example.com');
  });

  it('reports a reference that names nothing, rather than dropping it', async () => {
    // A served site has the editor's content picker; a build has nothing,
    // so a typo has to be reported.
    expect(warnings.join('\n')).toContain('no-such-family');
    expect(warnings.join('\n')).toContain("target's slug");
  });

  it('says the inquiry form cannot work in a static build', async () => {
    // Shipping a form that silently fails would be worse than not shipping
    // one, so the marker is removed and the reason is reported.
    const root = await mkdtemp(join(tmpdir(), 'mallok-inq-'));
    const dir = await mkdtemp(join(tmpdir(), 'mallok-inq-out-'));
    await put(root, 'site.json', JSON.stringify(SITE));
    await put(
      root,
      'content/page/contact/index.md',
      '---\ntitle: Contact\n---\n\nGet in touch.\n\n[[inquiry]]\n',
    );
    const result = await buildStatic(
      {
        root,
        themeDir: 'src/themes/atelier',
        outDir: dir,
        origin: 'https://example.com',
        now: new Date('2026-06-01T00:00:00Z'),
      },
      makeReporter(false, true),
    );
    expect(result.warnings.join('\n')).toContain('needs a server');
    const page = await readFile(join(dir, 'contact', 'index.html'), 'utf8');
    expect(page).not.toContain('[[inquiry]]');
  });

  it('produces no client JavaScript', async () => {
    const page = await read('products/bar/index.html');
    for (const tag of page.match(/<script[^>]*>/g) ?? []) {
      expect(tag).toContain('application/ld+json');
    }
  });

  it('refuses a directory with no site.json rather than guessing', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mallok-empty-'));
    await expect(
      buildStatic(
        {
          root: empty,
          themeDir: 'src/themes/atelier',
          outDir: empty,
          origin: 'https://example.com',
          now: new Date(),
        },
        makeReporter(false, true),
      ),
    ).rejects.toThrow(/No site.json/);
  });
});
