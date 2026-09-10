/**
 * Bundles the CLI for publishing to npm.
 *
 * `sharp` stays external: it is a native module and must be installed by the
 * consumer for their platform, not inlined (docs/TECH_STACK.md §5). Every
 * other dependency is bundled so the published package installs quickly.
 */

import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import {
  isDenied,
  TEMPLATE_DIRECTORIES,
  TEMPLATE_FILES,
} from './template-allowlist.mjs';

// The published CLI carries the repository's version. Hard-coding it here
// meant a release could ship a binary labelled `0.1.0-dev`, and the mismatch
// would only surface in a bug report months later.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));

const OUT_DIR = 'dist/cli';
const OUT_FILE = `${OUT_DIR}/index.js`;
const TEMPLATE_DIR = `${OUT_DIR}/template`;

await mkdir(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: OUT_FILE,
  external: ['sharp'],
  // The version is compiled in, not read from a file at run time: a published
  // binary that has to find its own package.json can be moved, symlinked or
  // bundled somewhere that file is not.
  // biome-ignore lint/style/useNamingConvention: esbuild `define` keys are source identifiers, and this one is a compile-time constant by convention
  define: { __MALLOK_VERSION__: JSON.stringify(version) },
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

// The project template. `mallok create` copies this into the directory it
// generates, so the package carries a complete, version-matched project rather
// than fetching one — a template downloaded at run time is a template that can
// disagree with the CLI that reads it.
await rm(TEMPLATE_DIR, { recursive: true, force: true });
await mkdir(TEMPLATE_DIR, { recursive: true });

let templateFiles = 0;
for (const directory of TEMPLATE_DIRECTORIES) {
  await cp(directory, join(TEMPLATE_DIR, directory), {
    recursive: true,
    filter: (source) => {
      const name = source.split('/').pop() ?? '';
      return !isDenied(name);
    },
  });
}
for (const file of TEMPLATE_FILES) {
  await copyFile(file, join(TEMPLATE_DIR, file));
}

// Things that build or publish the CLI, which a site does not do. Shipping
// them gives every new project a failing test and two scripts it cannot run.
for (const file of [
  // These three test the *CLI package* — its tarball, its installed binary,
  // and the ordering of `create`. A generated site builds no CLI, so shipping
  // them would give every new project a failing suite on day one.
  'test/cli/package-release.test.ts',
  'test/cli/create-preflight.test.ts',
  'scripts/build-cli.mjs',
  'scripts/template-allowlist.mjs',
  'scripts/refuse-publish.mjs',
]) {
  await rm(join(TEMPLATE_DIR, file), { force: true });
}

// The generated project is a site, not a copy of this repository: it is
// private, has no publish scripts, and carries its own name.
const projectManifest = JSON.parse(await readFile('package.json', 'utf8'));
delete projectManifest.publishConfig;
// Scripts that belong to this repository and not to a generated site: one
// packs the CLI, and one refuses to publish it. A site inheriting
// `prepublishOnly` would be unable to publish itself if its owner ever wanted
// to.
for (const script of ['release:pack', 'build:cli', 'prepublishOnly']) {
  delete projectManifest.scripts[script];
}
// A site does not build a CLI, so the chain that produced one has to go too.
// Leaving it in makes `pnpm build` fail on a missing script in every project
// this template creates.
projectManifest.scripts.build = projectManifest.scripts.build
  .split(' && ')
  .filter((part) => !part.includes('build:cli'))
  .join(' && ');
await writeFile(
  join(TEMPLATE_DIR, 'package.json'),
  `${JSON.stringify(
    {
      ...projectManifest,
      name: 'mallok-site',
      version: '0.1.0',
      private: true,
      description: 'A Mallok site.',
    },
    null,
    2,
  )}\n`,
);

// A `.gitignore` written for a site rather than copied from this repository:
// the repository's own has entries that mean nothing in a generated project,
// and the entries that matter most here are the ones that keep a credential
// out of the user's first commit.
// Written as `gitignore`, without the dot. **npm removes a file named
// `.gitignore` from a tarball**, so a template that ships one arrives without
// it and the first `git add .` in a generated project stages `.dev.vars`.
// `mallok create` renames it on the way out.
await writeFile(
  join(TEMPLATE_DIR, 'gitignore'),
  [
    'node_modules/',
    'dist/',
    '.wrangler/',
    '',
    '# Local secrets and the record of what was provisioned. Never commit',
    '# either: the first holds credentials, the second names your resources.',
    '.dev.vars',
    '.env',
    '.env.*',
    '.mallok/',
    '',
    '.DS_Store',
    '*.log',
    '',
  ].join('\n'),
);

for await (const entry of walk(TEMPLATE_DIR)) {
  void entry;
  templateFiles += 1;
}

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
      files: ['index.js', 'template', 'LICENSE', 'NOTICE', 'README.md'],
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
console.log(`project template: ${templateFiles} files`);

/** Every file under a directory, recursively. */
async function* walk(directory) {
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

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
