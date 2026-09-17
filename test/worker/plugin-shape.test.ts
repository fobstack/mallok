import { createExecutionContext, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  definePlugin,
  isOfficialPlugin,
  normalizePlugins,
} from '../../src/plugins/define.js';
import type { MallokPlugin } from '../../src/plugins/types.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import {
  collectPluginExports,
  enforcePluginRouteNoStore,
  handlePluginRoute,
} from '../../src/worker/plugin-runtime.js';

/**
 * What happens to a plugin that is not shaped the way the runtime assumes.
 *
 * `docs/PLUGIN_API.md` says official and third-party plugins use the same
 * mechanism and that there is no private interface. The runtime took that
 * literally in the wrong direction: it read `manifest.hooks.includes(...)`
 * and `Object.entries(manifest.settings)` directly, so a manifest missing
 * either field — which is every hand-written one, since both are optional in
 * the prose — threw `TypeError: Cannot read properties of undefined` from
 * inside Mallok, on a visitor request, naming nothing the author could act
 * on.
 *
 * `definePlugin` is where a plugin gets checked and normalised, once, at
 * module scope: a build fails rather than a request. It fills the defaults
 * the runtime assumed were always there, and refuses what it cannot fix —
 * with a message naming the plugin and the field.
 */

/** The message and the hint together, which is what a reader sees. */
function said(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    const failure = error as Error & { hint?: string };
    return `${failure.message}\n${failure.hint ?? ''}`;
  }
  throw new Error('expected a refusal');
}

/** A manifest with only what `plugin.json` genuinely requires. */
const MINIMAL = {
  id: 'acme',
  name: 'Acme',
  version: '1.0.0',
  pluginApi: 1,
};

describe('definePlugin fills in what the runtime assumes', () => {
  it('accepts a manifest with no hooks and no settings', () => {
    // The shape a third-party author writes first, and the one that used to
    // crash the runtime rather than the build.
    const plugin = definePlugin({ manifest: MINIMAL });

    expect(plugin.manifest.hooks).toEqual([]);
    expect(plugin.manifest.settings).toEqual({});
    expect(plugin.manifest.routes).toEqual([]);
    // A record, not a list: settings and secrets are keyed by field name.
    expect(plugin.manifest.secrets).toEqual({});
    expect(plugin.manifest.panels).toEqual([]);
  });

  it('leaves declared values alone', () => {
    const plugin = definePlugin({
      manifest: {
        ...MINIMAL,
        hooks: ['onRequest'],
        settings: {
          greeting: { type: 'string', label: 'Greeting' },
        },
      },
      hooks: { onRequest: async () => undefined },
    });

    expect(plugin.manifest.hooks).toEqual(['onRequest']);
    expect(Object.keys(plugin.manifest.settings)).toEqual(['greeting']);
  });

  it('is idempotent, so a plugin can be defined once and re-exported', () => {
    const once = definePlugin({ manifest: MINIMAL });
    const twice = definePlugin(once);

    expect(twice.manifest).toEqual(once.manifest);
  });
});

