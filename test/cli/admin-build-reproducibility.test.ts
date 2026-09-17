import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
let sandbox = '';
let first = '';
let second = '';

/**
 * Builds the admin from a throwaway checkout at a different absolute path.
 *
 * The release package is normally built from Vitest's global setup, where
 * `NODE_ENV=test` is inherited. Vite used that value even for `vite build`,
 * selected the JSX development runtime and embedded every source file's
 * absolute path in `jsxDEV(..., { fileName })`. Besides disclosing the build
 * machine, that made otherwise identical checkouts produce different chunks
 * and therefore different tarballs.
 */
async function buildCheckout(name: string): Promise<string> {
  const checkout = join(sandbox, name);
  await mkdir(join(checkout, 'src'), { recursive: true });
  await Promise.all([
    cp('src/admin', join(checkout, 'src/admin'), { recursive: true }),
    cp('src/core', join(checkout, 'src/core'), { recursive: true }),
    cp('vite.config.ts', join(checkout, 'vite.config.ts')),
    cp('package.json', join(checkout, 'package.json')),
    cp('tsconfig.json', join(checkout, 'tsconfig.json')),
    cp('tsconfig.base.json', join(checkout, 'tsconfig.base.json')),
  ]);
  await symlink(resolve('node_modules'), join(checkout, 'node_modules'), 'dir');

  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test' };
  delete environment.MALLOK_ADMIN_LICENSES;
  await execFileAsync(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), 'build'],
    {
      cwd: checkout,
      env: environment,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return checkout;
}

async function files(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        result.set(relative(root, path), await readFile(path));
      }
    }
  };
  await walk(root);
  return result;
}

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'mallok-admin-paths-'));
  // Both checkouts share the repository's dependency tree. Build them in
  // sequence so Vite never has two processes writing that tree's cache.
  first = await buildCheckout('checkout-a');
  second = await buildCheckout('checkout-b');
}, 120_000);

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('the production admin build', () => {
  it('is byte-identical from two different absolute checkout paths', async () => {
    const assetPath = 'dist/assets/_mallok/app';
    const [left, right] = await Promise.all([
      files(join(first, assetPath)),
      files(join(second, assetPath)),
    ]);

    expect([...left.keys()].sort()).toEqual([...right.keys()].sort());
    for (const [path, bytes] of left) {
      expect(
        Buffer.compare(bytes, right.get(path) ?? Buffer.alloc(0)),
        path,
      ).toBe(0);
    }
  });

  it('contains neither checkout path nor the JSX development runtime', async () => {
    const roots = await Promise.all([realpath(first), realpath(second)]);
    for (const checkout of [first, second]) {
      const built = await files(join(checkout, 'dist/assets/_mallok/app'));
      const javascript = [...built]
        .filter(([path]) => path.endsWith('.js'))
        .map(([, bytes]) => new TextDecoder().decode(bytes))
        .join('\n');

      expect(javascript.length).toBeGreaterThan(0);
      expect(javascript).not.toContain('jsxDEV');
      for (const root of roots) {
        expect(javascript, root).not.toContain(root);
      }
    }
  });
});
