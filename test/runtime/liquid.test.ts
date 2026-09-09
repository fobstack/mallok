import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  islandMarkup,
  LiquidRenderer,
  SafeHtml,
} from '../../src/runtime/liquid/index.js';

/**
 * A real shipped theme, not a fixture.
 *
 * `layouts/page.liquid` uses `{% layout %}`, `{% block %}` and
 * `{% render %}`, and an engine that looks templates up outside liquidjs
 * fails on all three with `ENOENT`. Testing against a theme that actually
 * ships is the only way to know the engine is usable — and now that the
 * runtime lives in this repository, that theme is a directory away rather
 * than a sibling checkout that might not exist.
 */
const THEME = join(import.meta.dirname, '..', '..', 'src', 'themes', 'atelier');

async function atelierTemplates(): Promise<Record<string, string>> {
  const files = [
    'layouts/base.liquid',
    'layouts/page.liquid',
    'partials/header.liquid',
    'partials/footer.liquid',
  ];
  const templates: Record<string, string> = {};
  for (const file of files) {
    templates[file] = await readFile(join(THEME, file), 'utf8');
  }
  return templates;
}

const view = {
  site: { name: 'Baoji Titanium', tagline: 'Mill to spec' },
  page: {
    locale: 'en',
    kind: 'page',
    title: 'About',
    description: '',
    canonical: 'https://example.com/about',
    head: new SafeHtml('<meta name="robots" content="index">'),
    nav: [],
  },
  content: { title: 'About us', html: new SafeHtml('<p>Since 1998.</p>') },
  theme: { asset_base: '/theme/atelier/2.3.0' },
  t: { skip: 'Skip to content' },
};