describe('definePlugin refuses what it cannot fix', () => {
  it('a manifest that is not there at all', () => {
    expect(() => definePlugin({} as unknown as MallokPlugin)).toThrow(
      /manifest/i,
    );
  });

  it('an id that is not a usable table prefix', () => {
    // Every table a plugin owns must start with `p_<id>_`, so an id with a
    // hyphen or a capital produces SQL nobody can write.
    // A hyphen is fine — the table prefix converts it (`p_acme_plugin_`) —
    // so the ones that are not are capitals, a leading digit and empty.
    for (const id of ['Acme', '1acme', '', 'acme_plugin']) {
      expect(() => definePlugin({ manifest: { ...MINIMAL, id } }), id).toThrow(
        /id/i,
      );
    }
  });

  it('a hook named in the manifest with no implementation', () => {
    // Declaring `onRequest` and shipping nothing is a plugin that silently
    // does nothing on every request. Better to fail the build.
    expect(() =>
      definePlugin({ manifest: { ...MINIMAL, hooks: ['onRequest'] } }),
    ).toThrow(/onRequest/);
  });

  it('an implementation for a hook the manifest does not declare', () => {
    // The other direction, and the more surprising one: the runtime only
    // calls what the manifest lists, so this hook would never run and its
    // author would have no way to tell.
    expect(() =>
      definePlugin({
        manifest: MINIMAL,
        hooks: { onRequest: async () => undefined },
      }),
    ).toThrow(/onRequest/);
  });

  it('a hook name that is not one of the five', () => {
    expect(
      said(() =>
        definePlugin({
          manifest: { ...MINIMAL, hooks: ['onEverything'] as never },
        }),
      ),
    ).toMatch(/onEverything/);
  });

  it('a route declared with no handler', () => {
    expect(() =>
      definePlugin({
        manifest: {
          ...MINIMAL,
          routes: [{ path: 'submit', method: 'POST' }],
        },
      }),
    ).toThrow(/submit/);
  });

  it('a handler for a route the manifest does not declare', () => {
    expect(() =>
      definePlugin({
        manifest: MINIMAL,
        routes: { submit: async () => new Response('') },
      }),
    ).toThrow(/submit/);
  });

  it('a declared route whose handler is not a function', () => {
    expect(() =>
      definePlugin({
        manifest: {
          ...MINIMAL,
          routes: [{ path: 'submit', method: 'POST' }],
        },
        routes: { submit: 'not a function' },
      } as unknown as Parameters<typeof definePlugin>[0]),
    ).toThrow(/submit.*not a function/i);
  });

  it('malformed, foreign and duplicate migrations', () => {
    expect(() =>
      definePlugin({
        manifest: MINIMAL,
        migrations: ['SELECT 1'],
      } as unknown as Parameters<typeof definePlugin>[0]),
    ).toThrow(/migration.*object/i);
    expect(() =>
      definePlugin({
        manifest: MINIMAL,
        migrations: [{ id: 'plugin:other:0001', sql: 'SELECT 1' }],
      }),
    ).toThrow(/prefix/i);
    expect(() =>
      definePlugin({
        manifest: MINIMAL,
        migrations: [
          { id: 'plugin:acme:0001', sql: 'SELECT 1' },
          { id: 'plugin:acme:0001', sql: 'SELECT 2' },
        ],
      }),
    ).toThrow(/more than once/i);
  });

  it('the same plugin id twice in one composition', () => {
    const plugin = definePlugin({ manifest: MINIMAL });
    expect(() => normalizePlugins([plugin, plugin])).toThrow(/more than once/i);
  });

  it('a third party cannot award itself official provenance', () => {
    expect(
      said(() => definePlugin({ manifest: { ...MINIMAL, official: true } })),
    ).toMatch(/official|unrecognized/i);
    expect(isOfficialPlugin(definePlugin({ manifest: MINIMAL }))).toBe(false);
  });

  it('a settings field of a type the admin cannot render', () => {
    expect(
      said(() =>
        definePlugin({
          manifest: {
            ...MINIMAL,
            settings: { x: { type: 'quaternion' } as never },
          },
        }),
      ),
    ).toMatch(/quaternion|invalid|type/i);
  });

  it('a table that does not carry the plugin’s prefix', () => {
    expect(
      said(() =>
        definePlugin({
          manifest: {
            ...MINIMAL,
            panels: [
              {
                id: 'rows',
                label: 'Rows',
                type: 'table',
                table: 'other_table',
                columns: [{ field: 'id', label: 'Id' }],
              },
            ],
          },
        }),
      ),
    ).toMatch(/p_acme_/);
  });

  it('names the plugin in every refusal', () => {
    // An author reading a build log needs to know which plugin, not just
    // which field.
    const error = (() => {
      try {
        definePlugin({ manifest: { ...MINIMAL, hooks: ['scheduled'] } });
        return null;
      } catch (thrown) {
        return thrown as Error;
      }
    })();

    expect(error?.message).toContain('acme');
  });
});

describe('plugin route cache policy', () => {
  it('overrides every shared-cache instruction a handler supplied', async () => {
    const response = enforcePluginRouteNoStore(
      new Response('ok', {
        headers: {
          'cache-control': 'public, s-maxage=3600',
          'cloudflare-cdn-cache-control': 'public, s-maxage=7200',
          'cdn-cache-control': 'public, max-age=7200',
          'surrogate-control': 'max-age=7200',
          'cache-tag': 'private-data',
        },
      }),
    );

    expect(await response.text()).toBe('ok');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('cloudflare-cdn-cache-control')).toBe(
      'no-store',
    );
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('surrogate-control')).toBe('no-store');
    expect(response.headers.get('cache-tag')).toBeNull();
  });

  it('overrides those headers on a real plugin-route response', async () => {
    const previous = { theme: activeTheme(), plugins: compiledPlugins() };
    const plugin = definePlugin({
      manifest: {
        ...MINIMAL,
        routes: [{ path: 'leak', method: 'POST' }],
      },
      routes: {
        leak: async () =>
          new Response('sensitive', {
            headers: {
              'cache-control': 'public, s-maxage=3600',
              'cloudflare-cdn-cache-control': 'public, s-maxage=7200',
              'cdn-cache-control': 'public, max-age=7200',
              'surrogate-control': 'max-age=7200',
              'cache-tag': 'private-data',
            },
          }),
      },
    });
    configure({ theme: previous.theme, plugins: [plugin] });
    try {
      const response = await handlePluginRoute(
        new Request('https://example.com/_mallok/p/acme/leak', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
        env,
        createExecutionContext(),
        '/_mallok/p/acme/leak',
        [
          {
            plugin_id: 'acme',
            enabled: 1,
            version: '1.0.0',
            settings: '{}',
            secrets: '{}',
            updated_at: '2026-09-17T00:00:00.000Z',
          },
        ],
        {
          name: 'Example',
          tagline: '',
          defaultLocale: 'en',
          locales: ['en'],
          kinds: {},
          nav: {},
          themeOptions: {},
          domain: null,
          mediaBaseUrl: '',
          cacheTtl: 60,
        },
      );

      expect(await response.text()).toBe('sensitive');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('cloudflare-cdn-cache-control')).toBe(
        'no-store',
      );
      expect(response.headers.get('cdn-cache-control')).toBe('no-store');
      expect(response.headers.get('surrogate-control')).toBe('no-store');
      expect(response.headers.get('cache-tag')).toBeNull();
    } finally {
      configure(previous);
    }
  });
});

