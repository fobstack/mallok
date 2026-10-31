import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESERVED_IDS, RESERVED_NUMBERED_ID } from '../../src/core/fragment.js';
import {
  type AssetMap,
  computeFragmentCacheKey,
  PIPELINE_VERSION,
  renderFragment,
} from '../../src/core/index.js';

const assets: AssetMap = {
  'images/hero.jpg': {
    sha256: 'abc123',
    kind: 'image',
    ext: 'jpg',
    width: 1600,
    height: 900,
    variants: [480, 960, 1440],
    alt: 'Fallback alt',
  },
  'files/datasheet.pdf': {
    sha256: 'def456',
    kind: 'file',
    ext: 'pdf',
    variants: [],
  },
};

function render(
  body: string,
  extra: Partial<Parameters<typeof renderFragment>[0]> = {},
) {
  return renderFragment({
    body,
    frontmatter: {},
    assets,
    mediaBaseUrl: 'https://media.example.com',
    ...extra,
  });
}

describe('renderFragment', () => {
  it('renders GFM Markdown deterministically', async () => {
    const body =
      '# Title\n\nHello **world**.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    const first = await render(body);
    const second = await render(body);
    expect(first.html).toBe(second.html);
    expect(first.cacheKey).toBe(second.cacheKey);
    expect(first.html).toContain('<table>');
    expect(first.meta.headings).toEqual([
      { depth: 1, text: 'Title', id: 'title' },
    ]);
    expect(first.html).toContain('<h1 id="title">Title</h1>');
    expect(first.meta.excerpt).toBe('Hello world.');
  });

  it('strips scripts, event handlers and javascript: links', async () => {
    const body = [
      '<script>alert(1)</script>',
      '',
      '<img src="x" onerror="alert(1)">',
      '',
      '[click](javascript:alert(1))',
      '',
      '<a href="https://ok.example" onclick="x()">ok</a>',
    ].join('\n');
    const { html } = await render(body);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
  });

  it('keeps benign inline HTML instead of dropping it (docs/SECURITY.md §4)', async () => {
    const body = [
      '<div>',
      '',
      'A **note** worth calling out.',
      '',
      '</div>',
      '',
      'Plain text with an inline <span>wrapper</span> and a <br> break.',
    ].join('\n');
    const { html } = await render(body);
    expect(html).toContain('<div>');
    expect(html).toContain('<span>wrapper</span>');
    expect(html).toContain('<br>');
    // The Markdown inside the raw block still renders, not just passes through.
    expect(html).toContain('<strong>note</strong>');
  });

  it('rewrites relative images to media URLs with srcset', async () => {
    const { html, meta } = await render('![Furnace](images/hero.jpg)');
    expect(html).toContain(
      'src="https://media.example.com/media/abc123_1440.webp"',
    );
    expect(html).toContain(
      'srcset="https://media.example.com/media/abc123_480.webp 480w',
    );
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    // The first image is the likely LCP element, so it loads eagerly
    // (docs/SEO_PERFORMANCE.md §9).
    expect(html).toContain('loading="eager"');
    expect(html).toContain('alt="Furnace"');
    expect(meta.refs).toEqual(['images/hero.jpg']);
    expect(meta.missing).toEqual([]);
  });

  it('loads only the first image eagerly', async () => {
    const { html } = await render(
      ['![One](images/hero.jpg)', '', '![Two](images/hero.jpg)'].join('\n'),
    );
    expect(html.match(/loading="eager"/g)).toHaveLength(1);
    expect(html.match(/loading="lazy"/g)).toHaveLength(1);
    expect(html.indexOf('loading="eager"')).toBeLessThan(
      html.indexOf('loading="lazy"'),
    );
  });

  it('uses the asset alt text only when the author gave none', async () => {
    const { html } = await render('![](./images/hero.jpg)');
    expect(html).toContain('alt="Fallback alt"');
  });

  it('rewrites relative file links to the original object', async () => {
    const { html } = await render('[Datasheet](files/datasheet.pdf)');
    expect(html).toContain('href="https://media.example.com/media/def456.pdf"');
  });

  it('leaves missing assets untouched and reports them', async () => {
    const { html, meta } = await render('![x](images/missing.png)');
    expect(html).toContain('src="images/missing.png"');
    expect(meta.missing).toEqual(['images/missing.png']);
  });

  it('ignores traversal and absolute references', async () => {
    const { html, meta } = await render(
      '![a](../images/hero.jpg) ![b](/images/hero.jpg) ![c](https://x.example/i.png)',
    );
    expect(meta.refs).toEqual([]);
    expect(html).toContain('src="https://x.example/i.png"');
  });

  it('emits site-relative URLs when no media host is configured', async () => {
    const { html } = await render('![a](images/hero.jpg)', {
      mediaBaseUrl: '',
    });
    expect(html).toContain('src="/media/abc123_1440.webp"');
  });

  it('estimates reading time for latin and CJK text', async () => {
    const latin = `${'word '.repeat(450)}`;
    const cjk = '钛'.repeat(900);
    expect((await render(latin)).meta.readingTimeMinutes).toBe(3);
    expect((await render(cjk)).meta.readingTimeMinutes).toBe(3);
  });

  it('runs beforeRender hooks that can mutate the tree', async () => {
    const { html } = await render('Hello', {
      hooks: [
        (tree) => {
          tree.children.push({
            type: 'paragraph',
            children: [{ type: 'text', value: 'Injected' }],
          });
        },
      ],
    });
    expect(html).toContain('<p>Injected</p>');
  });

  it('changes the cache key when any input changes', async () => {
    const base = { body: 'x', frontmatter: {}, assets, mediaBaseUrl: '' };
    const keys = await Promise.all([
      computeFragmentCacheKey(base),
      computeFragmentCacheKey({ ...base, body: 'y' }),
      computeFragmentCacheKey({ ...base, mediaBaseUrl: 'https://m' }),
      computeFragmentCacheKey({ ...base, pluginHash: 'p1' }),
      computeFragmentCacheKey({ ...base, frontmatter: { a: 1 } }),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('heading ids (Task 48)', () => {
  it('gives every heading an id a table of contents can link to', async () => {
    const { html, meta } = await render(
      '## Quick start\n\n### Install the SDK\n\nText.\n',
    );
    expect(meta.headings).toEqual([
      { depth: 2, text: 'Quick start', id: 'quick-start' },
      { depth: 3, text: 'Install the SDK', id: 'install-the-sdk' },
    ]);
    expect(html).toContain('<h2 id="quick-start">Quick start</h2>');
    expect(html).toContain('<h3 id="install-the-sdk">Install the SDK</h3>');
  });

  it('numbers repeated headings in document order', async () => {
    const { html, meta } = await render(
      '## Example\n\n## Example\n\n## Example\n\n## Example 1\n',
    );
    expect(meta.headings.map((h) => h.id)).toEqual([
      'example',
      'example-1',
      'example-2',
      // Its own slug was taken by the second "Example".
      'example-1-1',
    ]);
    expect(new Set(meta.headings.map((h) => h.id)).size).toBe(4);
    expect(html.match(/ id="/g)).toHaveLength(4);
  });

  it('keeps CJK headings in their own script, without transliteration', async () => {
    const { meta } = await render(
      '## 快速开始\n\n## 認證方式（API Key）\n\n## 快速开始\n\n## 시작하기\n',
    );
    expect(meta.headings.map((h) => h.id)).toEqual([
      '快速开始',
      '認證方式api-key',
      '快速开始-1',
      '시작하기',
    ]);
  });

  it('drops punctuation and falls back to the position when nothing is left', async () => {
    const { meta } = await render(
      "## What's new in v2.1?\n\n## `GET /stock/quote`\n\n## ???\n\n## 🚀\n\n## --a__b  c--\n",
    );
    expect(meta.headings.map((h) => h.id)).toEqual([
      'whats-new-in-v21',
      'get-stockquote',
      'heading-3',
      'heading-4',
      'a-b-c',
    ]);
  });

  it("keeps an author's own id and never repeats it", async () => {
    const { html, meta } = await render(
      '<h2 id="intro">Intro</h2>\n\n## user-content-intro\n\n## Intro\n',
    );
    expect(meta.headings).toEqual([
      // The sanitizer's prefix stays on an author's id (docs/SECURITY.md §4).
      { depth: 2, text: 'Intro', id: 'user-content-intro' },
      { depth: 2, text: 'user-content-intro', id: 'user-content-intro-1' },
      { depth: 2, text: 'Intro', id: 'intro' },
    ]);
    expect(html.match(/id="user-content-intro"/g)).toHaveLength(1);
  });

  it('never takes an id the theme or a plugin puts on the page', async () => {
    // Unprefixed, a heading called "Main" would be a second `id="main"`, and
    // the skip link would land on it instead of the page's content.
    const { meta } = await render(
      '## Main\n\n## Products\n\n## Turnstile\n\n## Shot 1\n\n## Hero slide 2\n\n## Shot\n',
    );
    expect(meta.headings.map((h) => h.id)).toEqual([
      'main-1',
      'products-1',
      'turnstile-1',
      'shot-1-1',
      'hero-slide-2-1',
      'shot',
    ]);
  });

  it('reserves every fixed id the official themes and plugins write', async () => {
    const found = new Set<string>();
    for (const root of ['src/themes', 'src/plugins']) {
      for (const file of await readdir(root, { recursive: true })) {
        if (!/\.(liquid|ts)$/.test(file)) continue;
        const text = await readFile(join(root, file), 'utf8');
        for (const match of text.matchAll(/\bid=\\?"([^"\\]+)\\?"/g)) {
          found.add(match[1] ?? '');
        }
      }
    }
    expect(found.size).toBeGreaterThan(0);
    for (const id of found) {
      // A templated id is numbered by its loop: check the number it gets.
      const sample = id.replace(/\{\{[^}]*\}\}/g, '1');
      expect(
        RESERVED_IDS.has(sample) || RESERVED_NUMBERED_ID.test(sample),
        id,
      ).toBe(true);
    }
  });

  it("numbers an author's id that an earlier element already has", async () => {
    const { html, meta } = await render(
      '<a id="setup"></a>\n\n<h2 id="setup">Setup</h2>\n\n<h2 id="faq">FAQ</h2>\n\n<h2 id="faq">More FAQ</h2>\n',
    );
    expect(meta.headings.map((h) => h.id)).toEqual([
      'user-content-setup-1',
      'user-content-faq',
      'user-content-faq-1',
    ]);
    expect(html.match(/id="user-content-faq"/g)).toHaveLength(1);
  });

  it('does not list the footnotes label as a section', async () => {
    const { meta, html } = await render(
      '## Body\n\nA claim.[^1]\n\n[^1]: The source.\n',
    );
    expect(meta.headings.map((h) => h.text)).toEqual(['Body']);
    expect(html).toContain('data-footnotes');
  });

  it('cuts a very long heading and stays deterministic', async () => {
    const long = `## ${'word '.repeat(60)}\n`;
    const first = await render(long);
    const second = await render(long);
    const id = first.meta.headings[0]?.id ?? '';
    expect(Array.from(id).length).toBeLessThanOrEqual(80);
    expect(id.endsWith('-')).toBe(false);
    expect(first.html).toBe(second.html);
  });

  it('is part of a new pipeline version, so stored fragments re-render', () => {
    expect(PIPELINE_VERSION).toBe('2');
  });
});
