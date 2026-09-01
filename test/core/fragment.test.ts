import { describe, expect, it } from 'vitest';
import {
  type AssetMap,
  computeFragmentCacheKey,
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
    expect(first.meta.headings).toEqual([{ depth: 1, text: 'Title' }]);
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
