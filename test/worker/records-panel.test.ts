import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { catalogPlugin } from '../fixtures/catalog-plugin.js';

/**
 * Editable `records` panels, sorting and search
 * (docs/PLUGIN_API.md §7.5).
 *
 * A plugin ships no admin code. It declares the fields of a record and
 * provides `load`, `save` and optionally `remove`; the admin's API checks
 * what is submitted against the declaration and hands it to those handlers.
 * The admin never writes to a plugin's table itself.
 */

const ORIGIN = 'https://records-panel.example';
const EMAIL = 'records@example.com';
const PASSWORD = 'a sufficiently long password';
const BASE = '/_mallok/api/plugins/catalog/panels/items';

const tokens: Record<string, string> = {};

function api(
  method: string,
  path: string,
  body?: unknown,
  token = tokens.all ?? '',
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Grade 5 bar',
    code: 'TI-BAR',
    status: 'active',
    price: { amount: 9900, currency: 'USD' },
    featured: true,
    variants: [
      { sku: 'TI-BAR-10', stock: 12, price: { amount: 9900, currency: 'USD' } },
      { sku: 'TI-BAR-20', stock: null, price: null },
    ],
    ...overrides,
  };
}

async function create(values: Record<string, unknown>): Promise<string> {
  const response = await api('POST', `${BASE}/records`, { values });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function list(query = ''): Promise<Record<string, unknown>[]> {
  const response = await api('GET', `${BASE}${query}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { rows: Record<string, unknown>[] }).rows;
}

describe('records panels', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };
  let firstId = '';

  beforeAll(async () => {
    configure({
      theme: original.theme,
      plugins: [inquiryPlugin, catalogPlugin],
    });
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
    const mint = async (name: string, scopes: string[]) => {
      const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
        method: 'POST',
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name, scopes }),
      });
      tokens[name] = ((await minted.json()) as { token: string }).token;
    };
    await mint('all', ['content:write', 'settings:write', 'export']);
    await mint('reader', ['export']);
    await mint('writer', ['content:write']);
    await api('POST', '/_mallok/api/plugins/catalog/enabled', {
      enabled: true,
    });
  });

  afterAll(() => {
    configure(original);
    resetBootForTests();
  });

  it('tells the admin what to build, and whether a panel can delete', async () => {
    const { plugins } = (await (
      await api('GET', '/_mallok/api/plugins')
    ).json()) as {
      plugins: {
        id: string;
        panels: {
          id: string;
          type: string;
          canRemove: boolean;
          search: string[];
          fields?: Record<string, { type: string }>;
          columns: { field: string; sortable: boolean }[];
        }[];
      }[];
    };
    const panels =
      plugins.find((plugin) => plugin.id === 'catalog')?.panels ?? [];
    expect(
      panels.map((panel) => [panel.id, panel.type, panel.canRemove]),
    ).toEqual([
      ['items', 'records', true],
      ['log', 'records', false],
    ]);
    expect(panels[0]?.fields?.price?.type).toBe('money');
    expect(panels[0]?.fields?.variants?.type).toBe('rows');
    expect(panels[0]?.search).toEqual(['name', 'code']);
    // The inquiry panel is what it always was.
    const inquiry = plugins.find((plugin) => plugin.id === 'inquiry')
      ?.panels[0];
    expect(inquiry).toMatchObject({
      id: 'inquiries',
      type: 'table',
      canRemove: false,
      search: [],
    });
    expect(inquiry?.fields).toBeUndefined();
    expect(inquiry?.columns.every((column) => !column.sortable)).toBe(true);
  });

  describe('creating and editing', () => {
    it('creates a record through the plugin, money and rows intact', async () => {
      firstId = await create(item());
      const stored = await env.DB.prepare(
        'SELECT name, code, price_amount, price_currency, featured FROM p_catalog_item WHERE id = ?',
      )
        .bind(firstId)
        .first();
      expect(stored).toEqual({
        name: 'Grade 5 bar',
        code: 'TI-BAR',
        price_amount: 9900,
        price_currency: 'USD',
        featured: 1,
      });
      const variants = await env.DB.prepare(
        'SELECT sku, stock, price_amount FROM p_catalog_variant WHERE item_id = ? ORDER BY position',
      )
        .bind(firstId)
        .all();
      expect(variants.results).toEqual([
        { sku: 'TI-BAR-10', stock: 12, price_amount: 9900 },
        { sku: 'TI-BAR-20', stock: null, price_amount: null },
      ]);
    });

    it('loads a record for editing in the shape it was saved', async () => {
      const response = await api('GET', `${BASE}/records/${firstId}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: firstId, values: item() });
      expect((await api('GET', `${BASE}/records/no-such-record`)).status).toBe(
        404,
      );
    });

    it('edits a record, adding and removing rows', async () => {
      const edited = item({
        name: 'Grade 5 bar, annealed',
        price: { amount: 10500, currency: 'EUR' },
        featured: false,
        variants: [
          { sku: 'TI-BAR-20', stock: 4, price: null },
          {
            sku: 'TI-BAR-30',
            stock: 0,
            price: { amount: 12000, currency: 'EUR' },
          },
          { sku: 'TI-BAR-40', stock: null, price: null },
        ],
      });
      const response = await api('PUT', `${BASE}/records/${firstId}`, {
        values: edited,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: firstId });
      expect(
        await (await api('GET', `${BASE}/records/${firstId}`)).json(),
      ).toEqual({ id: firstId, values: edited });
      // Still one item: an edit is not a second record.
      expect(await list()).toHaveLength(1);
    });

    it('refuses what the declaration does not allow, field by field, before the plugin runs', async () => {
      const response = await api('POST', `${BASE}/records`, {
        values: {
          name: '',
          code: 'x'.repeat(5),
          status: 'retired',
          price: { amount: 99.5, currency: 'USD' },
          featured: 'yes',
          variants: [
            { sku: '', stock: -1, price: { amount: 100, currency: 'GBP' } },
            { sku: 'OK', stock: 1, price: null },
          ],
        },
      });
      expect(response.status).toBe(422);
      expect(
        ((await response.json()) as { errors: Record<string, string> }).errors,
      ).toEqual({
        name: 'This field is required.',
        status: 'Choose one of the listed values.',
        price: 'Enter an amount.',
        featured: 'Must be yes or no.',
        'variants.0.sku': 'This field is required.',
        'variants.0.stock': 'Must be at least 0.',
        'variants.0.price': 'Choose one of the listed currencies.',
      });
      expect(await list()).toHaveLength(1);

      const tooMany = await api('POST', `${BASE}/records`, {
        values: item({
          code: 'MANY',
          variants: Array.from({ length: 4 }, (_, index) => ({
            sku: `S${index}`,
            stock: null,
            price: null,
          })),
        }),
      });
      expect(
        ((await tooMany.json()) as { errors: Record<string, string> }).errors,
      ).toEqual({ variants: 'At most 3 rows.' });
      for (const body of [{}, { values: [] }, { values: 'x' }]) {
        expect((await api('POST', `${BASE}/records`, body)).status).toBe(400);
      }
    });

    it("shows the plugin's own refusal on the field it names", async () => {
      const response = await api('POST', `${BASE}/records`, {
        values: item({ name: 'A second bar' }),
      });
      expect(response.status).toBe(422);
      expect(
        ((await response.json()) as { errors: Record<string, string> }).errors,
      ).toEqual({ code: 'Another item already uses this code.' });
    });

    it('never hands a plugin a field it did not declare', async () => {
      const id = await create(
        item({
          code: 'TI-EXTRA',
          id: 'forged',
          created_at: '1999-01-01',
          price_label: 'free',
        }),
      );
      expect(id).not.toBe('forged');
      const row = await env.DB.prepare(
        'SELECT price_label, created_at FROM p_catalog_item WHERE id = ?',
      )
        .bind(id)
        .first<{ price_label: string; created_at: string }>();
      expect(row?.price_label).toBe('USD 99.00');
      expect(row?.created_at.startsWith('1999')).toBe(false);

      // And the handler itself sees only declared fields, whatever was sent.
      const logged = await api(
        'POST',
        '/_mallok/api/plugins/catalog/panels/log/records',
        { values: { note: 'n', id: 'forged', seen_keys: 'forged', extra: 1 } },
      );
      const logId = ((await logged.json()) as { id: string }).id;
      const seen = await env.DB.prepare(
        'SELECT seen_keys FROM p_catalog_log WHERE id = ?',
      )
        .bind(logId)
        .first<{ seen_keys: string }>();
      expect(seen?.seen_keys).toBe('note');
    });

    it('deletes through the plugin, and only where the plugin can', async () => {
      const id = await create(item({ code: 'TI-GONE' }));
      const removed = await api('DELETE', `${BASE}/records/${id}`);
      expect(await removed.json()).toEqual({ ok: true, id });
      expect((await api('GET', `${BASE}/records/${id}`)).status).toBe(404);
      const orphans = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM p_catalog_variant WHERE item_id = ?',
      )
        .bind(id)
        .first<{ n: number }>();
      expect(orphans?.n).toBe(0);

      // A panel with no `remove` handler has no delete.
      const logBase = '/_mallok/api/plugins/catalog/panels/log/records';
      const created = await api('POST', logBase, { values: { note: 'kept' } });
      const logId = ((await created.json()) as { id: string }).id;
      expect((await api('DELETE', `${logBase}/${logId}`)).status).toBe(405);
      expect(await (await api('GET', `${logBase}/${logId}`)).json()).toEqual({
        id: logId,
        values: { note: 'kept' },
      });
    });
  });

  describe('scopes', () => {
    it('reads with export and writes with content:write, and not the other way round', async () => {
      const values = item({ code: 'TI-SCOPE' });
      // A reader may open a record and may not change anything.
      expect(
        (
          await api(
            'GET',
            `${BASE}/records/${firstId}`,
            undefined,
            tokens.reader,
          )
        ).status,
      ).toBe(200);
      for (const [method, path] of [
        ['POST', `${BASE}/records`],
        ['PUT', `${BASE}/records/${firstId}`],
        ['DELETE', `${BASE}/records/${firstId}`],
      ] as const) {
        const response = await api(method, path, { values }, tokens.reader);
        expect(response.status, method).toBe(403);
      }
      // A writer may save and may not read buyers' or anyone's rows.
      expect(
        (
          await api(
            'GET',
            `${BASE}/records/${firstId}`,
            undefined,
            tokens.writer,
          )
        ).status,
      ).toBe(403);
      expect((await api('GET', BASE, undefined, tokens.writer)).status).toBe(
        403,
      );
      expect(
        (await api('POST', `${BASE}/records`, { values }, tokens.writer))
          .status,
      ).toBe(201);
    });

    it('answers 404 for a records path on a panel that has none', async () => {
      expect(
        (
          await api(
            'POST',
            '/_mallok/api/plugins/inquiry/panels/inquiries/records',
            { values: {} },
          )
        ).status,
      ).toBe(404);
      expect(
        (await api('PATCH', `${BASE}/records/${firstId}`, { values: {} }))
          .status,
      ).toBe(405);
    });
  });

  describe('sorting and search', () => {
    beforeAll(async () => {
      await env.DB.prepare('DELETE FROM p_catalog_item').run();
      for (const [name, code] of [
        ['Charlie plate', 'C-1'],
        ['alpha bar', 'A-1'],
        ['Bravo 50% sheet', 'B_1'],
      ] as const) {
        await create(item({ name, code, variants: [] }));
      }
    });

    it('orders by a column the panel marks sortable, either way', async () => {
      expect((await list('?sort=code')).map((row) => row.code)).toEqual([
        'A-1',
        'B_1',
        'C-1',
      ]);
      expect(
        (await list('?sort=code&dir=desc')).map((row) => row.code),
      ).toEqual(['C-1', 'B_1', 'A-1']);
    });

    it('ignores a sort it was not offered, rather than passing it to SQL', async () => {
      const usual = (await list()).map((row) => row.code);
      for (const sort of [
        'price_label',
        'created_at',
        'id; DROP TABLE p_catalog_item',
        'name DESC, (SELECT 1)',
      ]) {
        expect(
          (await list(`?sort=${encodeURIComponent(sort)}`)).map(
            (row) => row.code,
          ),
          sort,
        ).toEqual(usual);
      }
      expect(await list()).toHaveLength(3);
    });

    it('searches the declared columns by substring, wildcards taken literally', async () => {
      const found = async (term: string) =>
        (await list(`?q=${encodeURIComponent(term)}&sort=code`)).map(
          (row) => row.code,
        );
      expect(await found('plate')).toEqual(['C-1']);
      expect(await found('ALPHA')).toEqual(['A-1']);
      expect(await found('-1')).toEqual(['A-1', 'C-1']);
      // `%` and `_` are what was typed, not patterns.
      expect(await found('50%')).toEqual(['B_1']);
      expect(await found('%')).toEqual(['B_1']);
      expect(await found('B_1')).toEqual(['B_1']);
      expect(await found('_')).toEqual(['B_1']);
      // `status` is not a search column.
      expect(await found('active')).toEqual([]);
      expect(await found('   ')).toEqual(['A-1', 'B_1', 'C-1']);
    });

    it('leaves a panel that declares neither exactly as it was', async () => {
      const inquiries = '/_mallok/api/plugins/inquiry/panels/inquiries';
      const plain = await (await api('GET', inquiries)).json();
      expect(
        await (await api('GET', `${inquiries}?q=anything&sort=name`)).json(),
      ).toEqual(plain);
    });
  });
});
