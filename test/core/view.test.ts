import { describe, expect, it } from 'vitest';
import {
  buildContentPageView,
  buildImageViews,
  buildRelationsView,
  buildSiteView,
  faqPairs,
  homeKinds,
  joinTagline,
  parseThemeManifest,
  type SummaryInput,
  splitTagline,
  taglineFor,
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
    expect(view.refs.category).toMatchObject({ path: '/products/bar' });
    expect(view.backrefs.product?.[0]?.title).toBe('Bar');
    expect(view.siblings[0]?.id).toBe('p1');
  });

  it('reaches the template through content', () => {
    const view = buildContentPageView(ctx, content('product'), fragment, [], {
      refs: { category: item },
    });
    expect(view.content?.refs.category).toMatchObject({ title: 'Bar' });
    expect(view.content?.siblings).toEqual([]);
  });

  it('maps a list of references to a list of summary views, in order', () => {
    const second = {
      ...item,
      id: 'p2',
      title: 'Plate',
      path: '/products/plate',
    };
    const view = buildRelationsView({
      refs: { category: item, collections: [second, item], none: [] },
    });
    expect(view.refs.collections).toMatchObject([
      { title: 'Plate', path: '/products/plate' },
      { title: 'Bar', path: '/products/bar' },
    ]);
    expect(view.refs.none).toEqual([]);
    // The single reference beside it is still one summary, not a list of one.
    expect(Array.isArray(view.refs.category)).toBe(false);
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

describe('homeKinds', () => {
  const theme = {
    page: {},
    article: { listLayout: 'layouts/list.liquid' },
    product: { listLayout: 'layouts/list.liquid' },
    faq: { listLayout: 'layouts/list.liquid' },
  };

  it('lists the enabled kinds the theme gives a list layout, in site order', () => {
    expect(
      homeKinds(
        { page: { base: '' }, product: { base: 'p' }, article: { base: 'n' } },
        theme,
      ),
    ).toEqual(['product', 'article']);
  });

  it('leaves out a kind the theme does not know and one the site has not enabled', () => {
    expect(
      homeKinds({ article: { base: 'n' }, widget: { base: 'w' } }, theme),
    ).toEqual(['article']);
  });

  it('is not fooled by a kind named like an Object member', () => {
    expect(homeKinds({ constructor: { base: 'c' } }, theme)).toEqual([]);
  });
});

describe('a tagline per language', () => {
  it("resolves to the language's own, else the default language's", () => {
    const settings = { tagline: 'Parts', taglines: { de: 'Teile', fr: '  ' } };
    expect(taglineFor(settings, 'de')).toBe('Teile');
    expect(taglineFor(settings, 'en')).toBe('Parts');
    // Blank is not a tagline, however it came to be stored.
    expect(taglineFor(settings, 'fr')).toBe('Parts');
    expect(taglineFor({ tagline: 'Parts' }, 'de')).toBe('Parts');
  });

  it("gives templates the page's language's tagline as site.tagline", () => {
    const settings = {
      ...ctx.settings,
      tagline: 'Parts',
      taglines: { de: 'Teile' },
    };
    expect(buildSiteView({ ...ctx, settings, locale: 'de' }).tagline).toBe(
      'Teile',
    );
    expect(buildSiteView({ ...ctx, settings, locale: 'en' }).tagline).toBe(
      'Parts',
    );
  });

  it('splits what a site declares into what is stored, and back', () => {
    expect(splitTagline('One line', 'en')).toEqual({
      tagline: 'One line',
      taglines: {},
    });
    const stored = splitTagline(
      { de: 'Teile', en: 'Parts', fr: ' ', zh: 7 },
      'en',
    );
    expect(stored).toEqual({ tagline: 'Parts', taglines: { de: 'Teile' } });
    // Default language first, whatever order it was written in.
    expect(Object.keys(joinTagline(stored, 'en'))).toEqual(['en', 'de']);
    expect(joinTagline(splitTagline('One line', 'en'), 'en')).toBe('One line');
    for (const nothing of [null, undefined, 3, ['a']]) {
      expect(splitTagline(nothing, 'en')).toEqual({
        tagline: '',
        taglines: {},
      });
    }
    // A map with no default-language entry: the others keep theirs.
    expect(splitTagline({ de: 'Teile' }, 'en')).toEqual({
      tagline: '',
      taglines: { de: 'Teile' },
    });
  });
});

describe('site.kinds, links to list pages', () => {
  const listing = parseThemeManifest({
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    home: 'layouts/home.liquid',
    kinds: {
      page: { layout: 'layouts/page.liquid' },
      product: {
        layout: 'layouts/page.liquid',
        listLayout: 'layouts/list.liquid',
        label: 'Products',
      },
      case: {
        layout: 'layouts/page.liquid',
        listLayout: 'layouts/list.liquid',
      },
      // An address of its own and no list page.
      tool: { layout: 'layouts/page.liquid' },
      // A list layout, and the site gives the kind no base.
      article: {
        layout: 'layouts/page.liquid',
        listLayout: 'layouts/list.liquid',
      },
      // A list layout the site has not enabled at all.
      faq: { layout: 'layouts/page.liquid', listLayout: 'layouts/list.liquid' },
    },
    defaultLocale: 'en',
    locales: ['en'],
  });
  const settings = {
    ...ctx.settings,
    locales: ['en', 'de'],
    kinds: {
      page: { base: '' },
      product: { base: 'products' },
      case: { base: 'work' },
      tool: { base: 'tools' },
      article: { base: '' },
    },
  };

  it('holds exactly the kinds whose list page exists, at their base', () => {
    const site = buildSiteView({ ...ctx, settings, manifest: listing });
    expect(site.kinds).toEqual({
      product: { path: '/products', label: 'Products' },
      // No pack entry and no manifest label: the kind's own name.
      case: { path: '/work', label: 'case' },
    });
  });

  it("is in the page's language: the prefix, and the pack's name for the kind", () => {
    const site = buildSiteView({
      ...ctx,
      settings,
      manifest: listing,
      locale: 'de',
      strings: { product: 'Produkte', case: 'Referenzen' },
    });
    expect(site.kinds).toEqual({
      product: { path: '/de/products', label: 'Produkte' },
      case: { path: '/de/work', label: 'Referenzen' },
    });
  });

  it('follows a change of base', () => {
    const site = buildSiteView({
      ...ctx,
      manifest: listing,
      settings: { ...settings, kinds: { product: { base: 'catalogue' } } },
    });
    expect(site.kinds).toEqual({
      product: { path: '/catalogue', label: 'Products' },
    });
  });
});
