import { SELF } from 'cloudflare:test';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { readThemePackage } from '../../src/core/theme-package.js';
import { definePlugin } from '../../src/plugins/define.js';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { resetThemeCacheForTests } from '../../src/worker/theme-cache.js';
import {
  file,
  themeSource,
  withFile,
  withManifest,
} from '../fixtures/theme-source.js';

/**
 * Pages a plugin renders through the theme, and the cross-site check on
 * plugin routes (docs/PLUGIN_API.md §7.2, docs/THEME_FORMAT.md §16).
 *
 * The plugin owns the route and the data; the theme owns the look. The theme
 * here provides a layout for the cart and none for an order, so both halves
 * of that sentence are exercised.
 */

const ORIGIN = 'https://plugin-pages.example';
const EMAIL = 'pages@example.com';
const PASSWORD = 'a sufficiently long password';

let handled: string[] = [];

const shop = definePlugin({
  manifest: {
    id: 'shop',
    name: 'Shop',
    version: '1.0.0',
    pluginApi: 2,
    routes: [
      { path: 'cart', method: 'GET', render: 'page', layout: 'shop/cart' },
      {
        path: 'cart/add',
        method: 'POST',
        render: 'page',
        layout: 'shop/cart',
      },
      {
        path: 'orders/:orderNo',
        method: 'GET',
        render: 'page',
        layout: 'shop/order',
      },
      { path: 'plain', method: 'GET' },
      { path: 'broken', method: 'GET', render: 'page', layout: 'shop/cart' },
      { path: 'ping', method: 'POST' },
    ],
  },
  routes: {
    cart: async (_input, ctx) => {
      handled.push('cart');
      return {
        title: 'Your cart',
        description: 'What you are about to order.',
        view: {
          lines: [
            { name: 'Grade 5 bar', quantity: 2 },
            { name: 'Sheet <b>3mm</b>', quantity: 1 },
          ],
          total: 'USD 248.00',
          locale: ctx.locale,
          // Not JSON; must not reach the template.
          format: () => 'never',
        },
      };
    },
    'cart/add': async (input) => {
      handled.push('cart/add');
      if (input.fields.sku === undefined) {
        return {
          status: 422,
          title: 'Your cart',
          view: { lines: [], total: '', error: 'Choose a product first.' },
          headers: [
            ['set-cookie', 'cart=abc; Path=/_mallok/p/shop; HttpOnly'],
            ['set-cookie', 'seen=1; Path=/_mallok/p/shop'],
            ['cache-control', 'public, max-age=3600'],
          ],
        };
      }
      return new Response(null, {
        status: 303,
        headers: { location: '/_mallok/p/shop/cart' },
      });
    },
    'orders/:orderNo': async (input) => {
      handled.push('orders');
      return {
        title: `Order ${input.params.orderNo}`,
        view: {
          order_no: input.params.orderNo,
          state: 'Paid',
          paid: true,
          items: [{ name: 'hidden from the built-in layout' }],
        },
      };
    },
    plain: async () => ({ view: { a: 1 } }) as unknown as Response,
    broken: async () => ['not', 'a', 'view'] as unknown as Response,
    ping: async () => {
      handled.push('ping');
      return Response.json({ ok: true });
    },
  },
});

/** Written for plugin API 1; the cross-site check applies to it as well. */
const legacy = definePlugin({
  manifest: {
    id: 'legacy',
    name: 'Legacy',
    version: '1.0.0',
    pluginApi: 1,
    routes: [{ path: 'save', method: 'POST' }],
  },
  routes: {
    save: async () => {
      handled.push('legacy');
      return Response.json({ ok: true });
    },
  },
});

function probeTheme() {
  const source = withFile(
    withManifest(themeSource('probe', '1.0.0'), (manifest) => {
      manifest.locales = ['en', 'de'];
      manifest.pluginLayouts = { 'shop/cart': 'layouts/shop-cart.liquid' };
    }),
    'locales/en.json',
    JSON.stringify({ language_name: 'English', cart_heading: 'Cart' }),
  );
  const pkg = readThemePackage(
    [
      ...source,
      file(
        'locales/de.json',
        JSON.stringify({ language_name: 'Deutsch', cart_heading: 'Warenkorb' }),
      ),
      file('partials/site-name.liquid', '<p id="site">{{ site.name }}</p>'),
      file(
        'layouts/shop-cart.liquid',
        [
          '<!doctype html><html lang="{{ page.locale }}"><head><title>{{ page.title }}</title>',
          '<meta name="description" content="{{ page.description }}">',
          '<link rel="stylesheet" href="{{ theme.asset_base }}/style.css"><!--head:{{ page.head }}:head--></head><body>',
          '{% render "partials/site-name", site: site %}',
          '<h1 data-kind="{{ page.kind }}">{{ t.cart_heading }}</h1>',
          '<nav>{% for alt in page.alternates %}<a hreflang="{{ alt.locale }}" href="{{ alt.href }}">{{ alt.name }}</a>{% endfor %}</nav>',
          '<ul>{% for line in plugin_page.lines %}<li>{{ line.name }} × {{ line.quantity }}</li>{% endfor %}</ul>',
          '<p id="total">{{ plugin_page.total }}</p><p id="error">{{ plugin_page.error }}</p>',
          '<p id="seen-locale">{{ plugin_page.locale }}</p><p id="fn">[{{ plugin_page.format }}]</p>',
          '<p id="canonical">{{ page.canonical }}</p><p id="plugins">[{{ plugins.shop }}]</p>',
          '</body></html>',
        ].join(''),
      ),
    ],
    'probe',
  );
  return { manifest: pkg.manifest, files: pkg.files };
}

