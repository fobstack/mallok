import { env, SELF } from 'cloudflare:test';
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
import type { PluginRenderDataContext } from '../../src/plugins/types.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import { cacheKeyFor } from '../../src/worker/cache.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { handlePublicPage } from '../../src/worker/pages/runtime.js';
import {
  guardRenderDataDb,
  readOnlyProblem,
} from '../../src/worker/render-data.js';
import { resetThemeCacheForTests } from '../../src/worker/theme-cache.js';
import { file, themeSource, withManifest } from '../fixtures/theme-source.js';

/**
 * The `renderData` hook (docs/PLUGIN_API.md §5.6): a plugin reads its own
 * tables while a page is rendered, and a theme prints what it returned.
 *
 * The Worker here is composed the way a site composes it — a theme and
 * plugins handed to `configure` — with a theme that prints `plugins.*` and
 * plugins whose behaviour each test sets.
 */

const ORIGIN = 'https://render-data.example';
const EMAIL = 'render@example.com';
const PASSWORD = 'a sufficiently long password';

/** What the `pricing` test plugin does on its next calls. */
type Mode =
  | 'ok'
  | 'throw'
  | 'twice'
  | 'twice-swallowed'
  | 'write'
  | 'array'
  | 'cycle'
  | 'nothing';
let mode: Mode = 'ok';
/** What each test plugin offers for the page's structured data. */
let offered: unknown;
let notesOffered: unknown;
const seen: PluginRenderDataContext[] = [];

const PRICES =
  'SELECT content_id, label FROM p_pricing_price WHERE content_id IN';

async function readPrices(
  ctx: PluginRenderDataContext,
): Promise<Record<string, string>> {
  const ids =
    ctx.content === null ? ctx.items.map((item) => item.id) : [ctx.content.id];
  if (ids.length === 0) {
    return {};
  }
  const rows = await ctx.db
    .prepare(`${PRICES} (${ids.map(() => '?').join(', ')}) ORDER BY content_id`)
    .bind(...ids)
    .all<{ content_id: string; label: string }>();
  return Object.fromEntries(
    rows.results.map((row) => [row.content_id, row.label]),
  );
}

const pricing = definePlugin({
  manifest: {
    id: 'pricing',
    name: 'Pricing',
    version: '1.0.0',
    pluginApi: 2,
    hooks: ['renderData'],
  },
  migrations: [
    {
      id: 'plugin:pricing:0001_price',
      sql: 'CREATE TABLE p_pricing_price (content_id TEXT PRIMARY KEY, label TEXT NOT NULL);',
    },
  ],
  hooks: {
    renderData: async (ctx) => {
      seen.push(ctx);
      if (mode === 'nothing') {
        return undefined;
      }
      if (mode === 'throw') {
        throw new Error('pricing is down');
      }
      if (mode === 'write') {
        await ctx.db
          .prepare(
            "INSERT INTO p_pricing_price (content_id, label) VALUES ('x', 'y')",
          )
          .run();
      }
      const prices = await readPrices(ctx);
      if (mode === 'twice') {
        await readPrices(ctx);
      }
      if (mode === 'twice-swallowed') {
        try {
          await readPrices(ctx);
        } catch {
          // A plugin that hides the refusal must not get away with it.
        }
      }
      if (mode === 'array') {
        return ['not', 'an', 'object'] as unknown as Record<string, unknown>;
      }
      if (mode === 'cycle') {
        const loop: Record<string, unknown> = {};
        loop.self = loop;
        return loop;
      }
      return {
        price: ctx.content === null ? '' : (prices[ctx.content.id] ?? ''),
        prices,
        // Never reaches a template: not JSON.
        format: () => 'dropped',
        ...(offered === undefined ? {} : { structuredData: offered }),
      };
    },
  },
});

/** A second plugin, with a hyphenated id and no database use. */
const notes = definePlugin({
  manifest: {
    id: 'site-notes',
    name: 'Notes',
    version: '1.0.0',
    pluginApi: 2,
    hooks: ['renderData'],
  },
  hooks: {
    renderData: async (ctx) => ({
      note: `note for ${ctx.locale}`,
      ...(notesOffered === undefined ? {} : { structuredData: notesOffered }),
    }),
  },
});

