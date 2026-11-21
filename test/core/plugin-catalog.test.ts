import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from '../../src/core/plugin.js';
import {
  localizePluginManifest,
  panelWords,
  pluginCatalogAllows,
} from '../../src/core/plugin-catalog.js';

/**
 * A plugin's admin catalog (docs/PLUGIN_API.md §7.8): its declarations in
 * the operator's language. Only words change, a missing key keeps the
 * declared English, and a key that names nothing the plugin declares is
 * refused.
 */

const manifest = parsePluginManifest({
  id: 'shop',
  name: 'Shop',
  version: '1.0.0',
  description: 'Orders.',
  pluginApi: 2,
  settings: {
    recipient: { type: 'string', label: 'Recipient', help: 'Who hears.' },
  },
  secrets: { api_key: { label: 'API key' } },
  panels: [
    {
      id: 'orders',
      label: 'Orders',
      type: 'records',
      table: 'p_shop_order',
      columns: [
        { field: 'code', label: 'Code' },
        { field: 'status', label: 'Status', type: 'badge' },
      ],
      filters: ['status'],
      detail: ['note'],
      search: ['code'],
      fields: {
        code: { type: 'string', label: 'Code', required: true },
        lines: {
          type: 'rows',
          label: 'Lines',
          fields: { sku: { type: 'string', label: 'SKU' } },
        },
      },
      actions: [
        {
          id: 'ship',
          label: 'Ship',
          params: { tracking: { type: 'string', label: 'Tracking' } },
        },
      ],
      related: [
        {
          id: 'items',
          label: 'Items',
          table: 'p_shop_item',
          foreignKey: 'order_id',
          columns: [{ field: 'sku', label: 'SKU' }],
        },
      ],
    },
  ],
  clientScripts: [{ src: 'https://x.example/a.js', purpose: 'Payments.' }],
});

describe('pluginCatalogAllows', () => {
  const allows = pluginCatalogAllows(manifest);

  it('allows a key for every declared word', () => {
    for (const key of [
      'name',
      'description',
      'settings.recipient.label',
      'settings.recipient.help',
      'secrets.api_key.label',
      'scripts.https://x.example/a.js.purpose',
      'panels.orders.label',
      'panels.orders.columns.status',
      'panels.orders.names.status',
      'panels.orders.names.note',
      'panels.orders.names.code',
      'panels.orders.fields.code.label',
      'panels.orders.fields.lines.fields.sku.label',
      'panels.orders.actions.ship.label',
      'panels.orders.actions.ship.params.tracking.label',
      'panels.orders.related.items.label',
      'panels.orders.related.items.columns.sku',
    ]) {
      expect(allows(key), key).toBe(true);
    }
  });

  it('allows any value of a badge column, and nothing undeclared', () => {
    expect(allows('panels.orders.values.status.shipped')).toBe(true);
    expect(allows('panels.orders.values.code.x')).toBe(false);
    expect(allows('panels.orders.values.status.')).toBe(false);
    expect(allows('settings.recipient.labl')).toBe(false);
    expect(allows('panels.order.label')).toBe(false);
    // `help` is a key only where the plugin wrote help to replace.
    expect(allows('panels.orders.fields.code.help')).toBe(false);
  });
});

describe('localizePluginManifest', () => {
  const localized = localizePluginManifest(manifest, {
    name: '商店',
    'settings.recipient.label': '收件人',
    'secrets.api_key.label': 'API 密钥',
    'panels.orders.label': '订单',
    'panels.orders.columns.status': '状态',
    'panels.orders.fields.lines.fields.sku.label': '货号',
    'panels.orders.actions.ship.label': '发货',
    'panels.orders.actions.ship.params.tracking.label': '运单号',
    'panels.orders.related.items.label': '明细',
  });

  it('puts every catalogued word in place', () => {
    expect(localized.name).toBe('商店');
    expect(localized.settings.recipient?.label).toBe('收件人');
    expect(localized.secrets.api_key?.label).toBe('API 密钥');
    const panel = localized.panels[0];
    expect(panel?.label).toBe('订单');
    expect(panel?.columns.map((column) => column.label)).toEqual([
      'Code',
      '状态',
    ]);
    const lines = panel?.fields?.lines;
    expect(lines?.type === 'rows' ? lines.fields.sku?.label : null).toBe(
      '货号',
    );
    expect(panel?.actions[0]?.label).toBe('发货');
    expect(panel?.actions[0]?.params?.tracking?.label).toBe('运单号');
    expect(panel?.related[0]?.label).toBe('明细');
  });

  it('keeps the declared English for a key the catalog lacks', () => {
    expect(localized.description).toBe('Orders.');
    expect(localized.settings.recipient?.help).toBe('Who hears.');
    expect(localized.panels[0]?.fields?.code?.label).toBe('Code');
  });

  it('changes words only', () => {
    const panel = localized.panels[0];
    expect(panel?.table).toBe('p_shop_order');
    expect(panel?.columns[1]?.type).toBe('badge');
    expect(panel?.fields?.code?.required).toBe(true);
    expect(manifest.panels[0]?.label).toBe('Orders');
  });

  it('returns the manifest itself for an empty catalog', () => {
    expect(localizePluginManifest(manifest, {})).toBe(manifest);
  });
});

describe('panelWords', () => {
  it("collects a panel's field names and badge values, and nothing else", () => {
    expect(
      panelWords('orders', {
        'panels.orders.names.status': '状态',
        'panels.orders.values.status.new': '新询盘',
        'panels.orders.values.status.shipped': '已发货',
        'panels.orders.values.status.empty': '',
        'panels.other.names.x': 'no',
        'panels.orders.label': 'no',
      }),
    ).toEqual({
      names: { status: '状态' },
      values: { status: { new: '新询盘', shipped: '已发货' } },
    });
  });

  it("carries the panel's empty sentence, which the catalog may name", () => {
    expect(pluginCatalogAllows(manifest)('panels.orders.empty')).toBe(true);
    expect(pluginCatalogAllows(manifest)('panels.missing.empty')).toBe(false);
    expect(
      panelWords('orders', { 'panels.orders.empty': '还没有订单。' }).empty,
    ).toBe('还没有订单。');
    expect(
      panelWords('orders', { 'panels.orders.empty': '' }),
    ).not.toHaveProperty('empty');
  });
});
