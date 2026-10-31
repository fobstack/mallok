import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStatic } from '../../src/cli/build.js';
import { makeReporter } from '../../src/cli/output.js';

/**
 * `mallok build` and the default locale's prefix (Task 49, itick M2).
 *
 * With the setting off, a static build must write the same files with the
 * same URLs in them as it did before the setting existed:
 * `test/fixtures/build-locale-prefix-off.json` was recorded from this test on
 * the code before Task 49 (commit c6c6894). Run with
 * `MALLOK_RECORD_GOLDEN=1` to record it again, for an intended change only.
 * It was, once, for Atelier 2.5.2: its version in asset URLs, and a Chinese
 * article's tag link, now `/zh/tags/metal` instead of the English archive.
 */

const GOLDEN = 'test/fixtures/build-locale-prefix-off.json';
const ORIGIN = 'https://example.com';

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

async function put(root: string, path: string, text: string): Promise<void> {
  const full = join(root, ...path.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, text, 'utf8');
}

/** Builds the fixture site with the given extra `site.json` fields. */
async function build(extra: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mallok-prefix-'));
  const out = await mkdtemp(join(tmpdir(), 'mallok-prefix-out-'));
  await put(root, 'site.json', JSON.stringify({ ...SITE, ...extra }));
  await put(
    root,
    'content/page/about/index.md',
    '---\ntitle: About\n---\n\nUs.',
  );
  await put(
    root,
    'content/page/about/index.zh.md',
    '---\ntitle: 关于\n---\n\n我们。',
  );
  await put(
    root,
    'content/category/alloys/index.md',
    '---\ntitle: Alloys\n---\n\nBody.',
  );
  await put(
    root,
    'content/product/bar/index.md',
    '---\ntitle: A bar\ncategory: alloys\ntags: [metal]\n---\n\nBody.',
  );
  await put(
    root,
    'content/article/note/index.md',
    '---\ntitle: A note\ndate: 2026-01-01T00:00:00Z\ntags: [metal]\n---\n\n## Section\n\nBody.',
  );
  await put(
    root,
    'content/article/note/index.zh.md',
    '---\ntitle: 笔记\ndate: 2026-01-01T00:00:00Z\ntags: [metal]\n---\n\n正文。',
  );
  await buildStatic(
    {
      root,
      themeDir: 'src/themes/atelier',
      outDir: out,
      origin: ORIGIN,
      now: new Date('2026-06-01T00:00:00Z'),
    },
    makeReporter(false, true),
  );
  return out;
}

/** Every file a build wrote, without theme assets, sorted. */
async function filesIn(out: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        found.push(relative(out, full).split(sep).join('/'));
      }
    }
  };
  await walk(out);
  return found.filter((file) => !file.startsWith('theme/')).sort();
}

/** Every URL in a file, in document order, relative to the origin. */
function urlsIn(body: string): string[] {
  const pattern =
    /(?:\b(?:href|src|action|content)="([^"]*)")|(?:<loc>([^<]*)<\/loc>)|(?:<link>([^<]*)<\/link>)|(?:<guid[^>]*>([^<]*)<\/guid>)|(?:^(?:Sitemap|Allow|Disallow): (\S+)$)|(?:^(\/\S*\s+\/\S*\s+\d{3})$)/gm;
  return [...body.matchAll(pattern)]
    .map((match) => match.slice(1).find((part) => part !== undefined) ?? '')
    .filter((url) => url.startsWith('/') || url.startsWith(ORIGIN))
    .map((url) => url.replaceAll(ORIGIN, ''));
}

async function snapshot(out: string): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const file of await filesIn(out)) {
    if (!/\.(html|xml|txt)$|(^|\/)_redirects$/.test(file)) {
      result[file] = [];
      continue;
    }
    const body = await readFile(join(out, ...file.split('/')), 'utf8');
    const urls = urlsIn(body);
    result[file] = file === 'sitemap.xml' ? urls.sort() : urls;
  }
  return result;
}

describe('mallok build with prefixDefaultLocale off', () => {
  it('writes the files and URLs recorded before the setting existed', async () => {
    const actual = await snapshot(await build({}));
    if (process.env.MALLOK_RECORD_GOLDEN === '1') {
      await writeFile(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(actual).toEqual(JSON.parse(await readFile(GOLDEN, 'utf8')));
  });
});

describe('mallok build with prefixDefaultLocale on', () => {
  it('writes every locale under its prefix, and only redirects at the root', async () => {
    const out = await build({ prefixDefaultLocale: true });
    const files = await snapshot(out);
    const pages = Object.keys(files).filter((file) => file.endsWith('.html'));
    // Nothing of the default locale outside `/en/`, apart from the redirect.
    expect(pages.filter((file) => !/^(en|zh)\//.test(file)).sort()).toEqual([
      'index.html',
    ]);
    expect(pages).toEqual(
      expect.arrayContaining([
        'en/index.html',
        'en/about/index.html',
        'en/news/index.html',
        'en/news/note/index.html',
        'en/products/bar/index.html',
        'en/families/alloys/index.html',
        'en/tags/metal/index.html',
        'zh/index.html',
        'zh/about/index.html',
        'zh/news/note/index.html',
      ]),
    );

    expect(await readFile(join(out, '_redirects'), 'utf8')).toBe(
      '/ /en 301\n/feed.xml /en/feed.xml 301\n',
    );
    const root = await readFile(join(out, 'index.html'), 'utf8');
    expect(root).toContain('<meta name="robots" content="noindex">');
    expect(root).toContain(`url=${ORIGIN}/en"`);
    expect(root).toContain(`<link rel="canonical" href="${ORIGIN}/en">`);

    const about = await readFile(join(out, 'en/about/index.html'), 'utf8');
    expect(about).toContain(`<link rel="canonical" href="${ORIGIN}/en/about">`);
    expect(about).toContain(
      `<link rel="alternate" hreflang="zh" href="${ORIGIN}/zh/about">`,
    );
    expect(about).toContain(
      `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/en/about">`,
    );

    expect(files['sitemap.xml']?.every((url) => /^\/(en|zh)\//.test(url))).toBe(
      true,
    );
    expect(existsSync(join(out, 'feed.xml'))).toBe(false);
    const feed = await readFile(join(out, 'en/feed.xml'), 'utf8');
    expect(feed).toContain(`<link>${ORIGIN}/en</link>`);
    expect(feed).toContain(`href="${ORIGIN}/en/feed.xml"`);
  });
});