/** A third, which the budget has no room for. */
let thirdCalls = 0;
const third = definePlugin({
  manifest: {
    id: 'third',
    name: 'Third',
    version: '1.0.0',
    pluginApi: 2,
    hooks: ['renderData'],
  },
  hooks: {
    renderData: async () => {
      thirdCalls += 1;
      return { value: 'third' };
    },
  },
});

const HEAD =
  '<!doctype html><html><head><link rel="stylesheet" href="{{ theme.asset_base }}/style.css">{{ page.head }}</head><body>';
const PLUGIN_MARKUP =
  '<p id="sd">[{{ plugins.pricing.structuredData.offers.lowPrice }}{{ plugins.pricing.structured_data.offers.lowPrice }}]</p><p id="price">[{{ plugins.pricing.price }}]</p><p id="note">[{{ plugins.site_notes.note }}]</p><p id="third">[{{ plugins.third.value }}]</p><p id="fn">[{{ plugins.pricing.format }}]</p>';
const LISTED =
  '<li>{{ item.title }}=[{{ plugins.pricing.prices[item.id] }}]</li>';

function probeTheme() {
  const source = withManifest(themeSource('probe', '1.0.0'), (manifest) => {
    manifest.locales = ['en'];
    (manifest.kinds as Record<string, unknown>).product = {
      layout: 'layouts/article.liquid',
      listLayout: 'layouts/list.liquid',
      base: 'products',
    };
  }).filter((entry) => !entry.path.startsWith('layouts/'));
  const pkg = readThemePackage(
    [
      ...source,
      file(
        'layouts/home.liquid',
        `${HEAD}<ul>{% for item in recent.article %}${LISTED}{% endfor %}</ul><p id="note">[{{ plugins.site_notes.note }}]</p></body></html>`,
      ),
      file(
        'layouts/page.liquid',
        `${HEAD}<h1>{{ content.title }}</h1>{{ content.html }}${PLUGIN_MARKUP}</body></html>`,
      ),
      file(
        'layouts/article.liquid',
        `${HEAD}<h1>{{ content.title }}</h1>{{ content.html }}${PLUGIN_MARKUP}</body></html>`,
      ),
      file(
        'layouts/list.liquid',
        `${HEAD}<ul>{% for item in list.items %}${LISTED}{% endfor %}</ul></body></html>`,
      ),
    ],
    'probe',
  );
  return { manifest: pkg.manifest, files: pkg.files };
}

let token = '';
let alpha = { id: '', path: '' };
let beta = { id: '', path: '' };
let widget = { id: '', path: '' };
let about = { id: '', path: '' };

