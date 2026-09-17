/** Source inputs allowed into the publishable package outside compiled code. */

import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const TEMPLATE_FILES = Object.freeze([
  '.dev.vars.example',
  '.editorconfig',
  '.nvmrc',
  'README.md',
  'biome.json',
  'content/page/hello/index.md',
  'gitignore',
  'scripts/smoke.mjs',
  'site.json',
  'src/plugins/README.md',
  'src/worker/index.ts',
  'test/project.test.ts',
  'tsconfig.json',
  'wrangler.jsonc',
]);

/** Removes every compiled asset so no ignored file can survive a rebuild. */
export async function resetCompiledAssets(path = 'dist/assets') {
  await rm(path, { recursive: true, force: true });
}

/** Copies only the reviewed project-shell files, never the source directory. */
export async function stageTemplate(source, destination) {
  await rm(destination, { recursive: true, force: true });
  for (const relative of TEMPLATE_FILES) {
    const target = resolve(destination, relative);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(source, relative), target);
  }
}
