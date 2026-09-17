import { describe, expect, it } from 'vitest';
import {
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