function page(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/p/${path}`, {
    redirect: 'manual',
    ...init,
  });
}

function post(
  path: string,
  headers: Record<string, string> = {},
  body = 'sku=TI-6AL',
): Promise<Response> {
  return page(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body,
  });
}

function events(
  spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  event: string,
): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call): Record<string, unknown> => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((entry) => entry.event === event);
}

describe('plugin pages', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };
  let admin: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<Response>;

  beforeAll(async () => {
    configure({
      theme: probeTheme(),
      plugins: [inquiryPlugin, shop, legacy],
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
      name: 'Acme Titanium',
      locales: ['en', 'de'],
    });
    for (const id of ['shop', 'legacy', 'inquiry']) {
      await admin('POST', `/_mallok/api/plugins/${id}/enabled`, {
        enabled: true,
      });
    }
  });

  afterEach(() => {
    handled = [];
    vi.restoreAllMocks();
  });

  afterAll(() => {
    configure(original);
    resetThemeCacheForTests();
    resetBootForTests();
  });

  describe('rendering', () => {
    it("renders the plugin's view through the theme's layout", async () => {
      const response = await page('shop/cart');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/html; charset=utf-8',
      );
      const html = await response.text();
      // The site's own frame: a theme partial, a language-pack string, the
      // page metadata the plugin supplied.
      expect(html).toContain('<p id="site">Acme Titanium</p>');
      expect(html).toContain('<h1 data-kind="plugin">Cart</h1>');
      expect(html).toContain('<title>Your cart</title>');
      expect(html).toContain('content="What you are about to order."');
      // The plugin's data, escaped like any other value.
      expect(html).toContain('<li>Grade 5 bar × 2</li>');
      expect(html).toContain('<li>Sheet &lt;b&gt;3mm&lt;/b&gt; × 1</li>');
      expect(html).toContain('<p id="total">USD 248.00</p>');
      expect(html).toContain('<p id="fn">[]</p>');
      expect(html).toContain(
        `<p id="canonical">${ORIGIN}/_mallok/p/shop/cart</p>`,
      );
      // Nothing for a crawler, and no `renderData` on a plugin's own page.
      expect(html).toContain('<!--head::head-->');
      expect(html).toContain('<p id="plugins">[]</p>');
    });

    it('is private and never indexed', async () => {
      const response = await page('shop/cart');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
      expect(response.headers.get('cache-tag')).toBeNull();
      expect(response.headers.get('x-mallok-cache')).toBeNull();
    });

    it('renders in the locale of the request, with a working language switcher', async () => {
      const german = await (await page('shop/de/cart')).text();
      expect(german).toContain('<html lang="de">');
      expect(german).toContain('<h1 data-kind="plugin">Warenkorb</h1>');
      expect(german).toContain('<p id="seen-locale">de</p>');
      const switcher =
        `<nav><a hreflang="en" href="${ORIGIN}/_mallok/p/shop/cart">English</a>` +
        `<a hreflang="de" href="${ORIGIN}/_mallok/p/shop/de/cart">Deutsch</a></nav>`;
      expect(german).toContain(switcher);
      // The same links from the other side.
      const english = await (await page('shop/cart')).text();
      expect(english).toContain('<html lang="en">');
      expect(english).toContain(switcher);
      // Each link leads to the page it names.
      expect((await page('shop/de/cart')).status).toBe(200);
    });

    it('takes status and headers from the handler, except caching', async () => {
      const response = await post('shop/cart/add', {}, 'other=1');
      expect(response.status).toBe(422);
      expect(await response.text()).toContain(
        '<p id="error">Choose a product first.</p>',
      );
      expect(response.headers.getSetCookie()).toEqual([
        'cart=abc; Path=/_mallok/p/shop; HttpOnly',
        'seen=1; Path=/_mallok/p/shop',
      ]);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it('passes a Response through, so a POST can redirect', async () => {
      const response = await post('shop/cart/add');
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/_mallok/p/shop/cart');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });
  });

  describe('a layout the theme does not have', () => {
    it('falls back to a plain built-in page and says so', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const response = await page('shop/de/orders/A-1001%20%3Cx%3E');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const html = await response.text();
      expect(html).toContain('<html lang="de">');
      expect(html).toContain('<h1>Order A-1001 &lt;x&gt;</h1>');
      expect(html).toContain('no layout named <code>shop/order</code>');
      // Plain top-level values only; it does not guess at structure.
      expect(html).toContain('<dt>order_no</dt><dd>A-1001 &lt;x&gt;</dd>');
      expect(html).toContain('<dt>state</dt><dd>Paid</dd>');
      expect(html).toContain('<dt>paid</dt><dd>true</dd>');
      expect(html).not.toContain('hidden from the built-in layout');
      expect(events(warn, 'plugin_layout_missing')).toEqual([
        {
          event: 'plugin_layout_missing',
          plugin: 'shop',
          layout: 'shop/order',
          theme: 'probe',
        },
      ]);
    });

    it('is reported to the admin before a visitor finds it', async () => {
      const { plugins } = (await (
        await admin('GET', '/_mallok/api/plugins')
      ).json()) as {
        plugins: {
          id: string;
          pageLayouts: { layout: string; provided: boolean }[];
        }[];
      };
      expect(
        plugins.find((plugin) => plugin.id === 'shop')?.pageLayouts,
      ).toEqual([
        { layout: 'shop/cart', provided: true },
        { layout: 'shop/order', provided: false },
      ]);
      expect(
        plugins.find((plugin) => plugin.id === 'inquiry')?.pageLayouts,
      ).toEqual([]);
    });
  });

  describe('a handler that returns the wrong thing', () => {
    it('answers 500 and names the route in the log', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      // A view from a route that renders none, and a non-view from one that
      // does.
      for (const path of ['shop/plain', 'shop/broken']) {
        const response = await page(path);
        expect(response.status, path).toBe(500);
        expect(response.headers.get('cache-control'), path).toBe(
          'private, no-store',
        );
      }
      expect(
        events(warn, 'plugin_route_bad_result').map((entry) => entry.route),
      ).toEqual(['plain', 'broken']);
    });
  });

  describe('the cross-site check', () => {
    it('refuses a submission a browser marks as cross-site, before the handler runs', async () => {
      for (const path of ['shop/cart/add', 'shop/ping', 'legacy/save']) {
        const response = await post(path, { 'sec-fetch-site': 'cross-site' });
        expect(response.status, path).toBe(403);
        expect(response.headers.get('cache-control'), path).toBe(
          'private, no-store',
        );
      }
      expect(handled).toEqual([]);
    });

    it('accepts what a browser marks as the site itself, or as the visitor', async () => {
      for (const verdict of ['same-origin', 'same-site', 'none']) {
        const response = await post('shop/ping', {
          'sec-fetch-site': verdict,
        });
        expect(response.status, verdict).toBe(200);
      }
      expect(handled).toEqual(['ping', 'ping', 'ping']);
    });

    it('falls back to Origin when there is no Sec-Fetch-Site', async () => {
      expect((await post('shop/ping', { origin: ORIGIN })).status).toBe(200);
      for (const origin of [
        'https://evil.example',
        'https://plugin-pages.example.evil.example',
        'http://plugin-pages.example:8080',
        'null',
      ]) {
        const response = await post('shop/ping', { origin });
        expect(response.status, origin).toBe(403);
      }
      // The browser's own verdict wins over a header a page can influence.
      expect(
        (
          await post('shop/ping', {
            origin: ORIGIN,
            'sec-fetch-site': 'cross-site',
          })
        ).status,
      ).toBe(403);
    });

    it('lets a request with neither header through', async () => {
      // Not a browser's form or fetch: a script or a server, which carries
      // no visitor's cookies.
      expect((await post('shop/ping')).status).toBe(200);
      expect((await post('legacy/save')).status).toBe(200);
    });

    it('never refuses a link: a cross-site GET still reaches its page', async () => {
      const response = await page('shop/cart', {
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'https://mail.example',
        },
      });
      expect(response.status).toBe(200);
      expect(handled).toEqual(['cart']);
    });

    it('still lets the inquiry form submit from its own site, and not from another', async () => {
      const fields = new URLSearchParams({
        name: 'Ada Buyer',
        email: 'ada@example.net',
        message: 'Please quote.',
        locale: 'en',
        source_path: '/',
        website: '',
      }).toString();
      const own = await post(
        'inquiry/submit',
        { 'sec-fetch-site': 'same-origin', origin: ORIGIN },
        fields,
      );
      expect(own.status).toBe(302);
      const foreign = await post(
        'inquiry/submit',
        { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
        fields,
      );
      expect(foreign.status).toBe(403);
    });
  });
});