async function api(method: string, path: string, body?: unknown) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Counts D1 round trips the way `budget.test.ts` does. */
function countingDb(real: D1Database): { db: D1Database; calls: string[] } {
  const calls: string[] = [];
  const wrapStatement = (
    statement: D1PreparedStatement,
    sql: string,
  ): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property === 'bind') {
          return (...args: unknown[]) =>
            wrapStatement(target.bind(...args), sql);
        }
        if (
          property === 'all' ||
          property === 'first' ||
          property === 'run' ||
          property === 'raw'
        ) {
          return (...args: unknown[]) => {
            calls.push(`${String(property)}: ${sql.slice(0, 40)}`);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const db = new Proxy(real, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property === 'batch') {
        return (statements: unknown[]) => {
          calls.push(`batch(${statements.length})`);
          return (value as (s: unknown[]) => unknown).call(target, statements);
        };
      }
      if (property === 'prepare') {
        return (sql: string) =>
          wrapStatement(
            (value as (s: string) => D1PreparedStatement).call(target, sql),
            sql,
          );
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db, calls };
}

/** Renders through the real handler; `pending` collects `waitUntil` work. */
async function render(
  path: string,
  db: D1Database = env.DB,
  pending: Promise<unknown>[] = [],
): Promise<Response> {
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
  return await handlePublicPage(
    new Request(`${ORIGIN}${path}`),
    { ...env, DB: db } as typeof env,
    ctx,
  );
}

/** Renders with the edge cache entry dropped first and nothing stored after. */
async function cold(path: string, db: D1Database = env.DB): Promise<Response> {
  await caches.default.delete(cacheKeyFor(new Request(`${ORIGIN}${path}`)));
  return await render(path, db);
}

function logged(
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

describe('renderData', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };

  beforeAll(async () => {
    configure({
      theme: probeTheme(),
      plugins: [inquiryPlugin, pricing, notes, third],
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
    const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'render-data',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    const create = async (slug: string, title: string) =>
      (await (
        await api('POST', '/_mallok/api/content', {
          kind: 'article',
          slug,
          markdown: `---\ntitle: ${title}\ntags: [metal]\nsku: ${slug}-1\n---\n\nBody of ${title}.`,
        })
      ).json()) as { id: string; path: string };
    alpha = await create('alpha', 'Alpha');
    beta = await create('beta', 'Beta');
    await api('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: 'products' },
      },
    });
    const createAs = async (kind: string, slug: string, title: string) =>
      (await (
        await api('POST', '/_mallok/api/content', {
          kind,
          slug,
          markdown: `---\ntitle: ${title}\ndescription: About ${title}.\n---\n\nBody of ${title}.`,
        })
      ).json()) as { id: string; path: string };
    widget = await createAs('product', 'widget', 'Widget');
    about = await createAs('page', 'about', 'About');

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO p_pricing_price (content_id, label) VALUES (?, ?)',
      ).bind(alpha.id, 'USD 99 <net>'),
      env.DB.prepare(
        'INSERT INTO p_pricing_price (content_id, label) VALUES (?, ?)',
      ).bind(beta.id, 'USD 149'),
    ]);
    for (const id of ['pricing', 'site-notes']) {
      await api('POST', `/_mallok/api/plugins/${id}/enabled`, {
        enabled: true,
      });
    }
  });

  afterEach(() => {
    mode = 'ok';
    offered = undefined;
    notesOffered = undefined;
    seen.length = 0;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    configure(original);
    resetThemeCacheForTests();
    resetBootForTests();
  });

  it('gives a content page what the plugin read, escaped like any value', async () => {
    const html = await (await cold(alpha.path)).text();
    expect(html).toContain('<p id="price">[USD 99 &lt;net&gt;]</p>');
    // A hyphenated plugin id is spelled with underscores in the view.
    expect(html).toContain('<p id="note">[note for en]</p>');
    // A function is not JSON and never reaches the template.
    expect(html).toContain('<p id="fn">[]</p>');
  });

  it('tells the hook which page it is for', async () => {
    await cold(alpha.path);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.locale).toBe('en');
    expect(seen[0]?.path).toBe(alpha.path);
    expect(seen[0]?.items).toEqual([]);
    expect(seen[0]?.content).toMatchObject({ id: alpha.id, kind: 'article' });
    expect(seen[0]?.content?.frontmatter.sku).toBe('alpha-1');
    expect(seen[0]?.content?.translationGroup).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0]).not.toHaveProperty('secrets');
  });

  it('gives a list, a tag archive and the home page the items on that page', async () => {
    for (const path of ['/news', '/tags/metal', '/']) {
      seen.length = 0;
      const html = await (await cold(path)).text();
      expect(html, path).toContain('<li>Alpha=[USD 99 &lt;net&gt;]</li>');
      expect(html, path).toContain('<li>Beta=[USD 149]</li>');
      expect(seen[0]?.content, path).toBeNull();
      // The home page lists every kind the theme gives a list, so the hook
      // is told about the product as well; the theme prints the articles.
      const items = seen[0]?.items ?? [];
      expect(
        items
          .filter((item) => item.kind === 'article')
          .map((item) => item.id)
          .sort(),
        path,
      ).toEqual([alpha.id, beta.id].sort());
      expect(
        items.some((item) => item.id === widget.id),
        path,
      ).toBe(path === '/');
    }
  });

  it('costs one round trip, inside the budget of four', async () => {
    const { db, calls } = countingDb(env.DB);
    expect((await cold(alpha.path, db)).status).toBe(200);
    // The core's two, plus the one query of the one plugin that reads.
    expect(calls).toHaveLength(3);
    expect(calls.filter((call) => call.includes(PRICES.slice(0, 20)))).toEqual([
      `all: ${PRICES.slice(0, 40)}`,
    ]);
    for (const path of ['/news', '/']) {
      const listed = countingDb(env.DB);
      await cold(path, listed.db);
      expect(listed.calls.length, path).toBeLessThanOrEqual(4);
    }
  });

  it('is not called when the edge cache answers', async () => {
    await caches.default.delete(
      cacheKeyFor(new Request(`${ORIGIN}${alpha.path}`)),
    );
    const pending: Promise<unknown>[] = [];
    const warm = await render(alpha.path, env.DB, pending);
    expect(warm.headers.get('x-mallok-cache')).toBe('MISS');
    await Promise.all(pending);
    expect(seen).toHaveLength(1);

    const hit = await render(alpha.path);
    expect(hit.headers.get('x-mallok-cache')).toBe('HIT');
    expect(seen).toHaveLength(1);
    expect(await hit.text()).toContain('[USD 99 &lt;net&gt;]');
  });

  it('renders the same bytes from the same database state', async () => {
    const first = await (await cold(alpha.path)).text();
    const second = await (await cold(alpha.path)).text();
    expect(second).toBe(first);
    const list = await (await cold('/news')).text();
    expect(await (await cold('/news')).text()).toBe(list);
  });

  it('runs no hook for a plugin that is switched off, and none on a 404', async () => {
    await api('POST', '/_mallok/api/plugins/pricing/enabled', {
      enabled: false,
    });
    const html = await (await cold(alpha.path)).text();
    expect(seen).toHaveLength(0);
    expect(html).toContain('<p id="price">[]</p>');
    expect(html).toContain('<p id="note">[note for en]</p>');
    await api('POST', '/_mallok/api/plugins/pricing/enabled', {
      enabled: true,
    });

    const missing = await cold('/no-such-page');
    expect(missing.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('leaves the key out when the plugin has nothing for the page', async () => {
    mode = 'nothing';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await cold(alpha.path);
    expect(await response.text()).toContain('<p id="price">[]</p>');
    // Nothing failed, so the page is cacheable as usual.
    expect(response.headers.get('x-mallok-cache')).toBe('MISS');
    expect(logged(warn, 'render_data_failed')).toEqual([]);
  });

  describe('a failing hook', () => {
    const cases: readonly [Mode, string][] = [
      ['throw', 'pricing is down'],
      ['twice', 'one database call'],
      ['twice-swallowed', 'one database call'],
      ['write', 'may only read'],
      ['array', 'must return an object'],
      ['cycle', 'circular'],
    ];

    for (const [failure, reason] of cases) {
      it(`${failure}: the page renders without that data, is logged and is not cached`, async () => {
        mode = failure;
        const warn = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);
        const pending: Promise<unknown>[] = [];
        await caches.default.delete(
          cacheKeyFor(new Request(`${ORIGIN}${alpha.path}`)),
        );
        const response = await render(alpha.path, env.DB, pending);
        await Promise.all(pending);

        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('<h1>Alpha</h1>');
        expect(html).toContain('<p id="price">[]</p>');
        // The other plugin is unaffected.
        expect(html).toContain('<p id="note">[note for en]</p>');

        const events = logged(warn, 'render_data_failed');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          plugin: 'pricing',
          path: alpha.path,
        });
        expect(String(events[0]?.reason).toLowerCase()).toContain(reason);

        // Not stored: the next request renders again and gets the data.
        expect(response.headers.get('x-mallok-cache')).toBe('BYPASS');
        expect(response.headers.get('cache-control')).toContain('no-store');
        mode = 'ok';
        const next = await render(alpha.path);
        expect(next.headers.get('x-mallok-cache')).toBe('MISS');
        expect(await next.text()).toContain('[USD 99 &lt;net&gt;]');
      });
    }

    it('keeps a failed list, tag archive and home page out of the cache too', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      for (const path of ['/news', '/tags/metal', '/']) {
        mode = 'throw';
        const response = await cold(path);
        expect(response.status, path).toBe(200);
        expect(response.headers.get('x-mallok-cache'), path).toBe('BYPASS');
        expect(await response.text(), path).toContain('<li>Alpha=[]</li>');
      }
    });

    it('writes nothing when a write is refused', async () => {
      mode = 'write';
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await cold(alpha.path);
      const rows = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM p_pricing_price',
      ).first<{ n: number }>();
      expect(rows?.n).toBe(2);
    });
  });

  it('runs two plugins at most, skips a third, and still caches the page', async () => {
    await api('POST', '/_mallok/api/plugins/third/enabled', { enabled: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await cold(alpha.path);
    const html = await response.text();

    expect(thirdCalls).toBe(0);
    expect(html).toContain('<p id="third">[]</p>');
    expect(html).toContain('<p id="price">[USD 99 &lt;net&gt;]</p>');
    expect(logged(warn, 'render_data_skipped')).toMatchObject([
      { plugin: 'third', path: alpha.path },
    ]);
    // A standing property of the composition, not a failure: cacheable.
    expect(response.headers.get('x-mallok-cache')).toBe('MISS');

    // Switching one of the first two off makes room.
    await api('POST', '/_mallok/api/plugins/site-notes/enabled', {
      enabled: false,
    });
    expect(await (await cold(alpha.path)).text()).toContain(
      '<p id="third">[third]</p>',
    );
    await api('POST', '/_mallok/api/plugins/site-notes/enabled', {
      enabled: true,
    });
    await api('POST', '/_mallok/api/plugins/third/enabled', { enabled: false });
  });

  describe('structured data', () => {
    const offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '99.00',
      highPrice: '149.00',
      offerCount: 2,
      availability: 'https://schema.org/InStock',
    };

    /** Every JSON-LD node in a document, parsed. */
    function nodes(html: string): Record<string, unknown>[] {
      return [
        ...html.matchAll(
          /<script type="application\/ld\+json">(.*?)<\/script>/gs,
        ),
      ].map((match) => JSON.parse(match[1] ?? '{}') as Record<string, unknown>);
    }

    it('adds offers to the one Product node, the same bytes every time', async () => {
      offered = { offers: offers };
      const response = await cold(widget.path);
      const html = await response.text();
      const found = nodes(html);
      expect(found).toHaveLength(1);
      expect(found[0]).toEqual({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Widget',
        description: 'About Widget.',
        url: `${ORIGIN}${widget.path}`,
        offers: offers,
      });
      // The reserved key is for the core, not for templates.
      expect(html).toContain('<p id="sd">[]</p>');
      expect(response.headers.get('x-mallok-cache')).toBe('MISS');
      expect(await (await cold(widget.path)).text()).toBe(html);
    });

    it('never lets a plugin replace what the core said', async () => {
      offered = {
        '@context': 'https://example.com',
        '@type': 'Thing',
        name: 'Something else',
        url: 'https://elsewhere.example/',
        offers: offers,
      };
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const response = await cold(widget.path);
      const [node] = nodes(await response.text());
      expect(node).toMatchObject({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Widget',
        url: `${ORIGIN}${widget.path}`,
        offers: offers,
      });
      expect(
        logged(warn, 'structured_data_dropped').map((entry) => [
          entry.plugin,
          entry.key,
          entry.reason,
        ]),
      ).toEqual([
        ['pricing', '@context', 'core_key'],
        ['pricing', '@type', 'core_key'],
        ['pricing', 'name', 'core_key'],
        ['pricing', 'url', 'core_key'],
      ]);
      // Dropping a property is not a failure: the page is cached.
      expect(response.headers.get('x-mallok-cache')).toBe('MISS');
    });

    it('drops and logs a property outside the allow-list', async () => {
      offered = {
        offers: offers,
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '5' },
      };
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const [node] = nodes(await (await cold(widget.path)).text());
      expect(node).not.toHaveProperty('aggregateRating');
      expect(node?.offers).toEqual(offers);
      expect(logged(warn, 'structured_data_dropped')).toMatchObject([
        {
          plugin: 'pricing',
          key: 'aggregateRating',
          reason: 'not_allowed',
          path: widget.path,
        },
      ]);
    });

    it('gives the first plugin the property when two offer it', async () => {
      offered = { offers: offers };
      notesOffered = { offers: { '@type': 'Offer', price: '1.00' } };
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const [node] = nodes(await (await cold(widget.path)).text());
      expect(node?.offers).toEqual(offers);
      expect(logged(warn, 'structured_data_dropped')).toMatchObject([
        { plugin: 'site-notes', key: 'offers', reason: 'already_set' },
      ]);
    });

    it('escapes what a plugin offers the way the core escapes its own', async () => {
      offered = { offers: { '@type': 'Offer', name: '</script><b>x' } };
      const html = await (await cold(widget.path)).text();
      expect(html).toContain('"name":"\\u003c/script>\\u003cb>x"');
      expect(nodes(html)[0]?.offers).toEqual({
        '@type': 'Offer',
        name: '</script><b>x',
      });
    });

    it('changes nothing on a page whose node takes no additions, or has none', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      for (const path of [alpha.path, about.path, '/news', '/']) {
        const plain = await (await cold(path)).text();
        offered = { offers };
        warn.mockClear();
        const response = await cold(path);
        expect(await response.text(), path).toBe(plain);
        expect(response.headers.get('x-mallok-cache'), path).toBe('MISS');
        // An Article and the home page's node take nothing; a plain page and
        // a list have no node at all.
        expect(
          logged(warn, 'structured_data_dropped').map((entry) => entry.reason),
          path,
        ).toEqual([
          path === alpha.path || path === '/' ? 'not_allowed' : 'no_node',
        ]);
        offered = undefined;
      }
    });

    it('leaves the product page as it was when the plugin offers nothing', async () => {
      const withPlugin = await (await cold(widget.path)).text();
      expect(nodes(withPlugin)[0]).not.toHaveProperty('offers');
      await api('POST', '/_mallok/api/plugins/pricing/enabled', {
        enabled: false,
      });
      const without = await (await cold(widget.path)).text();
      await api('POST', '/_mallok/api/plugins/pricing/enabled', {
        enabled: true,
      });
      expect(nodes(without)).toEqual(nodes(withPlugin));
    });

    it('leaves the node alone when the hook fails or offers a non-object', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      mode = 'throw';
      offered = { offers: offers };
      expect(
        nodes(await (await cold(widget.path)).text())[0],
      ).not.toHaveProperty('offers');

      mode = 'ok';
      offered = ['offers'];
      const response = await cold(widget.path);
      expect(nodes(await response.text())[0]).not.toHaveProperty('offers');
      expect(response.headers.get('x-mallok-cache')).toBe('MISS');
      expect(logged(warn, 'structured_data_dropped')).toMatchObject([
        { plugin: 'pricing', key: 'structuredData', reason: 'not_object' },
      ]);
    });
  });
});

