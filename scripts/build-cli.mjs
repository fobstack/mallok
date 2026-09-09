/**
 * Bundles the CLI for publishing to npm.
 *
 * `sharp` stays external: it is a native module and must be installed by the
 * consumer for their platform, not inlined (docs/TECH_STACK.md §5). Every
 * other dependency is bundled so the published package installs quickly.
 */

import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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

// The licence and a readme travel with the package. npm shows the readme on
// the package page, and a published artifact with no licence file is one a
// legal review has to ask about.
await copyFile('LICENSE', `${OUT_DIR}/LICENSE`);
await copyFile('NOTICE', `${OUT_DIR}/NOTICE`);
await writeFile(`${OUT_DIR}/README.md`, cliReadme(version));

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
      files: ['index.js', 'LICENSE', 'NOTICE', 'README.md'],
      // Apache-2.0, matching the repository. This said `MIT` until 2026-09-09,
      // which would have published the CLI under a licence the project does
      // not use — the kind of mistake that is cheap now and expensive later.
      license: 'Apache-2.0',
      repository: {
        type: 'git',
        url: 'git+https://github.com/fobstack/mallok.git',
        directory: 'src/cli',
      },
      homepage: 'https://github.com/fobstack/mallok#readme',
      bugs: { url: 'https://github.com/fobstack/mallok/issues' },
      keywords: [
        'cloudflare',
        'cloudflare-workers',
        'cms',
        'd1',
        'static-site',
      ],
    },
    null,
    2,
  )}\n`,
);

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`cli bundle: ${(bytes / 1024).toFixed(1)} KiB (sharp external)`);

/**
 * The readme npm shows on the package page.
 *
 * Deliberately short and pointed at the repository: duplicating the project's
 * own README here would be a second copy to keep in step, and it would go
 * stale first.
 */
function cliReadme(cliVersion) {
  return [
    '# mallok',
    '',
    'Command line interface for [Mallok](https://github.com/fobstack/mallok),',
    'an open-source content website that runs on your own Cloudflare account.',
    '',
    '```sh',
    'npx mallok create my-site   # provision D1, R2 and secrets, then deploy',
    'npx mallok publish ./content',
    'npx mallok --help',
    '```',
    '',
    '`sharp` is a peer of this package and is installed with it; it is used for',
    'local image processing and never runs inside the Worker.',
    '',
    `Version ${cliVersion}. Licensed under Apache-2.0; see \`LICENSE\`.`,
    '',
  ].join('\n');
}
