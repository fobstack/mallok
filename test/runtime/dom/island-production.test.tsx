/**
 * The whole island chain, end to end, with nothing hand-written in the middle.
 *
 * A consumer builds twice — client, then Worker — renders a page through real
 * Liquid, and the built client code is then executed against the HTML that
 * page produced. Every earlier test checks one link of this chain in
 * isolation, and the failures that matter live between the links: a manifest
 * naming source paths that 404 in production, or a page that loads an island's
 * component chunk and so never calls `mountIslands` at all.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { Runtime } from '../../../src/runtime/core/runtime.js';
import type { RouteManifest } from '../../../src/runtime/core/types.js';
import { LiquidRenderer } from '../../../src/runtime/liquid/index.js';
import { fobstackRuntime } from '../../../src/runtime/vite/index.js';

/** The repository root: the runtime lives at `src/runtime`. */
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * The fixture is built in a temp directory with no `node_modules`, so React
 * has to be pointed at this repository's copy — the same one the island client
 * is compiled against, which is also what keeps a single React in the bundle.
 */
const require = createRequire(join(REPO_ROOT, 'package.json'));
/**
 * Exact patterns, not bare strings: a string alias for `react` also rewrites
 * `react/jsx-runtime`, which then resolves to a path inside a file.
 */
const reactAliases = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
].map((name) => ({
  find: new RegExp(`^${name.replace(/[/\\]/g, '\\$&')}$`),
  replacement: require.resolve(name),
}));

/** A page with two islands of the same name, which is the interesting case. */
const PAGE_TEMPLATE = [
  '<!doctype html><html lang="en"><body>',
  '<h1>Quotes</h1>',
  '{% island "quote", strategy: "eager", sku: first %}',
  '{% island "quote", strategy: "eager", sku: second %}',
  '</body></html>',
].join('');

const QUOTE_ISLAND = `
export default function Quote(props) {
  return <span className="quote">{String(props.sku ?? 'none')}</span>;
}
`;

interface Built {
  /** The document the server sent, islands and scripts included. */
  readonly html: string;
  /** Absolute path of the hashed bootstrap chunk. */
  readonly bootstrapFile: string;
  readonly bootstrapUrl: string;
  readonly root: string;
}

