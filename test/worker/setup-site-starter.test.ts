import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugins/define.js';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import { defineStarter } from '../../src/starters/define.js';
import type { Starter } from '../../src/starters/types.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { createMallok } from '../../src/worker/framework.js';
import { catalogPlugin } from '../fixtures/catalog-plugin.js';

/**
 * A site that brings its own starter (docs/ARCHITECTURE.md §11): the wizard
 * offers it, imports its content, and fills its plugins with sample data
 * through the plugins' own `save` handlers.
 */

const ORIGIN = 'https://site-starter.example';
const EMAIL = 'shop@example.com';
const PASSWORD = 'a sufficiently long password';

/** A plugin whose records cannot be saved, to see what the wizard does. */
const fragile = definePlugin({
  manifest: {
    id: 'fragile',
    name: 'Fragile',
    version: '1.0.0',
    pluginApi: 2,
    panels: [
      {
        id: 'things',
        label: 'Things',
        type: 'records',
        table: 'p_fragile_thing',
        columns: [{ field: 'name', label: 'Name' }],
        fields: { name: { type: 'string', label: 'Name', required: true } },
      },
    ],
  },
  migrations: [
    {
      id: 'plugin:fragile:0001',
      sql: 'CREATE TABLE p_fragile_thing (id TEXT PRIMARY KEY, name TEXT NOT NULL);',
    },
  ],
  records: {
    things: {
      load: async () => null,
      save: async () => {
        throw new Error('the shelf collapsed');
      },
    },
  },
});

const shop: Starter = {
  id: 'shop',
  name: 'A small shop',
  description: 'Two products, one of them with variants.',
  theme: 'atelier',
  plugins: ['catalog', 'fragile'],
  settings: {
    tagline: { en: 'Metal, cut to length', zh: '按长度切割的金属' },
    locales: ['en', 'zh'],
    kinds: {
      page: { base: '' },
      product: { base: 'products' },
      category: { base: 'families' },
    },
    nav: { en: [{ label: 'Products', href: '/products' }] },
    themeOptions: {},
  },
  documents: [
    {
      kind: 'category',
      slug: 'bars',
      markdown: '---\ntitle: Bars\n---\n\nRound bar.',
    },
    {
      kind: 'product',
      slug: 'ti-bar',
      markdown: '---\ntitle: Titanium bar\ncategory: bars\n---\n\nA bar.',
      translations: {
        zh: { slug: 'tai-bang', markdown: '---\ntitle: 钛棒\n---\n\n钛棒。' },
      },
    },
    {
      // No title: the ordinary save path refuses it, here as anywhere.
      kind: 'product',
      slug: 'untitled',
      markdown: 'No front matter at all.',
    },
  ],
  records: [
    {
      plugin: 'catalog',
      panel: 'items',
      values: {
        name: 'Titanium bar',
        code: 'TI-BAR',
        status: 'active',
        price: { amount: 9900, currency: 'USD' },
        variants: [
          {
            sku: 'TI-BAR-10',
            stock: 12,
            price: { amount: 9900, currency: 'USD' },
          },
          { sku: 'TI-BAR-20', stock: 4, price: null },
        ],
        // Not a field of the panel: dropped, as the admin's form would.
        internal_cost: 1,
      },
    },
    {
      plugin: 'catalog',
      panel: 'notes',
      attachedTo: { kind: 'product', slug: 'ti-bar' },
      values: { body: 'Ships in ten days.' },
    },
    // Refused by the panel's declared fields: no code, a currency it does
    // not list.
    {
      plugin: 'catalog',
      panel: 'items',
      values: {
        name: 'Nameless',
        status: 'active',
        price: { amount: 100, currency: 'GBP' },
      },
    },
    // Refused by the plugin itself: the code is taken.
    {
      plugin: 'catalog',
      panel: 'items',
      values: {
        name: 'A second bar',
        code: 'TI-BAR',
        status: 'active',
        price: { amount: 100, currency: 'USD' },
      },
    },
    // Its product was not imported.
    {
      plugin: 'catalog',
      panel: 'notes',
      attachedTo: { kind: 'product', slug: 'untitled' },
      values: { body: 'Orphaned.' },
    },
    // The plugin's handler throws.
    { plugin: 'fragile', panel: 'things', values: { name: 'Vase' } },
    // And the import carries on after all of that.
    {
      plugin: 'catalog',
      panel: 'items',
      values: {
        name: 'Titanium plate',
        code: 'TI-PLATE',
        status: 'archived',
        price: { amount: 25000, currency: 'EUR' },
      },
    },
  ],
};

let cookie = '';
let csrf = '';

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie === '' ? {} : { cookie, 'x-mallok-csrf': csrf }),
    },
    body: JSON.stringify(body),
  });
}

