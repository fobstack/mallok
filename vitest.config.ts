import { readFile } from 'node:fs/promises';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
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
 * Two test projects:
 *  - `core` runs in plain Node and covers `src/core`, which must not depend on
 *    the Workers runtime. It also covers the admin's pure logic — validation,
 *    spec building, routing — which needs no DOM.
 *  - `worker` runs inside workerd via the Workers Vitest integration and
 *    covers the full request path (D1, R2, Cache API).
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
    ],
  },
});
