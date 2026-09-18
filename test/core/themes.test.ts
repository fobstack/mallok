import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildContentPageView,
  buildHomePageView,
  buildListPageView,
  compileTheme,
  parseThemeManifest,
  renderFragment,
  renderPage,
  type SummaryInput,
  type ThemeManifest,
  themeLanguageNames,
  themeStrings,
  type ViewContext,
} from '../../src/core/index.js';

const THEMES_DIR = 'src/themes';
const ORIGIN = 'https://demo.example';

/**
 * Reads a theme off disk the way the preview does. Templates cannot be
 * imported here because they are Wrangler text modules, and reading them is
 * closer to what the build validates anyway.
 */
async function loadTheme(dir: string) {
  const root = join(THEMES_DIR, dir);
  const manifest = parseThemeManifest(
    JSON.parse(await readFile(join(root, 'theme.json'), 'utf8')),
  );
  const files: Record<string, string> = {};
  for (const sub of ['layouts', 'partials', 'locales']) {
    let entries: string[] = [];
    try {
      entries = await readdir(join(root, sub));
    } catch {
      continue;
    }
    for (const name of entries) {
      files[`${sub}/${name}`] = await readFile(join(root, sub, name), 'utf8');
    }
  }
  return { manifest, files };
}

function contextFor(
  manifest: ThemeManifest,
  files: Record<string, string>,
  path: string,
): ViewContext {
  return {
    settings: {
      name: 'Demo Works',
      tagline: 'A tagline',
      defaultLocale: 'en',
      locales: ['en', 'zh'],
      kinds: Object.fromEntries(
        Object.entries(manifest.kinds).map(([kind, config]) => [
          kind,
          { base: config.base ?? kind },
        ]),
      ),
      nav: { en: [{ label: 'Products', href: '/products' }] },
      themeOptions: {},
      mediaBaseUrl: 'https://media.example',
    },
    manifest,
    origin: ORIGIN,
    locale: 'en',
    path,
    strings: themeStrings(manifest, files, 'en'),
    languageNames: themeLanguageNames(manifest, files),
  };
}

function summary(kind: string, index = 1): SummaryInput {
  return {
    id: `${kind}-${index}`,
    kind,
    locale: 'en',
    slug: `${kind}-${index}`,
    path: `/${kind}s/${kind}-${index}`,
    title: `Demo ${kind} ${index}`,
    description: 'A short description.',
    publishedAt: '2026-08-01T00:00:00Z',
    frontmatter: { grade: 'Ti-6Al-4V', industry: 'Aerospace', form: 'Bar' },
    cover: '',
    images: {},
    files: {},
  };
}

const BODY = `An opening paragraph that gives the page something to show.

## A heading

Another paragraph, plus a [link](https://example.com) and \`code\`.`;