describe('a starter the site brings', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };

  beforeAll(async () => {
    // The real entry point: this is what a site's four-line Worker calls.
    createMallok({
      theme: original.theme,
      plugins: [inquiryPlugin, catalogPlugin, fragile],
      starters: [shop],
    });
    resetBootForTests();
    await SELF.fetch(`${ORIGIN}/`);
    await post('/_mallok/api/setup/admin', {
      email: EMAIL,
      password: PASSWORD,
    });
    const session = await post('/_mallok/api/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    cookie = (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    csrf = ((await session.json()) as { csrf: string }).csrf;
    await post('/_mallok/api/setup/site', {
      name: 'Shop',
      defaultLocale: 'en',
      locales: ['en'],
    });
  });

  afterAll(() => {
    configure(original);
    resetBootForTests();
  });

  it('is offered first, before the one Mallok ships', async () => {
    const status = (await (
      await SELF.fetch(`${ORIGIN}/_mallok/api/setup`)
    ).json()) as {
      starters: {
        id: string;
        name: string;
        documents: number;
        records: number;
        matchesActiveTheme: boolean;
      }[];
    };
    expect(status.starters.map((entry) => entry.id)).toEqual([
      'shop',
      'trade-b2b',
    ]);
    expect(status.starters[0]).toMatchObject({
      name: 'A small shop',
      documents: 3,
      records: 7,
      matchesActiveTheme: true,
    });
    expect(status.starters[1]?.records).toBe(0);
  });

  it('imports its content and its plugin data, and says what it could not', async () => {
    const response = await post('/_mallok/api/setup/starter', {
      starter: 'shop',
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      starter: string;
      created: number;
      failed: { slug: string; error: string }[];
      plugins: string[];
      records: number;
      failedRecords: { record: string; error: string }[];
    };
    expect(result.starter).toBe('shop');
    // Two documents and one translation; the untitled one is refused.
    expect(result.created).toBe(3);
    expect(result.failed.map((entry) => entry.slug)).toEqual(['untitled']);
    expect(result.records).toBe(3);
    expect(result.failedRecords).toEqual([
      {
        record: 'catalog/items #3',
        error: expect.stringMatching(/^code: .*; price: /) as string,
      },
      {
        record: 'catalog/items #4',
        error: 'code: Another item already uses this code.',
      },
      {
        record: 'catalog/notes #5',
        error: 'The product/untitled it belongs to was not imported.',
      },
      { record: 'fragile/things #6', error: 'the shelf collapsed' },
    ]);
  });

  it('wrote the plugin data through the plugin, as the admin form would', async () => {
    const items = await env.DB.prepare(
      'SELECT id, name, code, status, price_amount, price_currency FROM p_catalog_item ORDER BY code',
    ).all<{ id: string; code: string }>();
    expect(items.results).toMatchObject([
      {
        name: 'Titanium bar',
        code: 'TI-BAR',
        status: 'active',
        price_amount: 9900,
        price_currency: 'USD',
      },
      {
        name: 'Titanium plate',
        code: 'TI-PLATE',
        status: 'archived',
        price_amount: 25000,
        price_currency: 'EUR',
      },
    ]);
    const variants = await env.DB.prepare(
      'SELECT sku, stock, price_amount FROM p_catalog_variant WHERE item_id = ? ORDER BY position',
    )
      .bind(items.results[0]?.id ?? '')
      .all();
    expect(variants.results).toEqual([
      { sku: 'TI-BAR-10', stock: 12, price_amount: 9900 },
      { sku: 'TI-BAR-20', stock: 4, price_amount: null },
    ]);
    expect(
      (
        await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM p_fragile_thing',
        ).first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });

  it('attached a record to the product the starter named, in every language', async () => {
    const product = await env.DB.prepare(
      "SELECT translation_group FROM content WHERE kind = 'product' AND slug = 'ti-bar'",
    ).first<{ translation_group: string }>();
    const translated = await env.DB.prepare(
      "SELECT translation_group FROM content WHERE kind = 'product' AND locale = 'zh'",
    ).first<{ translation_group: string }>();
    expect(translated?.translation_group).toBe(product?.translation_group);
    const notes = await env.DB.prepare(
      'SELECT translation_group, body FROM p_catalog_note',
    ).all();
    expect(notes.results).toEqual([
      {
        translation_group: product?.translation_group,
        body: 'Ships in ten days.',
      },
    ]);
  });

  it('switched on the plugins it lists and applied its settings', async () => {
    const states = await env.DB.prepare(
      'SELECT plugin_id, enabled FROM plugin_state ORDER BY plugin_id',
    ).all<{ plugin_id: string; enabled: number }>();
    const enabled = Object.fromEntries(
      states.results.map((row) => [row.plugin_id, row.enabled]),
    );
    expect(enabled).toMatchObject({ catalog: 1, fragile: 1, inquiry: 0 });
    const site = await env.DB.prepare(
      'SELECT tagline, taglines, locales FROM site WHERE id = 1',
    ).first<{ tagline: string; taglines: string; locales: string }>();
    expect(site?.tagline).toBe('Metal, cut to length');
    // A starter may bring a tagline per language.
    expect(JSON.parse(site?.taglines ?? '{}')).toEqual({
      zh: '按长度切割的金属',
    });
    expect(JSON.parse(site?.locales ?? '[]')).toEqual(['en', 'zh']);
    const page = await SELF.fetch(`${ORIGIN}/products/ti-bar`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Titanium bar');
  });

  it('answers 404 for a starter nobody registered', async () => {
    const response = await post('/_mallok/api/setup/starter', {
      starter: 'nope',
    });
    expect(response.status).toBe(404);
  });
});

describe('what createMallok accepts as a starter', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };
  afterAll(() => {
    configure(original);
    resetBootForTests();
  });

  const base: Starter = {
    id: 'mine',
    name: 'Mine',
    description: '',
    theme: 'atelier',
    plugins: ['catalog'],
    settings: { kinds: {}, nav: {}, themeOptions: {}, tagline: '' },
    documents: [
      { kind: 'product', slug: 'one', markdown: '---\ntitle: One\n---\n' },
    ],
  };
  const item = { name: 'N', code: 'C', status: 'active' };
  const said = (starters: Starter[], withCatalog = true): string => {
    try {
      createMallok({
        theme: original.theme,
        plugins: withCatalog ? [inquiryPlugin, catalogPlugin] : [inquiryPlugin],
        starters,
      });
    } catch (error) {
      return (error as Error).message;
    }
    return 'accepted';
  };

  it('takes a well-formed one, with or without defineStarter', () => {
    expect(said([base])).toBe('accepted');
    expect(said([defineStarter(base)])).toBe('accepted');
    expect(
      said([
        {
          ...base,
          records: [
            { plugin: 'catalog', panel: 'items', values: item },
            {
              plugin: 'catalog',
              panel: 'notes',
              attachedTo: { kind: 'product', slug: 'one' },
              values: { body: 'x' },
            },
          ],
        },
      ]),
    ).toBe('accepted');
  });

  it.each([
    ['an id that is not a slug', { ...base, id: 'My Shop' }, /at id/],
    [
      'two documents at one kind and slug',
      { ...base, documents: [...base.documents, ...base.documents] },
      /two documents are product\/one/,
    ],
    [
      'a record for a plugin it does not switch on',
      {
        ...base,
        plugins: [],
        records: [{ plugin: 'catalog', panel: 'items', values: item }],
      },
      /records\[0\] is for the plugin catalog, which the starter does not list/,
    ],
    [
      'a record for a panel the plugin does not have',
      {
        ...base,
        records: [{ plugin: 'catalog', panel: 'orders', values: {} }],
      },
      /catalog\/orders, which is not a records panel/,
    ],
    [
      'an attached record without its owner',
      {
        ...base,
        records: [{ plugin: 'catalog', panel: 'notes', values: { body: 'x' } }],
      },
      /needs attachedTo: the panel notes belongs to a product/,
    ],
    [
      'an owner of the wrong kind',
      {
        ...base,
        documents: [
          ...base.documents,
          { kind: 'page', slug: 'about', markdown: '---\ntitle: A\n---\n' },
        ],
        records: [
          {
            plugin: 'catalog',
            panel: 'notes',
            attachedTo: { kind: 'page', slug: 'about' },
            values: { body: 'x' },
          },
        ],
      },
      /attached to a page, but the panel notes belongs to a product/,
    ],
    [
      'an owner that is not one of its documents',
      {
        ...base,
        records: [
          {
            plugin: 'catalog',
            panel: 'notes',
            attachedTo: { kind: 'product', slug: 'two' },
            values: { body: 'x' },
          },
        ],
      },
      /attached to product\/two, which is not one of its documents/,
    ],
    [
      'an owner on a panel that has none',
      {
        ...base,
        records: [
          {
            plugin: 'catalog',
            panel: 'items',
            attachedTo: { kind: 'product', slug: 'one' },
            values: item,
          },
        ],
      },
      /has attachedTo, but the panel items is not attached to content/,
    ],
  ] as [string, Starter, RegExp][])('refuses %s', (_name, starter, message) => {
    expect(said([starter])).toMatch(message);
  });

  it('refuses ids that collide, and a plugin the site did not compile in', () => {
    expect(said([base, { ...base }])).toMatch(/must be unique/);
    expect(said([{ ...base, id: 'trade-b2b' }])).toMatch(
      /belongs to a starter Mallok ships/,
    );
    expect(said([base], false)).toMatch(
      /switches on the plugin catalog, which is not in createMallok/,
    );
  });
});
