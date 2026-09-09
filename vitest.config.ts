import { readFile } from 'node:fs/promises';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Loads `.md` as a default-export string, mirroring the `Text` rule in
 * wrangler.jsonc. The worker project gets that rule from Wrangler; the `core`
 * project runs in plain Node, so without this it cannot import anything that
 * reaches `content/` — the starter, for one.
 */
function textModules(): Plugin {
  return {
    name: 'mallok-text-modules',
    async load(id) {
      const file = id.split('?')[0] ?? id;
      if (!file.endsWith('.md')) {
        return null;
      }
      return `export default ${JSON.stringify(await readFile(file, 'utf8'))};`;
    },
  };
}

/**
 * Six test projects, because the things being tested genuinely run in
 * different places:
 *
 *  - `core`            plain Node. `src/core`, which must not depend on the
 *                      Workers runtime, plus the admin's pure logic.
 *  - `worker`          real workerd. The full request path: D1, R2, Cache API.
 *  - `runtime`         plain Node. The page runtime's routing, cache
 *                      semantics, Liquid engine and Vite plugin — none of
 *                      which may need a platform to work.
 *  - `runtime-workerd` real workerd. The runtime's Cloudflare adapter,
 *                      including what may and may not enter a shared cache.
 *  - `runtime-dom`     a browser-like DOM. The island client, and the built
 *                      client bundle executed against server-rendered markup.
 *  - `runtime-build`   real Vite builds and a real dev server.
 *
 * The runtime moved into this repository from a separate package; its tests
 * came with it unchanged, because they are the reason its cache and routing
 * rules can be trusted.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [textModules()],
        test: {
          name: 'core',
          environment: 'node',
          include: [
            'test/core/**/*.test.ts',
            'test/admin/**/*.test.ts',
            'test/cli/**/*.test.ts',
          ],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: { MALLOK_SECRET: 'test-secret-do-not-use' },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'runtime',
          environment: 'node',
          include: ['test/runtime/*.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './test/runtime/workerd/wrangler.jsonc' },
          }),
        ],
        test: {
          name: 'runtime-workerd',
          include: ['test/runtime/workerd/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'runtime-dom',
          environment: 'happy-dom',
          include: ['test/runtime/dom/**/*.test.tsx'],
          // One of these runs two real Vite builds before it can assert
          // anything about the code a browser would actually execute.
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'runtime-build',
          environment: 'node',
          include: ['test/runtime/build/**/*.test.ts'],
          // Real Vite builds and a dev server: slower than a unit test, and
          // they must not be killed halfway through.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
