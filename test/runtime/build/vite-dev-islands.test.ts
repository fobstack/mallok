/**
 * Islands in a Vite dev server.
 *
 * The production path is covered elsewhere: the client build emits a hashed
 * bootstrap and the Worker build is handed its name. **Dev has no such build**,
 * so nothing fills `bootstrap` in — and a page that renders an island then
 * loads no script at all. Everything works, nothing mounts, and the only
 * symptom is an island that silently never appears while `vite dev` is the
 * thing every developer uses all day.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fobstackRuntime } from '../../../src/runtime/vite/index.js';

/** The repository root: the runtime lives at `src/runtime`. */
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const ISLAND_V1 = `
export default function Picker() {
  return <span className="picker">USD</span>;
}
`;

const ISLAND_V2 = `
export default function Picker() {
  return <span className="picker">EUR</span>;
}
`;

let root = '';
let server: ViteDevServer;
let port = 0;

beforeAll(async () => {
  await mkdir(join(REPO_ROOT, '.tmp'), { recursive: true });
  root = await mkdtemp(join(REPO_ROOT, '.tmp', 'dev-'));
  await mkdir(join(root, 'src', 'islands'), { recursive: true });
  await mkdir(join(root, 'src', 'pages'), { recursive: true });
  await writeFile(join(root, 'src', 'islands', 'picker.tsx'), ISLAND_V1);
  await writeFile(
    join(root, 'src', 'pages', 'index.ts'),
    "export default { render: () => '' };\n",
  );

  server = await createServer({
    root,
    logLevel: 'error',
    resolve: {
      alias: [
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
    plugins: [react(), fobstackRuntime()],
    server: { port: 0 },
  });
  await server.listen();
  port = server.config.server.port ?? 0;
  const address = server.httpServer?.address();
  if (address !== null && typeof address === 'object') {
    port = address.port;
  }
}, 60_000);

afterAll(async () => {
  // Vite's own shutdown can hang here — the watcher and the HTTP server each
  // keep handles open, and closing them is not worth failing a green suite
  // over. Bounded, then the fixture is removed regardless.
  await Promise.race([
    (async () => {
      await server?.watcher.close();
      await server?.close();
    })(),
    new Promise((done) => setTimeout(done, 5_000)),
  ]);
  if (root !== '') {
    await rm(root, { recursive: true, force: true });
  }
});

/** The manifest a dev Worker would import, as the plugin generates it. */
async function devManifestSource(): Promise<string> {
  const loaded = await server.pluginContainer.load('\0virtual:fobstack-routes');
  return typeof loaded === 'string' ? loaded : (loaded?.code ?? '');
}

/** Reads the bootstrap URL literal out of the generated islands module. */
function bootstrapFrom(source: string): string | undefined {
  return /export const bootstrap = (.*);/.exec(source)?.[1];
}

/** The islands module the dev server generates. */
async function devIslandsSource(): Promise<string> {
  const loaded = await server.pluginContainer.load(
    '\0virtual:fobstack-islands',
  );
  return typeof loaded === 'string' ? loaded : (loaded?.code ?? '');
}

describe('islands in a dev server', () => {
  it('gives the page a bootstrap URL', async () => {
    // The Worker's manifest wires the URL through; the islands module holds it.
    expect(await devManifestSource()).toMatch(/islandBootstrap:\s*bootstrap/);
    const bootstrap = bootstrapFrom(await devIslandsSource());

    // The failure this pins: `undefined` here means the runtime emits no
    // script tag, so every island on every page silently never mounts in dev.
    expect(bootstrap).toBeDefined();
    expect(bootstrap).not.toBe('undefined');
    expect(bootstrap).toMatch(/^"\/.*"$/);
  });

  it('serves a bootstrap that actually calls mountIslands', async () => {
    const url = JSON.parse(
      bootstrapFrom(await devIslandsSource()) ?? '""',
    ) as string;

    const response = await fetch(`http://localhost:${port}${url}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');

    const served = await response.text();
    expect(served).toContain('mountIslands');
    // It must pull in the registry, or it has nothing to mount.
    expect(served).toMatch(/fobstack-islands/);
  });

  it('serves the island module itself, and picks up an edit', async () => {
    const code = await devIslandsSource();
    const specifier = /import\("([^"]+picker[^"]*)"\)/.exec(code)?.[1] ?? '';
    expect(specifier).not.toBe('');

    const first = await server.transformRequest(specifier);
    expect(first?.code).toContain('USD');

    // An edit has to be visible on the next request, or dev is a lie.
    await writeFile(join(root, 'src', 'islands', 'picker.tsx'), ISLAND_V2);
    const module = server.moduleGraph.getModuleById(specifier);
    if (module) {
      server.moduleGraph.invalidateModule(module);
    }
    const second = await server.transformRequest(specifier);
    expect(second?.code).toContain('EUR');

    await writeFile(join(root, 'src', 'islands', 'picker.tsx'), ISLAND_V1);
  });

  it('still emits nothing for a page that used no island', async () => {
    // The dev bootstrap must not become a script every page carries.
    const { Runtime } = await import('../../../src/runtime/core/runtime.js');
    const runtime = new Runtime({
      routes: [
        { pattern: '/', load: () => Promise.resolve({ render: () => 'hi' }) },
      ],
      islandBootstrap: '/@id/whatever',
    });
    const result = await runtime.handle(new Request('https://x.test/'), {
      document: (parts) => `${parts.body}${parts.islands}`,
    });
    expect(await result?.response.text()).toBe('hi');
  });
});
