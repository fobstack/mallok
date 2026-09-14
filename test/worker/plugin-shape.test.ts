import { describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugins/define.js';
import type { MallokPlugin } from '../../src/plugins/types.js';

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
