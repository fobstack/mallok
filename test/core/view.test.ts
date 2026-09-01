import { describe, expect, it } from 'vitest';
import {
  buildContentPageView,
  buildImageViews,
  buildRelationsView,
  faqPairs,
  parseThemeManifest,
  type SummaryInput,
  type ViewContext,
} from '../../src/core/index.js';

const manifest = parseThemeManifest({
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  home: 'layouts/home.liquid',
  kinds: { page: { layout: 'layouts/page.liquid' } },
  defaultLocale: 'en',
  locales: ['en'],
});

const ctx: ViewContext = {
  settings: {
    name: 'Site',
    tagline: '',
    defaultLocale: 'en',
    locales: ['en'],
    kinds: { page: { base: '' } },
    nav: {},
    themeOptions: {},
    mediaBaseUrl: '',
  },
  manifest,
  origin: 'https://example.com',
  locale: 'en',
  path: '/x',
  strings: {},
};

function content(kind: string, frontmatter: Record<string, unknown> = {}) {
  return {
    id: 'id-1',
    kind,
    locale: 'en',
    slug: 'x',
    path: '/x',
    title: 'X',
    description: 'A description.',
    publishedAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    frontmatter,
    cover: '',
  };
}

const fragment = {
  html: '<p>Body.</p>',
  meta: {
    excerpt: 'Body.',
    readingTimeMinutes: 1,
    headings: [],
    refs: [],
    missing: [],
  },
};

function jsonLdOf(kind: string, frontmatter: Record<string, unknown> = {}) {
  const head = String(
    buildContentPageView(ctx, content(kind, frontmatter), fragment, []).page
      .head,
  );
  const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(
    head,
  );
  return match === null
    ? null
    : (JSON.parse(match[1] ?? '') as Record<string, unknown>);
}

describe('faqPairs', () => {
  it('reads a list of question/answer objects', () => {
    expect(
      faqPairs([
        { question: ' Q1 ', answer: ' A1 ' },
        { q: 'Q2', a: 'A2' },
      ]),
    ).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ]);
  });

  it('reads the map shape the admin keyvalue control produces', () => {
    expect(faqPairs({ 'Q1?': 'A1', 'Q2?': 'A2' })).toEqual([
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ]);
  });

  it('drops entries that are not a pair of non-empty strings', () => {
    expect(
      faqPairs([
        { question: 'Q', answer: '' },
        { question: '', answer: 'A' },
        { question: 'Q', answer: 42 },
        'nonsense',
        null,
        { question: 'Kept', answer: 'Yes' },
      ]),
    ).toEqual([{ question: 'Kept', answer: 'Yes' }]);
    expect(faqPairs(undefined)).toEqual([]);
    expect(faqPairs('text')).toEqual([]);
  });
});

describe('structured data', () => {
  it('emits FAQPage for a faq page with questions', () => {
    const jsonLd = jsonLdOf('faq', {
      faq: [{ question: 'How long?', answer: 'Twenty days.' }],
    });
    expect(jsonLd?.['@type']).toBe('FAQPage');
    expect(jsonLd?.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'How long?',
        acceptedAnswer: { '@type': 'Answer', text: 'Twenty days.' },
      },
    ]);
  });

  it('emits nothing for a faq page with no questions', () => {
    // Structured data may only describe what the page shows
    // (docs/SEO_PERFORMANCE.md §5).
    expect(jsonLdOf('faq')).toBeNull();
    expect(jsonLdOf('faq', { faq: [] })).toBeNull();
  });

  it('still emits Article and Product, and nothing for a plain page', () => {
    expect(jsonLdOf('article')?.['@type']).toBe('Article');
    expect(jsonLdOf('product', { sku: 'A-1' })?.sku).toBe('A-1');
    expect(jsonLdOf('page')).toBeNull();
  });

  it('escapes < so content cannot close the script element', () => {
    const head = String(
      buildContentPageView(
        ctx,
        content('faq', {
          faq: [{ question: '</script><x>', answer: 'A' }],
        }),
        fragment,
        [],
      ).page.head,
    );
    expect(head).not.toContain('</script><x>');
    expect(head).toContain('\\u003c/script>');
  });
});

describe('relations', () => {
  const item: SummaryInput = {
    id: 'p1',
    kind: 'product',
    locale: 'en',
    slug: 'bar',
    path: '/products/bar',
    title: 'Bar',
    description: '',
    publishedAt: '2026-08-01T00:00:00Z',
    frontmatter: {},
    cover: '',
  };

  it('exposes every group, empty when there is nothing', () => {
    const view = buildRelationsView();
    expect(view.refs).toEqual({});
    expect(view.backrefs).toEqual({});
    expect(view.siblings).toEqual([]);
  });

  it('maps refs, backrefs and siblings into summary views', () => {
    const view = buildRelationsView({
      refs: { category: item },
      backrefs: { product: [item] },
      siblings: [item],
    });
    expect(view.refs.category?.path).toBe('/products/bar');
    expect(view.backrefs.product?.[0]?.title).toBe('Bar');
    expect(view.siblings[0]?.id).toBe('p1');
  });

  it('reaches the template through content', () => {
    const view = buildContentPageView(ctx, content('product'), fragment, [], {
      refs: { category: item },
    });
    expect(view.content?.refs.category?.title).toBe('Bar');
    expect(view.content?.siblings).toEqual([]);
  });
});

describe('buildImageViews', () => {
  const assets = {
    'images/a.jpg': {
      sha256: 'a'.repeat(64),
      kind: 'image' as const,
      ext: 'jpg',
      variants: [480, 960],
      width: 1600,
      height: 900,
      alt: 'A bar',
    },
    'images/plain.png': {
      sha256: 'b'.repeat(64),
      kind: 'image' as const,
      ext: 'png',
      variants: [],
    },
    'files/sheet.pdf': {
      sha256: 'c'.repeat(64),
      kind: 'file' as const,
      ext: 'pdf',
      variants: [],
    },
  };

  it('uses the largest variant and lists the whole srcset', () => {
    const images = buildImageViews(assets, 'https://media.example.com');
    const a = images['images/a.jpg'];
    expect(a?.url).toBe(
      `https://media.example.com/media/${'a'.repeat(64)}_960.webp`,
    );
    expect(a?.srcset).toContain('_480.webp 480w');
    expect(a?.srcset).toContain('_960.webp 960w');
    expect(a?.width).toBe(1600);
    expect(a?.height).toBe(900);
    expect(a?.alt).toBe('A bar');
  });

  it('falls back to the original when no variant exists', () => {
    const images = buildImageViews(assets, 'https://media.example.com');
    expect(images['images/plain.png']?.url).toBe(
      `https://media.example.com/media/${'b'.repeat(64)}.png`,
    );
    expect(images['images/plain.png']?.srcset).toBe('');
  });

  it('skips non-image assets', () => {
    expect(
      buildImageViews(assets, 'https://media.example.com')['files/sheet.pdf'],
    ).toBeUndefined();
  });
});
