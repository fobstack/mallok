import { describe, expect, it } from 'vitest';
import {
  matchPluginRoute,
  PLUGIN_API_VERSION,
  parsePluginManifest,
  settingsValidator,
} from '../../src/core/index.js';

const BASE = {
  id: 'sample',
  name: 'Sample',
  version: '1.0.0',
};

describe('plugin manifest schema', () => {
  it('parses a minimal manifest with defaults applied', () => {
    const manifest = parsePluginManifest(BASE);
    expect(manifest.pluginApi).toBe(PLUGIN_API_VERSION);
    expect(manifest.hooks).toEqual([]);
    expect(manifest.routes).toEqual([]);
    expect(manifest.affectsFragmentCache).toBe(false);
  });

  it('rejects unknown fields instead of silently stripping them', () => {
    expect(() => parsePluginManifest({ ...BASE, official: true })).toThrow(
      /unrecognized|official/i,
    );
    expect(() =>
      parsePluginManifest({
        ...BASE,
        routes: [{ path: 'submit', method: 'POST', cache: true }],
      }),
    ).toThrow(/unrecognized|cache/i);
    expect(() =>
      parsePluginManifest({
        ...BASE,
        settings: { title: { type: 'string', typo: true } },
      }),
    ).toThrow(/unrecognized|typo/i);
  });

  it('uses the real rate-limit contract and rejects duplicate routes', () => {
    expect(
      parsePluginManifest({
        ...BASE,
        routes: [{ path: 'submit', method: 'POST', rateLimit: true }],
      }).routes[0]?.rateLimit,
    ).toBe(true);
    expect(() =>
      parsePluginManifest({
        ...BASE,
        routes: [
          { path: 'submit', method: 'POST' },
          { path: 'submit', method: 'GET' },
        ],
      }),
    ).toThrow(/more than once/i);
  });

  it('rejects a beforeRender hook that does not admit changing fragments', () => {
    expect(() =>
      parsePluginManifest({ ...BASE, hooks: ['beforeRender'] }),
    ).toThrow(/affectsFragmentCache/);
    expect(
      parsePluginManifest({
        ...BASE,
        hooks: ['beforeRender'],
        affectsFragmentCache: true,
      }).affectsFragmentCache,
    ).toBe(true);
  });

  it('rejects a panel table outside the plugin prefix', () => {
    const panel = {
      id: 'rows',
      label: 'Rows',
      type: 'table',
      table: 'content',
      columns: [{ field: 'title', label: 'Title' }],
    };
    expect(() => parsePluginManifest({ ...BASE, panels: [panel] })).toThrow(
      /p_sample_/,
    );
    expect(() =>
      parsePluginManifest({
        ...BASE,
        panels: [{ ...panel, table: 'p_sample_rows' }],
      }),
    ).not.toThrow();
  });

  it('rejects action ids duplicated across panels', () => {
    const panel = (id: string, table: string) => ({
      id,
      label: id,
      type: 'table' as const,
      table,
      columns: [{ field: 'id', label: 'Id' }],
      actions: [{ id: 'archive', label: 'Archive' }],
    });
    expect(() =>
      parsePluginManifest({
        ...BASE,
        panels: [
          panel('first', 'p_sample_first'),
          panel('second', 'p_sample_second'),
        ],
      }),
    ).toThrow(/action.*more than once/i);
  });

  it('rejects panel ids duplicated across the plugin', () => {
    const panel = (table: string) => ({
      id: 'rows',
      label: 'Rows',
      type: 'table' as const,
      table,
      columns: [{ field: 'id', label: 'Id' }],
    });
    expect(() =>
      parsePluginManifest({
        ...BASE,
        panels: [panel('p_sample_first'), panel('p_sample_second')],
      }),
    ).toThrow(/panel.*more than once/i);
  });

  it('rejects a plugin built for a newer plugin API', () => {
    expect(() =>
      parsePluginManifest({ ...BASE, pluginApi: PLUGIN_API_VERSION + 1 }),
    ).toThrow(/plugin API/);
  });

  it('accepts renderData under plugin API 2 and refuses it under 1', () => {
    expect(PLUGIN_API_VERSION).toBe(2);
    expect(
      parsePluginManifest({ ...BASE, pluginApi: 2, hooks: ['renderData'] })
        .hooks,
    ).toEqual(['renderData']);
    // A plugin that says it was written for version 1 cannot have meant a
    // hook version 1 never had; a build that only knew 1 would refuse it too.
    expect(() =>
      parsePluginManifest({ ...BASE, pluginApi: 1, hooks: ['renderData'] }),
    ).toThrow(/renderData hook needs plugin API 2/);
    // Version 1 plugins are untouched by the new version.
    expect(
      parsePluginManifest({ ...BASE, pluginApi: 1, hooks: ['afterRender'] })
        .pluginApi,
    ).toBe(1);
  });

  describe('route paths', () => {
    const routes = (pluginApi: number, ...paths: string[]) => ({
      ...BASE,
      pluginApi,
      routes: paths.map((path) => ({ path, method: 'GET' })),
    });

    it('accepts segments and parameters under plugin API 2', () => {
      const manifest = parsePluginManifest(
        routes(2, 'cart', 'orders/:orderNo', 'items/:sku/notes/:noteId'),
      );
      expect(manifest.routes.map((route) => route.path)).toEqual([
        'cart',
        'orders/:orderNo',
        'items/:sku/notes/:noteId',
      ]);
    });

    it('refuses them under plugin API 1, and keeps what 1 always allowed', () => {
      expect(() => parsePluginManifest(routes(1, 'orders/:orderNo'))).toThrow(
        /needs plugin API 2/,
      );
      expect(() => parsePluginManifest(routes(1, 'orders/list'))).toThrow(
        /needs plugin API 2/,
      );
      // A locale-shaped name was legal in version 1 and stays legal there.
      expect(
        parsePluginManifest(routes(1, 'submit', 'go', 'my-cart')).routes,
      ).toHaveLength(3);
    });

    it('refuses a version 2 route that starts like a locale code', () => {
      for (const path of ['de', 'go', 'zh-hant', 'my-cart', 'en/cart']) {
        expect(() => parsePluginManifest(routes(2, path)), path).toThrow(
          /shape of a locale code/,
        );
      }
      // Only the first segment is ever read as a locale.
      expect(
        parsePluginManifest(routes(2, 'cart/de', 'orders/go')).routes,
      ).toHaveLength(2);
    });

    it('refuses a path it could not match unambiguously', () => {
      for (const path of [
        ':id',
        'orders//new',
        'orders/',
        '/orders',
        'Orders',
        'orders/:order-no',
        'orders/:',
        'orders/:1st',
        'a/b/c/d/e/f/g',
        '',
      ]) {
        expect(() => parsePluginManifest(routes(2, path)), path).toThrow();
      }
      expect(() => parsePluginManifest(routes(2, 'pair/:id/:id'))).toThrow(
        /same parameter twice/,
      );
      expect(() =>
        parsePluginManifest(routes(2, 'orders/:orderNo', 'orders/:id')),
      ).toThrow(/match the same requests/);
    });

    it('matches the most specific route, then the first declared', () => {
      const declared = [
        { path: 'orders/:orderNo' },
        { path: 'orders/new' },
        { path: 'a/:x/c' },
        { path: 'a/b/:y' },
      ];
      expect(matchPluginRoute(declared, ['orders', 'new'])?.route.path).toBe(
        'orders/new',
      );
      expect(matchPluginRoute(declared, ['orders', '7'])).toEqual({
        route: { path: 'orders/:orderNo' },
        params: { orderNo: '7' },
      });
      expect(matchPluginRoute(declared, ['a', 'b', 'c'])?.route.path).toBe(
        'a/:x/c',
      );
      expect(matchPluginRoute(declared, ['orders'])).toBeNull();
      expect(matchPluginRoute(declared, ['orders', '7', 'x'])).toBeNull();
      expect(matchPluginRoute(declared, [])).toBeNull();
    });
  });

  it('rejects an unknown hook name and a bad route method', () => {
    expect(() => parsePluginManifest({ ...BASE, hooks: ['onBoot'] })).toThrow();
    expect(() =>
      parsePluginManifest({
        ...BASE,
        routes: [{ path: 'submit', method: 'DELETE' }],
      }),
    ).toThrow();
  });
});

describe('settingsValidator', () => {
  const manifest = parsePluginManifest({
    ...BASE,
    settings: {
      recipient: { type: 'string', required: true },
      autoreply: { type: 'boolean', default: true },
      mode: { type: 'select', choices: ['a', 'b'] },
      tags: { type: 'string[]' },
    },
  });

  it('accepts values matching the declared fields', () => {
    const parsed = settingsValidator(manifest).safeParse({
      recipient: 'sales@example.com',
      autoreply: false,
      mode: 'a',
      tags: ['x'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown keys, wrong types and bad select values', () => {
    const validator = settingsValidator(manifest);
    expect(validator.safeParse({ recipient: 'a@b.co', extra: 1 }).success).toBe(
      false,
    );
    expect(
      validator.safeParse({ recipient: 'a@b.co', autoreply: 'yes' }).success,
    ).toBe(false);
    expect(
      validator.safeParse({ recipient: 'a@b.co', mode: 'z' }).success,
    ).toBe(false);
    expect(validator.safeParse({}).success).toBe(false);
  });
});
