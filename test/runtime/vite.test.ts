import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fobstackRuntime,
  generateBootstrap,
  generateIslandsModule,
  generateRoutesModule,
  islandNameFor,
  patternFor,
  scanDirectory,
} from '../../src/runtime/vite/index.js';

describe('patternFor', () => {
  it('maps files to route patterns, collapsing index', () => {
    expect(patternFor('index.ts')).toBe('/');
    expect(patternFor('about.ts')).toBe('/about');
    expect(patternFor('blog/index.ts')).toBe('/blog');
    expect(patternFor('products/[slug].ts')).toBe('/products/[slug]');
    expect(patternFor('docs/[...path].ts')).toBe('/docs/[...path]');
  });
});

describe('islandNameFor', () => {
  it('names an island after its file', () => {
    expect(islandNameFor('cart.tsx')).toBe('cart');
    expect(islandNameFor(join('shop', 'add-to-cart.tsx'))).toBe('add-to-cart');
  });
});

describe('scanDirectory', () => {
  it('finds files at every depth, and tolerates a missing directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-pages-'));
    await mkdir(join(root, 'products'), { recursive: true });
    await writeFile(join(root, 'index.ts'), 'export const render = () => "";');
    await writeFile(
      join(root, 'products', '[slug].ts'),
      'export const render = () => "";',
    );
    await writeFile(join(root, 'notes.md'), 'not a page');

    expect(await scanDirectory(root, ['.ts', '.js'])).toEqual([
      'index.ts',
      join('products', '[slug].ts'),
    ]);

    // A project that has not created the directory yet is not an error.
    expect(await scanDirectory(join(root, 'missing'), ['.ts'])).toEqual([]);
  });
});

describe('generateRoutesModule', () => {
  it('emits dynamic imports so each page is its own chunk', () => {
    const source = generateRoutesModule(
      ['index.ts', join('products', '[slug].ts')],
      '/app/src/pages',
      { locales: ['zh'], defaultLocale: 'en' },
    );
    expect(source).toContain('"/products/[slug]"');
    // An absolute specifier, so the import resolves whatever Vite's root is.
    expect(source).toContain('import("/app/src/pages/products/[slug].ts")');
    // The page is the module's default export, which is what definePage
    // returns; handing the namespace over would lose `render`.
    expect(source).toContain('.then((module) => module.default)');
    expect(source).toContain('locales: ["zh"]');
    expect(source).toContain('defaultLocale: "en"');
    // The manifest carries the islands, so the runtime knows their URLs.
    expect(source).toContain("from 'virtual:fobstack-islands'");
    expect(source).toContain('islands,');
  });
});

describe('generateIslandsModule', () => {
  it('emits both the manifest entries and the client registry', () => {
    const source = generateIslandsModule(
      ['cart.tsx', 'search.tsx'],
      '/app/src/islands',
    );
    expect(source).toContain('export const islands = {');
    expect(source).toContain('"cart": { src: "/app/src/islands/cart.tsx" }');
    expect(source).toContain('export const registry = {');
    expect(source).toContain(
      '"cart": () => import("/app/src/islands/cart.tsx")',
    );
  });
});

describe('generateBootstrap', () => {
  it('mounts the generated registry', () => {
    const source = generateBootstrap();
    // The island client is resolved from the runtime module's own location, not
    // named as a package: it is internal to this repository and there is no
    // `@fobstack/runtime` on npm to import.
    expect(source).toContain('src/runtime/react/index.ts');
    expect(source).toContain('mountIslands(registry)');
  });
});

describe('build-time boundaries', () => {
  it('refuses two islands with the same name in different directories', async () => {
    // Both would be `{% island "cart" %}` in a template, and whichever the
    // scan happened to reach second would silently win. Naming the conflict
    // at build time is the only point where it is cheap to fix.
    expect(() =>
      generateIslandsModule(
        [join('shop', 'cart.tsx'), join('checkout', 'cart.tsx')],
        '/app/src/islands',
      ),
    ).toThrow(/cart/);

    try {
      generateIslandsModule(
        [join('shop', 'cart.tsx'), join('checkout', 'cart.tsx')],
        '/app/src/islands',
      );
    } catch (error) {
      // The message has to name the files, not just the collision.
      const message = (error as Error).message;
      expect(message).toContain('shop');
      expect(message).toContain('checkout');
    }
  });

  it('ignores declarations and tests when scanning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-scan-'));
    await mkdir(join(root, 'pages'), { recursive: true });
    await mkdir(join(root, 'islands'), { recursive: true });
    for (const [directory, name] of [
      ['pages', 'index.ts'],
      ['pages', 'types.d.ts'],
      ['pages', 'index.test.ts'],
      ['pages', 'index.spec.ts'],
      ['islands', 'cart.tsx'],
      ['islands', 'cart.test.tsx'],
      ['islands', 'shims.d.ts'],
    ] as const) {
      await writeFile(join(root, directory, name), 'export default 1;\n');
    }

    const plugin = fobstackRuntime({
      pages: join(root, 'pages'),
      islands: join(root, 'islands'),
    });

    const routes = (await plugin.load('\0virtual:fobstack-routes')) ?? '';
    expect(routes).toContain('"/"');
    // A `.d.ts` has no runtime export at all, and a test file is not a page.
    expect(routes).not.toContain('types');
    expect(routes).not.toContain('.test');
    expect(routes).not.toContain('.spec');

    const islands = (await plugin.load('\0virtual:fobstack-islands')) ?? '';
    expect(islands).toContain('"cart"');
    expect(islands).not.toContain('shims');
    expect(islands).not.toContain('.test');
  });
});