const themeDirs = (await readdir(THEMES_DIR, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe.each(themeDirs)('theme %s', (dir) => {
  it('renders every layout it declares', async () => {
    const { manifest, files } = await loadTheme(dir);
    const compiled = compileTheme(manifest, files, 1);
    const fragment = await renderFragment({
      body: BODY,
      frontmatter: {},
      assets: {},
      mediaBaseUrl: '',
    });

    const recent = Object.fromEntries(
      Object.keys(manifest.kinds).map((kind) => [
        kind,
        [summary(kind, 1), summary(kind, 2), summary(kind, 3)],
      ]),
    );
    const home = await renderPage(
      compiled,
      manifest.home,
      buildHomePageView(contextFor(manifest, files, '/'), recent),
    );
    // The home page has a real alternate in every enabled locale, so this is
    // where hreflang must appear (docs/SEO_PERFORMANCE.md §4). Content pages
    // with a single translation correctly emit none.
    expect(home).toContain('hreflang="x-default"');
    const pages: string[] = [home];

    for (const [kind, config] of Object.entries(manifest.kinds)) {
      const item = summary(kind);
      const frontmatter: Record<string, unknown> = {
        ...item.frontmatter,
        // Enough front matter that the specialised layouts take their
        // populated branches rather than skipping every section.
        summary: 'A family summary.',
        applications: ['One', 'Two'],
        specs: { 'Density at 20 °C': '4.43 g/cm³' },
        outcomes: { 'On time': '6 of 6' },
        client: 'A client',
        faq: [{ question: 'How long?', answer: 'Twenty days.' }],
      };
      pages.push(
        await renderPage(
          compiled,
          config.layout,
          buildContentPageView(
            contextFor(manifest, files, item.path),
            { ...item, frontmatter, updatedAt: '2026-08-02T00:00:00Z' },
            { html: fragment.html, meta: fragment.meta },
            [{ locale: 'en', path: item.path }],
            {
              refs: { category: summary('category') },
              backrefs: { product: [summary('product')] },
              siblings: [summary(kind, 2)],
            },
          ),
        ),
      );
      if (config.listLayout !== undefined) {
        pages.push(
          await renderPage(
            compiled,
            config.listLayout,
            buildListPageView(contextFor(manifest, files, `/${kind}s`), {
              kind,
              items: [summary(kind, 1), summary(kind, 2)],
              hasNext: true,
              page: 1,
              basePath: `/${kind}s`,
              kindBase: kind,
            }),
          ),
        );
      }
    }

    for (const html of pages) {
      expect(html).toContain('<!doctype html>');
      // An unresolved tag or a missing string would show up literally.
      expect(html).not.toMatch(/\{\{|\{%/);
      expect(html).not.toContain('[object Object]');
      expect(html).not.toContain('undefined');
      // page.head is mandatory (docs/THEME_FORMAT.md §7.1).
      expect(html).toContain('<link rel="canonical"');
      // Only the homepage carousel may add an executable theme script.
      for (const tag of html.match(/<script[^>]*>/g) ?? []) {
        if (tag.includes('application/ld+json')) continue;
        expect(dir).toBe('atelier');
        expect(html).toBe(home);
        expect(tag).toContain('/hero-carousel.js');
        expect(tag).toContain('defer');
      }
    }
  });
});

describe('atelier trade layouts', () => {
  it('shows the relations and question list the trade kinds need', async () => {
    const { manifest, files } = await loadTheme('atelier');
    const compiled = compileTheme(manifest, files, 1);
    const fragment = await renderFragment({
      body: BODY,
      frontmatter: {},
      assets: {},
      mediaBaseUrl: '',
    });
    const render = (
      kind: string,
      frontmatter: Record<string, unknown>,
      relations: Parameters<typeof buildContentPageView>[4],
    ) =>
      renderPage(
        compiled,
        manifest.kinds[kind]?.layout ?? '',
        buildContentPageView(
          contextFor(manifest, files, `/${kind}`),
          {
            ...summary(kind),
            frontmatter,
            updatedAt: '2026-08-02T00:00:00Z',
          },
          { html: fragment.html, meta: fragment.meta },
          [{ locale: 'en', path: `/${kind}` }],
          relations,
        ),
      );

    const category = await render(
      'category',
      {
        summary: 'The family summary.',
        applications: ['Fasteners'],
      },
      { backrefs: { product: [summary('product')] } },
    );
    expect(category).toContain('The family summary.');
    expect(category).toContain('Fasteners');
    expect(category).toContain('/products/product-1');

    const product = await render(
      'product',
      { grade: 'Ti-6Al-4V', specs: { 'Density at 20 °C': '4.43 g/cm³' } },
      {
        refs: { category: summary('category') },
        siblings: [summary('product', 2)],
      },
    );
    // The breadcrumb and the "more in" heading both come from the reference.
    expect(product).toContain('Demo category 1');
    expect(product).toContain('4.43 g/cm³');
    expect(product).toContain('Density at 20 °C');
    expect(product).toContain('/products/product-2');

    const faq = await render(
      'faq',
      {
        faq: [{ question: 'How long is a lead time?', answer: 'Twenty days.' }],
      },
      {},
    );
    expect(faq).toContain('How long is a lead time?');
    expect(faq).toContain('Twenty days.');
    expect(faq).toContain('"@type":"FAQPage"');

    const study = await render(
      'case',
      { client: 'A client', outcomes: { 'On time': '6 of 6' } },
      { refs: { product: summary('product') } },
    );
    expect(study).toContain('A client');
    expect(study).toContain('6 of 6');
    expect(study).toContain('/products/product-1');
  });

  it('names each language in its own words, in a scriptless dropdown', async () => {
    const { manifest, files } = await loadTheme('atelier');
    const compiled = compileTheme(manifest, files, 1);
    const ctx = contextFor(manifest, files, '/');
    const page = await renderPage(
      compiled,
      manifest.home,
      buildHomePageView(ctx, {}),
    );
    // A <details> disclosure, not a <select> (which would need script to
    // navigate) and not a row of codes (which stops scaling past three).
    expect(page).toContain('<details class="langs">');
    // Each language is named as it names itself; a reader scans for that.
    expect(page).toContain('>English<');
    expect(page).toContain('>中文<');
    expect(page).toContain('hreflang="zh"');
    // The language picker needs no script; the homepage carousel is declared.
    for (const tag of page.match(/<script[^>]*>/g) ?? []) {
      if (tag.includes('application/ld+json')) continue;
      expect(tag).toContain('/hero-carousel.js');
      expect(tag).toContain('defer');
    }
  });

  it('hides the language switcher on a single-language site', async () => {
    const { manifest, files } = await loadTheme('atelier');
    const compiled = compileTheme(manifest, files, 1);
    const ctx = contextFor(manifest, files, '/');
    const single = {
      ...ctx,
      settings: { ...ctx.settings, locales: ['en'] },
    };
    const page = await renderPage(
      compiled,
      manifest.home,
      buildHomePageView(single, {}),
    );
    expect(page).not.toContain('<details class="langs">');
  });

  it('keeps one nav in the markup, usable at both widths', async () => {
    const { manifest, files } = await loadTheme('atelier');
    const compiled = compileTheme(manifest, files, 1);
    const home = await renderPage(
      compiled,
      manifest.home,
      buildHomePageView(contextFor(manifest, files, '/'), {}),
    );
    // A checkbox disclosure, not a duplicated desktop/mobile pair: the links
    // must appear exactly once so crawlers and screen readers see one menu.
    expect(home.match(/class="menu-nav"/g)).toHaveLength(1);
    const nav = /<nav class="menu-nav"[\s\S]*?<\/nav>/.exec(home)?.[0] ?? '';
    expect(nav.match(/href="\/products"/g)).toHaveLength(1);
    expect(home).toContain('type="checkbox"');
  });
});

it.each(['Plate', '板材'])(
  'Atelier shows a material photo when a %s gallery cannot resolve',
  async (form) => {
    const { manifest, files } = await loadTheme('atelier');
    const item = summary('product');
    const fragment = await renderFragment({
      body: BODY,
      frontmatter: {},
      assets: {},
      mediaBaseUrl: '',
    });
    const html = await renderPage(
      compileTheme(manifest, files, 1),
      'layouts/product.liquid',
      buildContentPageView(
        contextFor(manifest, files, item.path),
        {
          ...item,
          frontmatter: { ...item.frontmatter, form, gallery: ['missing.jpg'] },
          updatedAt: '2026-08-02T00:00:00Z',
        },
        { html: fragment.html, meta: fragment.meta },
        [{ locale: 'en', path: item.path }],
      ),
    );
    expect(html).toContain('/images/plates.jpg');
    expect(html).toContain('Illustrative material photograph');
    expect(html).not.toContain('class="gallery-strip"');
  },
);