describe('the real Mallok theme', () => {
  it('renders a layout, its blocks and its partials', async () => {
    const renderer = new LiquidRenderer({
      templates: await atelierTemplates(),
    });
    const html = await renderer.render('layouts/page.liquid', view);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="en">');
    // The block content reached the layout.
    expect(html).toContain('About us');
    // The partials resolved.
    expect(html).toContain('<main id="main">');
    expect(html).toContain('Skip to content');
  });

  it('passes SafeHtml through and escapes everything else', async () => {
    const renderer = new LiquidRenderer({
      templates: await atelierTemplates(),
    });
    const html = await renderer.render('layouts/page.liquid', {
      ...view,
      content: {
        title: '<script>alert(1)</script>',
        html: new SafeHtml('<p>trusted</p>'),
      },
    });
    expect(html).toContain('<p>trusted</p>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('LiquidRenderer', () => {
  it('renders a named template with a view', async () => {
    const renderer = new LiquidRenderer({
      templates: { 'page.liquid': '<h1>{{ product.title }}</h1>' },
    });
    expect(
      await renderer.render('page.liquid', { product: { title: 'Gr5 bar' } }),
    ).toBe('<h1>Gr5 bar</h1>');
  });

  it('refuses to let ordinary data through the raw filter', async () => {
    const renderer = new LiquidRenderer({
      templates: { 'page.liquid': '<p>{{ text | raw }}</p>' },
    });
    // The built-in `raw` would emit this verbatim; the restricted one does not,
    // so a template cannot launder untrusted data by adding `| raw`.
    expect(
      await renderer.render('page.liquid', { text: '<img onerror=x>' }),
    ).toBe('<p>&lt;img onerror=x&gt;</p>');
    // SafeHtml the product made itself still passes.
    expect(
      await renderer.render('page.liquid', {
        text: new SafeHtml('<img src=a>'),
      }),
    ).toBe('<p><img src=a></p>');
  });

  it('rejects an unknown filter instead of silently dropping it', async () => {
    const renderer = new LiquidRenderer({
      templates: { 'page.liquid': '{{ text | no_such_filter }}' },
    });
    await expect(renderer.render('page.liquid', { text: 'x' })).rejects.toThrow(
      /no_such_filter/,
    );
  });

  it('reserves the raw filter so a product cannot widen it', () => {
    expect(
      () =>
        new LiquidRenderer({
          templates: {},
          filters: { raw: (value: unknown) => String(value) },
        }),
    ).toThrow(/reserved/);
  });

  it('names a template it does not have rather than rendering nothing', async () => {
    const renderer = new LiquidRenderer({ templates: {} });
    await expect(renderer.render('missing', {})).rejects.toThrow(
      /No template named "missing"/,
    );
  });

  it('renders dates deterministically, whatever the machine timezone', async () => {
    const renderer = new LiquidRenderer({
      templates: { 'page.liquid': '{{ at | date: "%Y-%m-%dT%H:%M" }}' },
    });
    expect(
      await renderer.render('page.liquid', { at: '2026-03-01T12:00:00Z' }),
    ).toBe('2026-03-01T12:00');
  });
});

describe('the island tag', () => {
  it('gives two islands of the same name their own props', async () => {
    // The bug this pins: props held in a sibling script found by id gave both
    // carts the same id, so the second one's props silently won for both.
    // Nesting the payload inside its own placeholder removes the id entirely.
    const renderer = new LiquidRenderer({
      templates: {
        'page.liquid': '{% island "cart", sku: a %}{% island "cart", sku: b %}',
      },
    });
    const html = await renderer.render('page.liquid', { a: 'A', b: 'B' });

    const placeholders = [
      ...html.matchAll(
        /<div data-island="cart"[^>]*><script type="application\/json" data-island-props>([^<]*)<\/script><\/div>/g,
      ),
    ].map((match) => JSON.parse(match[1] ?? '{}') as { sku: string });

    expect(placeholders.map((props) => props.sku)).toEqual(['A', 'B']);
    // No page-wide identifier is minted at all, so nothing can collide.
    expect(html).not.toContain('id="island-');
  });

  it('refuses an island name that is not a safe slug', () => {
    expect(() => islandMarkup('cart"><script>', {})).toThrow(/lowercase slug/);
    expect(() => islandMarkup('Cart', {})).toThrow(/lowercase slug/);
    expect(islandMarkup('add-to-cart', {})).toContain(
      'data-island="add-to-cart"',
    );
  });

  it('keeps island props out of reach of an HTML parser', () => {
    const html = islandMarkup('cart', { note: '</script><img onerror=x>' });
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c/script\\u003e');
  });
});

describe('island rendering is deterministic', () => {
  const options = {
    templates: {
      'page.liquid': '{% island "cart", sku: a %}{% island "cart", sku: b %}',
    },
  };
  const view = { a: 'SKU-A', b: 'SKU-B' };
  const page = 'page.liquid';

  it('renders the same bytes when called again on one renderer', async () => {
    // The bug this pins: an ordinal counter living on the renderer instance
    // meant the second render of an identical page produced different ids —
    // so a cached page and a freshly rendered one disagreed byte for byte,
    // and nothing downstream could compare or deduplicate them.
    const renderer = new LiquidRenderer(options);
    const first = await renderer.render(page, view);
    const second = await renderer.render(page, view);
    expect(second).toBe(first);
  });

  it('renders the same bytes from a separate renderer', async () => {
    const one = await new LiquidRenderer(options).render(page, view);
    const two = await new LiquidRenderer(options).render(page, view);
    expect(two).toBe(one);
  });

  it('renders the same bytes under concurrency', async () => {
    // One renderer is shared across requests in a Worker isolate, so
    // overlapping renders must not be able to observe each other's state.
    const renderer = new LiquidRenderer(options);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => renderer.render(page, view)),
    );
    expect(new Set(results).size).toBe(1);
  });

  it('keeps two same-named islands reading their own props', async () => {
    const html = await new LiquidRenderer(options).render(page, view);
    const payloads = [
      ...html.matchAll(
        /<script type="application\/json"[^>]*>([^<]*)<\/script>/g,
      ),
    ].map((match) => JSON.parse(match[1] ?? '{}') as { sku: string });
    expect(payloads.map((props) => props.sku)).toEqual(['SKU-A', 'SKU-B']);
  });
});

describe('the island tag’s strategy parameter', () => {
  it('is a tag parameter, not a component prop', async () => {
    const renderer = new LiquidRenderer({
      templates: {
        'page.liquid': [
          '{% island "cart", strategy: "eager", sku: a %}',
          '{% island "gallery", strategy: "visible" %}',
          '{% island "chat", sku: b %}',
        ].join(''),
      },
    });
    const html = await renderer.render('page.liquid', {
      a: 'SKU-A',
      b: 'SKU-B',
    });

    expect(html).toContain('data-island="cart"');
    expect(html).toContain('data-island-strategy="eager"');
    expect(html).toContain('data-island-strategy="visible"');

    // The component must never see `strategy` among its props: it is a
    // scheduling instruction for the client, not data the island renders.
    const payloads = [
      ...html.matchAll(
        /<script type="application\/json"[^>]*>([^<]*)<\/script>/g,
      ),
    ].map((match) => JSON.parse(match[1] ?? '{}') as Record<string, unknown>);
    expect(payloads[0]).toEqual({ sku: 'SKU-A' });
    expect(payloads[1]).toEqual({});
    expect(payloads[2]).toEqual({ sku: 'SKU-B' });

    // An island that declared nothing leaves the choice to the client.
    expect(html).not.toMatch(/data-island="chat"[^>]*data-island-strategy/);
  });

  it('rejects a strategy the client does not implement', async () => {
    const renderer = new LiquidRenderer({
      templates: { 'page.liquid': '{% island "cart", strategy: "later" %}' },
    });
    await expect(renderer.render('page.liquid', {})).rejects.toThrow(
      /strategy/i,
    );
  });
});
