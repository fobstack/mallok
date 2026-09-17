import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { fobstackRuntime } from '../../../src/runtime/vite/index.js';

/**
 * A real Vite build, not a hand-written manifest.
 *
 * The point of this test is that the island entries Vite emits — hashed file
 * names included — are the ones the runtime will be told about. A fixture
 * manifest proves nothing about the build actually producing those files.
 */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runtime-build-'));
  await mkdir(join(root, 'src', 'pages', 'products'), { recursive: true });
  await mkdir(join(root, 'src', 'islands'), { recursive: true });

  await writeFile(
    join(root, 'src', 'pages', 'index.ts'),
    'export const render = () => "<main>home</main>";\n',
  );
  await writeFile(
    join(root, 'src', 'pages', 'products', '[slug].ts'),
    'export const render = () => "<main>product</main>";\n',
  );
  await writeFile(
    join(root, 'src', 'islands', 'cart.ts'),
    'export default function Cart() { return null; }\n',
  );
  await writeFile(
    join(root, 'src', 'islands', 'search.ts'),
    'export default function Search() { return null; }\n',
  );
  // The entry a product ships. It has to *use* the registry, not merely
  // re-export it: Vite builds with `preserveEntrySignatures: false`, so an
  // entry whose exports nothing reads is tree-shaken away entirely — islands
  // and all. `generateBootstrap()` calls `mountIslands(registry)` for exactly
  // this reason; this stands in for that without pulling React into the
  // fixture.
  await writeFile(
    join(root, 'src', 'entry-client.ts'),
    [
      "import { registry } from 'virtual:fobstack-islands';",
      'globalThis.__islands = Object.keys(registry).map((name) => registry[name]);',
    ].join('\n'),
  );
  return root;
}

describe('a real Vite build', () => {
  it('emits every island and a route manifest that imports them', async () => {
    const root = await fixture();
    await build({
      root,
      logLevel: 'error',
      plugins: [fobstackRuntime({ locales: ['zh'], defaultLocale: 'en' })],
      build: {
        outDir: 'dist',
        // Not `build.lib`: lib mode inlines dynamic imports into one file, so
        // every island would ship on every page — the exact thing islands
        // exist to avoid.
        rollupOptions: {
          input: { 'entry-client': join(root, 'src', 'entry-client.ts') },
          output: {
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
          },
        },
      },
    });

    const assets = await readdir(join(root, 'dist', 'assets'));
    // Each island is its own chunk, so a page loads only the one it used.
    expect(assets.some((file) => file.startsWith('cart-'))).toBe(true);
    expect(assets.some((file) => file.startsWith('search-'))).toBe(true);
    // Hashed, so Static Assets can serve them immutably.
    expect(assets.every((file) => /-[A-Za-z0-9_-]+\.js$/.test(file))).toBe(
      true,
    );

    // The manifest the runtime reads names the files the build emitted,
    // hashes included — not the source paths it started from.
    const islands = JSON.parse(
      await readFile(join(root, 'dist', 'fobstack-islands.json'), 'utf8'),
    ) as {
      bootstrap?: string;
      islands: Record<string, { src: string }>;
    };
    expect(Object.keys(islands.islands).sort()).toEqual(['cart', 'search']);
    expect(islands.islands.cart?.src).toMatch(
      /^\/assets\/cart-[A-Za-z0-9_-]+\.js$/,
    );
    expect(assets).toContain(
      (islands.islands.cart as { src: string }).src.replace('/assets/', ''),
    );
  });

  it('scans the tree the plugin was pointed at', async () => {
    const root = await fixture();
    const plugin = fobstackRuntime({
      pages: join(root, 'src', 'pages'),
      islands: join(root, 'src', 'islands'),
    });
    const routes = await plugin.load('\0virtual:fobstack-routes');
    expect(routes).toContain('"/products/[slug]"');
    expect(routes).toContain('"/"');

    const islands = await plugin.load('\0virtual:fobstack-islands');
    expect(islands).toContain('"cart"');
    expect(islands).toContain('"search"');
  });

  it('scans relative directories against Vite root, not the process cwd', async () => {
    // The bug this pins: resolving `src/islands` against `process.cwd()` made
    // the manifest silently empty for any project whose Vite root is a
    // subdirectory — Mallok's admin build is one.
    const root = await fixture();
    const plugin = fobstackRuntime();
    plugin.configResolved?.({ root, base: '/' });
    const islands = await plugin.load('\0virtual:fobstack-islands');
    expect(islands).toContain('"cart"');
    expect(islands).toContain('"search"');
  });
});