describe('plugin export paths', () => {
  const site = {
    name: 'Example',
    tagline: '',
    defaultLocale: 'en',
    locales: ['en'],
    kinds: {},
    nav: {},
    themeOptions: {},
    domain: null,
    mediaBaseUrl: '',
    cacheTtl: 60,
  } as const;

  it('omits a whole plugin when one path escapes or collides', async () => {
    const previous = { theme: activeTheme(), plugins: compiledPlugins() };
    const plugins = [
      definePlugin({
        manifest: { ...MINIMAL, id: 'first' },
        exportFiles: async () => [
          { path: 'first.csv', text: 'first' },
          { path: 'shared.csv', text: 'shared-first' },
        ],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'core-collision' },
        exportFiles: async () => [{ path: 'site.json', text: 'replace core' }],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'plugin-collision' },
        exportFiles: async () => [
          { path: 'shared.csv', text: 'replace plugin' },
        ],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'parent-path' },
        exportFiles: async () => [{ path: '../outside.txt', text: 'escape' }],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'windows-path' },
        exportFiles: async () => [
          { path: '..\\outside.txt', text: 'windows escape' },
        ],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'self-collision' },
        exportFiles: async () => [
          { path: 'own.csv', text: 'one' },
          { path: 'OWN.csv', text: 'two' },
        ],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'surrogate-path' },
        exportFiles: async () => [
          {
            path: `bad-${String.fromCharCode(0xd800)}.txt`,
            text: 'invalid Unicode scalar',
          },
        ],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'windows-device' },
        exportFiles: async () => [
          { path: 'archive/COM¹.txt', text: 'reserved device' },
        ],
      }),
    ];
    configure({ theme: previous.theme, plugins });
    try {
      const rows = plugins.map((plugin) => ({
        plugin_id: plugin.manifest.id,
        enabled: 1,
        version: plugin.manifest.version,
        settings: '{}',
        secrets: '{}',
        updated_at: '2026-09-17T00:00:00.000Z',
      }));

      const result = await collectPluginExports(
        env,
        createExecutionContext(),
        rows,
        site,
        ['site.json'],
      );

      expect(result.files).toEqual([
        { path: 'first.csv', text: 'first' },
        { path: 'shared.csv', text: 'shared-first' },
      ]);
      expect(result.failed.map((failure) => failure.plugin)).toEqual([
        'core-collision',
        'parent-path',
        'plugin-collision',
        'self-collision',
        'surrogate-path',
        'windows-device',
        'windows-path',
      ]);
      const errors = result.failed.map((failure) => failure.error).join('\n');
      expect(errors).toMatch(/core export/i);
      expect(errors).toMatch(/already produced/i);
      expect(errors).toMatch(/dot segment/i);
      expect(errors).toMatch(/backslash/i);
      expect(errors).toMatch(/portable across filesystems/i);
      expect(errors).toMatch(/reserved Windows filename/i);
    } finally {
      configure(previous);
    }
  });

  it('refuses a duplicate already present in the core manifest', async () => {
    await expect(
      collectPluginExports(env, createExecutionContext(), [], site, [
        'site.json',
        'SITE.json',
      ]),
    ).rejects.toThrow(/already produced/i);
  });

  it('resolves cross-plugin collisions in plugin-id order', async () => {
    const previous = { theme: activeTheme(), plugins: compiledPlugins() };
    const plugins = [
      definePlugin({
        manifest: { ...MINIMAL, id: 'z-last' },
        exportFiles: async () => [{ path: 'shared.csv', text: 'z' }],
      }),
      definePlugin({
        manifest: { ...MINIMAL, id: 'a-first' },
        exportFiles: async () => [{ path: 'shared.csv', text: 'a' }],
      }),
    ];
    configure({ theme: previous.theme, plugins });
    try {
      const rows = plugins.map((plugin) => ({
        plugin_id: plugin.manifest.id,
        enabled: 1,
        version: plugin.manifest.version,
        settings: '{}',
        secrets: '{}',
        updated_at: '2026-09-17T00:00:00.000Z',
      }));
      const result = await collectPluginExports(
        env,
        createExecutionContext(),
        rows,
        site,
      );

      expect(result.files).toEqual([{ path: 'shared.csv', text: 'a' }]);
      expect(result.failed.map((failure) => failure.plugin)).toEqual([
        'z-last',
      ]);
    } finally {
      configure(previous);
    }
  });
});
