import { describe, expect, it } from 'vitest';
import {
  parsePluginManifest,
  type RecordField,
  validateRecord,
} from '../../src/core/index.js';

/**
 * The field vocabulary of a plugin's records panel and the validator for
 * what its form submits (docs/PLUGIN_API.md §7.5).
 */

const FIELDS: Record<string, RecordField> = {
  name: { type: 'string', required: true, max: 10 },
  note: { type: 'text', required: false },
  count: { type: 'number', required: false, min: 0, max: 100 },
  on: { type: 'boolean', required: false },
  state: { type: 'select', required: false, choices: ['a', 'b'] },
  day: { type: 'date', required: false },
  tint: { type: 'color', required: false },
  tags: { type: 'string[]', required: false, max: 2 },
  specs: { type: 'keyvalue', required: false },
  price: {
    type: 'money',
    required: false,
    currencies: ['USD', 'JPY'],
    max: 1_000_000,
  },
  lines: {
    type: 'rows',
    required: false,
    max: 2,
    fields: {
      sku: { type: 'string', required: true },
      cost: { type: 'money', required: false, currencies: ['USD'] },
    },
  },
};

describe('validateRecord', () => {
  it('passes a full record through, in declared order, nothing else', () => {
    const input = {
      lines: [{ sku: 'A', cost: { amount: 5, currency: 'USD', extra: 1 } }],
      price: { amount: 9900, currency: 'USD' },
      specs: { grade: '5' },
      tags: ['x', 'y'],
      tint: '#aabbcc',
      day: '2026-10-05',
      state: 'b',
      on: false,
      count: 0,
      note: 'n',
      name: 'Bar',
      undeclared: 'dropped',
    };
    const { values, errors } = validateRecord(FIELDS, input);
    expect(errors).toEqual({});
    expect(Object.keys(values)).toEqual(Object.keys(FIELDS));
    expect(values).toEqual({
      name: 'Bar',
      note: 'n',
      count: 0,
      on: false,
      state: 'b',
      day: '2026-10-05',
      tint: '#aabbcc',
      tags: ['x', 'y'],
      specs: { grade: '5' },
      price: { amount: 9900, currency: 'USD' },
      // A money value is exactly its two members.
      lines: [{ sku: 'A', cost: { amount: 5, currency: 'USD' } }],
    });
  });

  it('turns every empty optional value into null, and empty rows into none', () => {
    const { values, errors } = validateRecord(FIELDS, {
      name: 'Bar',
      note: '',
      count: null,
      tags: [],
    });
    expect(errors).toEqual({});
    expect(values).toEqual({
      name: 'Bar',
      note: null,
      count: null,
      on: null,
      state: null,
      day: null,
      tint: null,
      tags: null,
      specs: null,
      price: null,
      lines: [],
    });
  });

  it('says what is wrong with each field', () => {
    const { errors } = validateRecord(FIELDS, {
      name: 'much too long a name',
      note: 7,
      count: 101,
      on: 'true',
      state: 'c',
      day: '05/10/2026',
      tint: 'red',
      tags: ['a', 'b', 'c'],
      specs: { grade: 5 },
      price: { amount: 1_000_001, currency: 'USD' },
      lines: [{ sku: '' }, 'not a row'],
    });
    expect(errors).toEqual({
      name: 'Must be at most 10 characters.',
      note: 'Must be text.',
      count: 'Must be at most 100.',
      on: 'Must be yes or no.',
      state: 'Choose one of the listed values.',
      day: 'Enter a date as YYYY-MM-DD.',
      tint: 'Enter a colour as #rrggbb.',
      tags: 'At most 2 entries.',
      specs: 'Must be a set of name and value pairs.',
      price: 'The amount is too high.',
      'lines.0.sku': 'This field is required.',
      'lines.1.sku': 'This field is required.',
    });
  });

  it('holds money to whole minor units in a listed currency', () => {
    const price = (value: unknown) =>
      validateRecord(FIELDS, { name: 'x', price: value }).errors.price;
    expect(price({ amount: 0, currency: 'JPY' })).toBeUndefined();
    // A float would lose a cent somewhere between here and the invoice.
    expect(price({ amount: 19.99, currency: 'USD' })).toBe('Enter an amount.');
    expect(price({ amount: Number.NaN, currency: 'USD' })).toBe(
      'Enter an amount.',
    );
    expect(price({ amount: 2 ** 60, currency: 'USD' })).toBe(
      'Enter an amount.',
    );
    expect(price({ amount: '100', currency: 'USD' })).toBe('Enter an amount.');
    expect(price(100)).toBe('Enter an amount.');
    expect(price({ amount: 100, currency: 'EUR' })).toBe(
      'Choose one of the listed currencies.',
    );
    expect(price({ amount: 100 })).toBe('Choose one of the listed currencies.');
    // Negative amounts are refused unless the field says otherwise.
    expect(price({ amount: -1, currency: 'USD' })).toBe(
      'The amount is too low.',
    );
    expect(
      validateRecord(
        {
          refund: {
            type: 'money',
            required: false,
            currencies: ['USD'],
            min: -500,
          },
        },
        { refund: { amount: -500, currency: 'USD' } },
      ).errors,
    ).toEqual({});
  });

  it('bounds rows, and requires them when the field does', () => {
    expect(
      validateRecord(FIELDS, {
        name: 'x',
        lines: [{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }],
      }).errors,
    ).toEqual({ lines: 'At most 2 rows.' });
    expect(
      validateRecord(FIELDS, { name: 'x', lines: 'three' }).errors,
    ).toEqual({ lines: 'Must be a list of rows.' });
    const required: Record<string, RecordField> = {
      lines: {
        type: 'rows',
        required: true,
        fields: { sku: { type: 'string', required: false } },
      },
    };
    expect(validateRecord(required, {}).errors).toEqual({
      lines: 'Add at least one row.',
    });
    expect(validateRecord(required, { lines: [{}] }).errors).toEqual({});
  });
});

