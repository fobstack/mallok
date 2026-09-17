import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetCompiledAssets,
  stageTemplate,
  TEMPLATE_FILES,
} from '../../scripts/package-inputs.mjs';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mallok-package-inputs-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function files(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        found.push(relative(directory, path));
      }
    }
  };
  await walk(directory);
  return found.sort();
}

describe('publishable package inputs', () => {
  it('copies the reviewed template allow-list and nothing ignored beside it', async () => {
    const source = join(root, 'template');
    const destination = join(root, 'staged');
    await cp('template', source, { recursive: true });
    await Promise.all([
      writeFile(join(source, '.dev.vars'), 'REAL_SECRET=must-not-ship\n'),
      writeFile(join(source, '.env'), 'ALSO_SECRET=must-not-ship\n'),
      writeFile(join(source, 'debug.log'), 'private diagnostics\n'),
      writeFile(join(source, 'unreviewed.txt'), 'not allow-listed\n'),
    ]);

    await stageTemplate(source, destination);

    expect(await files(destination)).toEqual([...TEMPLATE_FILES].sort());
    await expect(
      readFile(join(destination, '.dev.vars.example'), 'utf8'),
    ).resolves.toContain('MALLOK_SECRET');
  });

  it('removes the whole compiled-asset tree before either builder runs', async () => {
    const assets = join(root, 'dist/assets');
    await mkdir(join(assets, '_mallok/app'), { recursive: true });
    await writeFile(join(assets, 'ignored-secret.txt'), 'must disappear');

    await resetCompiledAssets(assets);

    await expect(readdir(assets)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
