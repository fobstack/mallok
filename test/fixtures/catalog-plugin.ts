/**
 * A plugin with a records panel, as a site would write one.
 *
 * Shared by the Worker tests and the browser tests, which both need a real
 * plugin whose data the admin creates and edits: a product with a price and
 * a repeatable list of variants, kept in two tables of its own. The admin
 * never touches those tables; every write below is the plugin's.
 */

import { definePlugin } from '../../src/plugins/define.js';
import type { MoneyValue, PluginContext } from '../../src/plugins/types.js';

interface Variant {
  readonly sku: string;
  readonly stock: number | null;
  readonly price: MoneyValue | null;
}

async function variantsOf(ctx: PluginContext, id: string): Promise<Variant[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT sku, stock, price_amount, price_currency
         FROM p_catalog_variant WHERE item_id = ? ORDER BY position`,
    )
    .bind(id)
    .all<{
      sku: string;
      stock: number | null;
      price_amount: number | null;
      price_currency: string | null;
    }>();
  return rows.results.map((row) => ({
    sku: row.sku,
    stock: row.stock,
    price:
      row.price_amount === null || row.price_currency === null
        ? null
        : { amount: row.price_amount, currency: row.price_currency },
  }));
}

export const catalogPlugin = definePlugin({
  manifest: {
    id: 'catalog',
    name: 'Catalog',
    version: '1.0.0',
    description: 'A test plugin: products with a price and variants.',
    pluginApi: 2,
    panels: [
      {
        id: 'items',
        label: 'Catalog items',
        type: 'records',
        table: 'p_catalog_item',
        orderBy: 'created_at',
        search: ['name', 'code'],
        columns: [
          { field: 'name', label: 'Name', sortable: true },
          { field: 'code', label: 'Code', sortable: true },
          { field: 'price_label', label: 'Price' },
          { field: 'status', label: 'Status', type: 'badge' },
        ],
        fields: {
          name: { type: 'string', label: 'Name', required: true, max: 80 },
          code: {
            type: 'string',
            label: 'Code',
            required: true,
            help: 'Unique across the catalog.',
          },
          status: {
            type: 'select',
            label: 'Status',
            required: true,
            choices: ['active', 'archived'],
          },
          price: {
            type: 'money',
            label: 'Price',
            required: true,
            currencies: ['USD', 'EUR'],
          },
          featured: { type: 'boolean', label: 'Featured' },
          variants: {
            type: 'rows',
            label: 'Variants',
            max: 3,
            fields: {
              sku: { type: 'string', label: 'SKU', required: true },
              stock: { type: 'number', label: 'Stock', min: 0 },
              price: {
                type: 'money',
                label: 'Variant price',
                currencies: ['USD', 'EUR'],
              },
            },
          },
        },
      },
      {
        id: 'log',
        label: 'Catalog log',
        type: 'records',
        table: 'p_catalog_log',
        columns: [{ field: 'note', label: 'Note' }],
        fields: { note: { type: 'text', label: 'Note', required: true } },
      },
    ],
  },
  migrations: [
    {
      id: 'plugin:catalog:0001_init',
      sql: `
        CREATE TABLE p_catalog_item (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          code TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          price_amount INTEGER NOT NULL,
          price_currency TEXT NOT NULL,
          price_label TEXT NOT NULL,
          featured INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE p_catalog_variant (
          item_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          sku TEXT NOT NULL,
          stock INTEGER,
          price_amount INTEGER,
          price_currency TEXT,
          PRIMARY KEY (item_id, position)
        );
        CREATE TABLE p_catalog_log (
          id TEXT PRIMARY KEY,
          note TEXT NOT NULL,
          seen_keys TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `,
    },
  ],
  records: {
    items: {
      load: async (id, ctx) => {
        const row = await ctx.db
          .prepare('SELECT * FROM p_catalog_item WHERE id = ?')
          .bind(id)
          .first<{
            name: string;
            code: string;
            status: string;
            price_amount: number;
            price_currency: string;
            featured: number;
          }>();
        if (row === null) {
          return null;
        }
        return {
          name: row.name,
          code: row.code,
          status: row.status,
          price: { amount: row.price_amount, currency: row.price_currency },
          featured: row.featured === 1,
          variants: await variantsOf(ctx, id),
        };
      },
      save: async (record, ctx) => {
        const values = record.values as {
          name: string;
          code: string;
          status: string;
          price: MoneyValue;
          featured: boolean | null;
          variants: Variant[];
        };
        // What only the plugin can know: the code has to be unique.
        const taken = await ctx.db
          .prepare('SELECT id FROM p_catalog_item WHERE code = ?')
          .bind(values.code)
          .first<{ id: string }>();
        if (taken !== null && taken.id !== record.id) {
          return { errors: { code: 'Another item already uses this code.' } };
        }
        const id = record.id ?? crypto.randomUUID();
        const label = `${values.price.currency} ${(values.price.amount / 100).toFixed(2)}`;
        await ctx.db.batch([
          ctx.db
            .prepare(
              `INSERT INTO p_catalog_item
                 (id, name, code, status, price_amount, price_currency,
                  price_label, featured, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET
                 name = excluded.name, code = excluded.code,
                 status = excluded.status,
                 price_amount = excluded.price_amount,
                 price_currency = excluded.price_currency,
                 price_label = excluded.price_label,
                 featured = excluded.featured`,
            )
            .bind(
              id,
              values.name,
              values.code,
              values.status,
              values.price.amount,
              values.price.currency,
              label,
              values.featured === true ? 1 : 0,
              new Date().toISOString(),
            ),
          ctx.db
            .prepare('DELETE FROM p_catalog_variant WHERE item_id = ?')
            .bind(id),
          ...values.variants.map((variant, position) =>
            ctx.db
              .prepare(
                `INSERT INTO p_catalog_variant
                   (item_id, position, sku, stock, price_amount, price_currency)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                id,
                position,
                variant.sku,
                variant.stock,
                variant.price?.amount ?? null,
                variant.price?.currency ?? null,
              ),
          ),
        ]);
        return { id };
      },
      remove: async (id, ctx) => {
        await ctx.db.batch([
          ctx.db.prepare('DELETE FROM p_catalog_item WHERE id = ?').bind(id),
          ctx.db
            .prepare('DELETE FROM p_catalog_variant WHERE item_id = ?')
            .bind(id),
        ]);
      },
    },
    // No `remove`: the admin must offer no delete for this panel.
    log: {
      load: async (id, ctx) =>
        ctx.db
          .prepare('SELECT note FROM p_catalog_log WHERE id = ?')
          .bind(id)
          .first<{ note: string }>(),
      save: async (record, ctx) => {
        const id = record.id ?? crypto.randomUUID();
        await ctx.db
          .prepare(
            `INSERT INTO p_catalog_log (id, note, seen_keys, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               note = excluded.note, seen_keys = excluded.seen_keys`,
          )
          .bind(
            id,
            String(record.values.note),
            // Exactly what the handler was handed, so a test can see it.
            Object.keys(record.values).sort().join(','),
            new Date().toISOString(),
          )
          .run();
        return { id };
      },
    },
  },
});