describe('a records panel in plugin.json', () => {
  const Base = { id: 'shop', name: 'Shop', version: '1.0.0' };
  const panel = (extra: Record<string, unknown>) => ({
    id: 'items',
    label: 'Items',
    table: 'p_shop_item',
    columns: [{ field: 'name', label: 'Name' }],
    ...extra,
  });
  const manifest = (pluginApi: number, extra: Record<string, unknown>) => ({
    ...Base,
    pluginApi,
    panels: [panel(extra)],
  });
  const fields = { name: { type: 'string' } };

  it('is accepted with its fields under plugin API 2', () => {
    const parsed = parsePluginManifest(
      manifest(2, {
        type: 'records',
        search: ['name'],
        columns: [{ field: 'name', label: 'Name', sortable: true }],
        fields: {
          name: { type: 'string', required: true },
          price: { type: 'money', currencies: ['USD'] },
          lines: { type: 'rows', fields: { sku: { type: 'string' } } },
        },
      }),
    ).panels[0];
    expect(parsed?.type).toBe('records');
    expect(parsed?.columns[0]?.sortable).toBe(true);
    expect(parsed?.fields?.price?.type).toBe('money');
  });

  it('leaves a version 1 table panel as it was, and keeps the new parts out of version 1', () => {
    const table = parsePluginManifest(manifest(1, { type: 'table' })).panels[0];
    expect(table).toMatchObject({ type: 'table', search: [] });
    expect(table?.columns[0]?.sortable).toBe(false);
    expect(table?.fields).toBeUndefined();

    expect(() =>
      parsePluginManifest(manifest(1, { type: 'records', fields })),
    ).toThrow(/records panel, which needs plugin API 2/);
    expect(() =>
      parsePluginManifest(manifest(1, { type: 'table', search: ['name'] })),
    ).toThrow(/sorting or search, which needs plugin API 2/);
    expect(() =>
      parsePluginManifest(
        manifest(1, {
          type: 'table',
          columns: [{ field: 'name', label: 'Name', sortable: true }],
        }),
      ),
    ).toThrow(/sorting or search, which needs plugin API 2/);
  });

  it('refuses a declaration the admin could not build a form from', () => {
    for (const extra of [
      { type: 'records' },
      { type: 'records', fields: {} },
      { type: 'table', fields },
      { type: 'records', fields: { price: { type: 'money' } } },
      {
        type: 'records',
        fields: { price: { type: 'money', currencies: ['usd'] } },
      },
      {
        type: 'records',
        fields: { name: { type: 'string', currencies: ['USD'] } },
      },
      { type: 'records', fields: { state: { type: 'select' } } },
      { type: 'records', fields: { lines: { type: 'rows' } } },
      { type: 'records', fields: { lines: { type: 'rows', fields: {} } } },
      {
        type: 'records',
        fields: {
          lines: {
            type: 'rows',
            fields: {
              nested: { type: 'rows', fields: { a: { type: 'string' } } },
            },
          },
        },
      },
      { type: 'records', fields: { 'Bad-Name': { type: 'string' } } },
      { type: 'records', fields: { photo: { type: 'image' } } },
      { type: 'records', fields, search: ['name; DROP TABLE x'] },
    ]) {
      expect(
        () => parsePluginManifest(manifest(2, extra)),
        JSON.stringify(extra),
      ).toThrow();
    }
  });

  it('takes action parameters and related tables under plugin API 2', () => {
    const extra = {
      type: 'table',
      actions: [
        {
          id: 'ship',
          label: 'Ship',
          params: { tracking_no: { type: 'string', required: true } },
        },
      ],
      related: [
        {
          id: 'lines',
          label: 'Lines',
          table: 'p_shop_order_line',
          foreignKey: 'order_id',
          columns: [{ field: 'sku', label: 'SKU' }],
        },
      ],
    };
    const parsed = parsePluginManifest(manifest(2, extra)).panels[0];
    expect(parsed?.actions[0]?.params?.tracking_no?.type).toBe('string');
    expect(parsed?.related[0]?.foreignKey).toBe('order_id');
    expect(
      parsePluginManifest(manifest(1, { type: 'table' })).panels[0],
    ).toMatchObject({ related: [] });

    expect(() => parsePluginManifest(manifest(1, extra))).toThrow(
      /action parameters or related rows, which need plugin API 2/,
    );
    for (const bad of [
      // A child table outside the plugin's own prefix.
      { related: [{ ...extra.related[0], table: 'content' }] },
      { related: [{ ...extra.related[0], foreignKey: 'id; DROP' }] },
      { related: [extra.related[0], extra.related[0]] },
      { related: [{ ...extra.related[0], columns: [] }] },
      // A prompt is a few values, not a table; and a download has no form.
      {
        actions: [
          {
            id: 'ship',
            label: 'Ship',
            params: {
              lines: { type: 'rows', fields: { a: { type: 'string' } } },
            },
          },
        ],
      },
      {
        actions: [
          {
            id: 'csv',
            label: 'CSV',
            type: 'download',
            params: { a: { type: 'string' } },
          },
        ],
      },
    ]) {
      expect(
        () => parsePluginManifest(manifest(2, { type: 'table', ...bad })),
        JSON.stringify(bad),
      ).toThrow();
    }
  });
});