async function buildEverything(): Promise<Built> {
  // Built inside the repository rather than in the system temp directory:
  // the test has to `import()` what the build produced, and Vitest will not
  // load a module from outside the project root. Cleaned up afterwards.
  await mkdir(join(REPO_ROOT, '.tmp'), { recursive: true });
  const root = await mkdtemp(join(REPO_ROOT, '.tmp', 'island-'));
  await mkdir(join(root, 'src', 'islands'), { recursive: true });
  await mkdir(join(root, 'src', 'pages'), { recursive: true });
  await writeFile(join(root, 'src', 'islands', 'quote.tsx'), QUOTE_ISLAND);
  // A page module has to exist for the route manifest to be non-empty.
  await writeFile(
    join(root, 'src', 'pages', 'index.ts'),
    "export default { render: () => '' };\n",
  );

  const shared = {
    root,
    logLevel: 'error' as const,
    resolve: {
      alias: [
        ...reactAliases,
        {
          find: /^@fobstack\/runtime\/react$/,
          replacement: join(REPO_ROOT, 'src/runtime/react/index.ts'),
        },
        {
          find: /^@fobstack\/runtime$/,
          replacement: join(REPO_ROOT, 'src/runtime/core/index.ts'),
        },
      ],
    },
  };

  // 1. The client build. Its entry is the runtime's own bootstrap module, so
  //    the thing that calls `mountIslands` is what gets hashed and served.
  await build({
    ...shared,
    plugins: [react(), fobstackRuntime()],
    build: {
      outDir: 'dist/client',
      rollupOptions: {
        input: { bootstrap: 'virtual:fobstack-bootstrap' },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
  });

  const manifestPath = join(root, 'dist/client/fobstack-islands.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    bootstrap: string;
    islands: Record<string, { src: string }>;
  };

  // 2. The Worker build, pointed at the client build's manifest. This is the
  //    handoff: it cannot derive hashed names that did not exist when it began.
  await writeFile(
    join(root, 'src', 'server.ts'),
    "export { islands, bootstrap } from 'virtual:fobstack-islands';\n",
  );
  await build({
    ...shared,
    plugins: [
      fobstackRuntime({ islandManifest: 'dist/client/fobstack-islands.json' }),
    ],
    build: {
      outDir: 'dist/server',
      ssr: true,
      rollupOptions: {
        input: { server: join(root, 'src', 'server.ts') },
        output: { entryFileNames: '[name].js', format: 'es' },
      },
    },
  });

  const server = (await import(
    /* @vite-ignore */ pathToFileURL(join(root, 'dist/server/server.js')).href
  )) as { islands: RouteManifest['islands']; bootstrap: string };

  // 3. Render the page: real Liquid, then the runtime assembling the document.
  const renderer = new LiquidRenderer({
    templates: { 'page.liquid': PAGE_TEMPLATE },
  });
  const body = await renderer.render('page.liquid', {
    first: 'SKU-A',
    second: 'SKU-B',
  });

  const runtime = new Runtime({
    routes: [
      {
        pattern: '/',
        load: () => Promise.resolve({ render: () => body }),
      },
    ],
    ...(server.islands === undefined ? {} : { islands: server.islands }),
    islandBootstrap: server.bootstrap,
  });
  const result = await runtime.handle(new Request('https://x.test/'), {
    document: (parts) =>
      parts.body.replace('</body>', `${parts.islands}</body>`),
  });

  return {
    html: (await result?.response.text()) ?? '',
    bootstrapFile: join(root, 'dist/client', manifest.bootstrap.slice(1)),
    bootstrapUrl: manifest.bootstrap,
    root,
  };
}

let built: Built;

beforeAll(async () => {
  built = await buildEverything();
  return async () => {
    await rm(built.root, { recursive: true, force: true });
  };
}, 120_000);

describe('the production island chain', () => {
  it('references only hashed URLs the build actually emitted', () => {
    expect(built.bootstrapUrl).toMatch(
      /^\/assets\/bootstrap-[A-Za-z0-9_-]+\.js$/,
    );
    expect(built.html).toContain(
      `<script type="module" src="${built.bootstrapUrl}">`,
    );

    // None of the ways a source path leaks into production HTML.
    expect(built.html).not.toContain('.tmp');
    expect(built.html).not.toContain(built.root);
    expect(built.html).not.toContain('src/islands');
    expect(built.html).not.toContain('.tsx');
  });

  it('loads exactly one bootstrap for two islands on the page', () => {
    expect(built.html.match(/<script type="module"/g)).toHaveLength(1);
    // The component is preloaded but not script-tagged: the bootstrap imports
    // it on demand through the registry.
    expect(built.html).toMatch(
      /<link rel="modulepreload" href="\/assets\/quote-[A-Za-z0-9_-]+\.js">/,
    );
  });

  it('mounts both same-named islands with their own props', async () => {
    document.body.innerHTML = built.html;
    // The real built bundle, executed as the browser would run it. Its
    // dynamic import of the island chunk resolves relative to this file.
    await import(/* @vite-ignore */ pathToFileURL(built.bootstrapFile).href);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((done) => setTimeout(done, 10));
      if (document.querySelectorAll('.quote').length === 2) {
        break;
      }
    }

    const rendered = [...document.querySelectorAll('.quote')].map(
      (element) => element.textContent,
    );
    expect(rendered).toEqual(['SKU-A', 'SKU-B']);
  });

  it('ships nothing at all for a page that used no island', async () => {
    const runtime = new Runtime({
      routes: [
        {
          pattern: '/',
          load: () => Promise.resolve({ render: () => '<main>plain</main>' }),
        },
      ],
      islandBootstrap: built.bootstrapUrl,
    });
    const result = await runtime.handle(new Request('https://x.test/'), {
      document: (parts) => `${parts.body}${parts.islands}`,
    });
    const html = (await result?.response.text()) ?? '';

    expect(html).toBe('<main>plain</main>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('modulepreload');
  });
});