describe('the database a renderData hook is given', () => {
  it('accepts a read and refuses everything else, by keyword', () => {
    for (const sql of [
      'SELECT 1',
      '  select a from t where b = ?;',
      '-- prices\nSELECT a FROM t',
      '/* prices */ SELECT a FROM t',
      'WITH recent AS (SELECT 1) SELECT * FROM recent',
      "SELECT replace(a, 'x', 'y'), updated_at FROM t",
    ]) {
      expect(readOnlyProblem(sql), sql).toBeNull();
    }
    for (const sql of [
      'INSERT INTO t VALUES (1)',
      'update t set a = 1',
      'DELETE FROM t',
      'REPLACE INTO t VALUES (1)',
      'CREATE TABLE t (a)',
      'DROP TABLE t',
      'PRAGMA table_info(t)',
      'WITH gone AS (SELECT 1) DELETE FROM t',
      'SELECT 1; DELETE FROM t',
      '/* SELECT */ DELETE FROM t',
      '',
    ]) {
      expect(readOnlyProblem(sql), sql).not.toBeNull();
    }
  });

  it('allows one query', async () => {
    const { db, state } = guardRenderDataDb(env.DB);
    const row = await db.prepare('SELECT 1 AS n').first<{ n: number }>();
    expect(row?.n).toBe(1);
    expect(() => db.prepare('SELECT 2 AS n').first()).toThrow(
      /one database call/,
    );
    expect(state.violation).toMatch(/one database call/);
  });

  it('allows one batch of its own statements, and nothing after it', async () => {
    const { db } = guardRenderDataDb(env.DB);
    const results = await db.batch<{ n: number }>([
      db.prepare('SELECT 1 AS n'),
      db.prepare('SELECT ? AS n').bind(2),
    ]);
    expect(results.map((result) => result.results[0]?.n)).toEqual([1, 2]);
    expect(() => db.batch([db.prepare('SELECT 3 AS n')])).toThrow(
      /one database call/,
    );
  });

  it('refuses a statement prepared on the real binding, exec and sessions', () => {
    const { db } = guardRenderDataDb(env.DB);
    expect(() => db.batch([env.DB.prepare('DELETE FROM job')])).toThrow(
      /prepared on ctx\.db/,
    );
    expect(() => db.exec('DELETE FROM job')).toThrow(/only read/);
    expect(() =>
      (db as unknown as { withSession: () => unknown }).withSession(),
    ).toThrow(/session/);
  });
});
