import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import { cacheKeyFor } from '../../src/worker/cache.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { resetThemeCacheForTests } from '../../src/worker/theme-cache.js';

/**
 * A template links to a kind's list page (docs/THEME_FORMAT.md §7.1):
 * `site.kinds.<kind>.path` and `.label`, through the real template engine.
 */

const ORIGIN = 'https://kind-links.example';
const EMAIL = 'links@example.com';
const PASSWORD = 'a sufficiently long password';

/** A breadcrumb as a theme would write it, and probes for two other kinds. */
const CRUMB =
  '<nav class="probe">{% assign own = site.kinds[content.kind] %}' +
  '{% if own %}<a class="crumb" href="{{ own.path }}">{{ own.label }}</a>{% endif %}' +
  '<a class="all-cases" href="{{ site.kinds.case.path }}">{{ site.kinds.case.label }}</a>' +
  '{% if site.kinds.page %}page-has-a-list{% endif %}</nav>';

describe('site.kinds in a template', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };
  let admin: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<Response>;

  const probe = async (path: string): Promise<string> => {
    await caches.default.delete(cacheKeyFor(new Request(`${ORIGIN}${path}`)));
    const html = await (await SELF.fetch(`${ORIGIN}${path}`)).text();
    return /<nav class="probe">(.*?)<\/nav>/.exec(html)?.[1] ?? 'no probe';
  };

  beforeAll(async () => {
    const files = original.theme.files;
    configure({
      plugins: original.plugins,
      theme: {
        ...original.theme,
        files: {
          ...files,
          'layouts/product.liquid': (
            files['layouts/product.liquid'] ?? ''
          ).replace('</article>', `${CRUMB}</article>`),
          'layouts/page.liquid': (files['layouts/page.liquid'] ?? '').replace(
            '{% endblock %}',
            `${CRUMB}{% endblock %}`,
          ),
        },
      },
    });
    resetThemeCacheForTests();
    resetBootForTests();
    await SELF.fetch(`${ORIGIN}/`);
    await SELF.fetch(`${ORIGIN}/_mallok/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie =
      (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { csrf } = (await session.json()) as { csrf: string };
    admin = (method, path, body) =>
      SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await admin('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'zh'],
      kinds: {
        page: { base: '' },
        product: { base: 'products' },
        case: { base: 'work' },
      },
    });
    const product = await admin('POST', '/_mallok/api/content', {
      kind: 'product',
      slug: 'bar',
      status: 'published',
      markdown: '---\ntitle: Bar\n---\n\nA bar.',
    });
    const { translationGroup } = (await product.json()) as {
      translationGroup: string;
    };
    await admin('POST', '/_mallok/api/content', {
      kind: 'product',
      locale: 'zh',
      slug: 'bang',
      translationGroup,
      status: 'published',
      markdown: '---\ntitle: 棒材\n---\n\n棒材。',
    });
    await admin('POST', '/_mallok/api/content', {
      kind: 'page',
      slug: 'about',
      status: 'published',
      markdown: '---\ntitle: About\n---\n\nAbout.',
    });
  });

  afterAll(() => {
    configure(original);
    resetThemeCacheForTests();
    resetBootForTests();
  });

  /** What the theme calls a kind in a language: its pack, then its manifest. */
  const label = (locale: string, kind: string): string => {
    const strings = JSON.parse(
      original.theme.files[`locales/${locale}.json`] ?? '{}',
    ) as Record<string, string>;
    return strings[kind] ?? original.theme.manifest.kinds[kind]?.label ?? kind;
  };

  it("links a content page to its own kind's list, and to another kind's", async () => {
    expect(await probe('/products/bar')).toBe(
      `<a class="crumb" href="/products">${label('en', 'product')}</a>` +
        `<a class="all-cases" href="/work">${label('en', 'case')}</a>`,
    );
    // The link is real: the list page is there.
    expect((await SELF.fetch(`${ORIGIN}/products`)).status).toBe(200);
  });

  it("writes them in the page's language", async () => {
    expect(label('zh', 'product')).not.toBe(label('en', 'product'));
    expect(await probe('/zh/products/bang')).toBe(
      `<a class="crumb" href="/zh/products">${label('zh', 'product')}</a>` +
        `<a class="all-cases" href="/zh/work">${label('zh', 'case')}</a>`,
    );
  });

  it('gives a kind with no list page no entry, so a template can ask', async () => {
    // `page` has no list layout: no crumb, and the probe for it prints nothing.
    expect(await probe('/about')).toMatch(
      /^<a class="all-cases" href="\/work">/,
    );
  });

  it('follows the base when the owner changes it', async () => {
    await admin('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        product: { base: 'catalogue' },
        case: { base: 'work' },
      },
    });
    // The item keeps the address it was published at; the link to its
    // kind's list is where the list now is.
    expect(await probe('/products/bar')).toContain(
      '<a class="crumb" href="/catalogue">',
    );
    expect((await SELF.fetch(`${ORIGIN}/catalogue`)).status).toBe(200);
  });
});
