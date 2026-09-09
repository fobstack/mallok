/**
 * A real consumer, built by Vite and then actually asked for pages.
 *
 * Every other test here reads the *source* the plugin generates. That is not
 * the same claim: a manifest whose generated text looks right can still fail
 * to produce a working page, and the `.default` unwrap is exactly the kind of
 * bug that only shows up once a built manifest is imported and called. So this
 * fixture writes pages the documented way — `export default definePage(...)` —
 * imports `virtual:fobstack-routes` from a real build, and serves requests.
 */

import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { fobstackRuntime } from '../../../src/runtime/vite/index.js';

/** What the fixture's `@fobstack/runtime` import resolves to: the internal module. */
const RUNTIME_SRC = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'runtime',
  'core',
  'index.ts',
);

const HOME_PAGE = `
import { definePage } from '@fobstack/runtime';

export default definePage()({
  load: () => ({ title: 'Home' }),
  render: ({ title }) => \`<main><h1>\${title}</h1></main>\`,
  cache: () => ({ mode: 'public', edgeSeconds: 60, tags: ['home'] }),
});
`;

const PRODUCT_PAGE = `
import { definePage } from '@fobstack/runtime';

export default definePage()({
  load: ({ params }) => ({ slug: params.slug }),
  render: ({ slug }) => \`<main><h1>Product \${slug}</h1></main>\`,
});
`;

const SERVER_ENTRY = `
import { manifest } from 'virtual:fobstack-routes';
import { Runtime } from '@fobstack/runtime';

const runtime = new Runtime(manifest);

export const routePatterns = manifest.routes.map((route) => route.pattern);

export async function handle(request) {
  const result = await runtime.handle(request);
  return result === null ? null : result;
}
`;

const CLIENT_ENTRY = `
import { registry } from 'virtual:fobstack-islands';
globalThis.__islands = Object.keys(registry);
`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runtime-consumer-'));
  await mkdir(join(root, 'src', 'pages', 'products'), { recursive: true });
  await mkdir(join(root, 'src', 'islands'), { recursive: true });

  await writeFile(join(root, 'src', 'pages', 'index.ts'), HOME_PAGE);
  await writeFile(
    join(root, 'src', 'pages', 'products', '[slug].ts'),
    PRODUCT_PAGE,
  );
  await writeFile(
    join(root, 'src', 'islands', 'quote.ts'),
    'export default 1;',
  );
  await writeFile(join(root, 'src', 'server.ts'), SERVER_ENTRY);
  await writeFile(join(root, 'src', 'entry-client.ts'), CLIENT_ENTRY);
  return root;
}

/** Both halves of a real product build: the client bundle, then the server. */
async function buildFixture(root: string): Promise<void> {
  const shared = {
    root,
    logLevel: 'error' as const,
    resolve: { alias: { '@fobstack/runtime': RUNTIME_SRC } },
    plugins: [fobstackRuntime({ locales: ['zh'], defaultLocale: 'en' })],
  };

  await build({
    ...shared,
    build: {
      outDir: 'dist/client',
      rollupOptions: {
        input: { 'entry-client': join(root, 'src', 'entry-client.ts') },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
  });

  await build({
    ...shared,
    build: {
      outDir: 'dist/server',
      ssr: true,
      rollupOptions: {
        input: { server: join(root, 'src', 'server.ts') },
        output: { entryFileNames: '[name].js', format: 'es' },
      },
    },
  });
}

describe('a built consumer using the file router', () => {
  it('serves a static and a dynamic route from the built manifest', async () => {
    const root = await fixture();
    await buildFixture(root);

    const built = (await import(
      pathToFileURL(join(root, 'dist', 'server', 'server.js')).href
    )) as {
      routePatterns: string[];
      handle: (
        request: Request,
      ) => Promise<{ response: Response; cache: unknown } | null>;
    };

    // The routes came from the file tree, not from anything written by hand.
    expect(built.routePatterns.sort()).toEqual(['/', '/products/[slug]']);

    const home = await built.handle(new Request('https://x.test/'));
    expect(home).not.toBeNull();
    expect(await home?.response.text()).toContain('<h1>Home</h1>');

    // A dynamic segment, with the parameter reaching `load`.
    const product = await built.handle(
      new Request('https://x.test/products/titanium-bar'),
    );
    expect(await product?.response.text()).toContain(
      '<h1>Product titanium-bar</h1>',
    );

    // The locale prefix the plugin baked into the manifest still works.
    const localised = await built.handle(new Request('https://x.test/zh/'));
    expect(await localised?.response.text()).toContain('<h1>Home</h1>');

    // A path with no page is the caller's 404 to make, not the runtime's.
    expect(await built.handle(new Request('https://x.test/nope'))).toBeNull();
  });

  it('emits a hashed island manifest naming files the build produced', async () => {
    const root = await fixture();
    await buildFixture(root);

    const islands = JSON.parse(
      await readFile(
        join(root, 'dist', 'client', 'fobstack-islands.json'),
        'utf8',
      ),
    ) as {
      bootstrap?: string;
      islands: Record<string, { src: string }>;
    };

    expect(Object.keys(islands.islands)).toEqual(['quote']);
    const src = islands.islands['quote']?.src ?? '';
    expect(src).toMatch(/^\/assets\/quote-[A-Za-z0-9_-]+\.js$/);

    // The name in the manifest is a file the build actually wrote.
    const assets = await readdir(join(root, 'dist', 'client', 'assets'));
    expect(assets).toContain(src.replace('/assets/', ''));
  });
});
