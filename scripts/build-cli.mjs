/**
 * Bundles the CLI for publishing to npm.
 *
 * `sharp` stays external: it is a native module and must be installed by the
 * consumer for their platform, not inlined (docs/TECH_STACK.md §5). Every
 * other dependency is bundled so the published package installs quickly.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

// The published CLI carries the repository's version. Hard-coding it here
// meant a release could ship a binary labelled `0.1.0-dev`, and the mismatch
// would only surface in a bug report months later.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));

const OUT_DIR = 'dist/cli';
const OUT_FILE = `${OUT_DIR}/index.js`;

await mkdir(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: OUT_FILE,
  external: ['sharp'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      // ESM output has no `require`, but bundled CommonJS dependencies still
      // call it. This is esbuild's documented interop shim.
      "import { createRequire as __mallokCreateRequire } from 'node:module';",
      'const require = __mallokCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  // The entry file already carries the shebang; a banner would add a
  // second one on line 2, which is a syntax error.
  metafile: true,
  logLevel: 'warning',
});

await chmod(OUT_FILE, 0o755);

// A package manifest for the published artifact, separate from the repo's.
await writeFile(
  `${OUT_DIR}/package.json`,
  `${JSON.stringify(
    {
      name: 'mallok',
      version,
      description:
        'Command line interface for Mallok, a Cloudflare-native content website.',
      type: 'module',
      bin: { mallok: './index.js' },
      engines: { node: '>=22' },
      dependencies: { sharp: '0.35.4' },
      files: ['index.js'],
      license: 'MIT',
    },
    null,
    2,
  )}\n`,
);

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`cli bundle: ${(bytes / 1024).toFixed(1)} KiB (sharp external)`);
