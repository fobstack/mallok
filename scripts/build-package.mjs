/**
 * Builds the publishable `mallok` package.
 *
 * The package carries the whole framework, not just a command line tool:
 *
 *   cli/index.js     the `mallok` binary
 *   worker/index.js  `mallok/worker` — createMallok, the official themes and
 *                    the official plugins, with every template, stylesheet
 *                    and migration inlined as text
 *   types/worker.d.ts  the declarations for that entry
 *   assets/          the compiled admin app and the official themes' assets,
 *                    staged into a site's `dist/assets` by `mallok prepare`
 *   template/        the thin project shell `mallok create` writes
 *
 * That is the whole point of 0.1.0-rc.3: a generated project depends on this
 * package at an exact version instead of being a **copy of this repository**,
 * so upgrading is one number rather than a merge.
 *
 * `sharp` stays external: it is a native module and must be installed for the
 * consumer's platform, not inlined (docs/TECH_STACK.md §5).
 */

import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { thirdPartyNotices } from './third-party-notices.mjs';

const run = promisify(execFile);

const { version } = JSON.parse(await readFile('package.json', 'utf8'));

const OUT = 'dist/pkg';

/**
 * The two builds this one packages.
 *
 * Run here rather than chained in `package.json` so that one command produces
 * a complete package: the release test calls this script and nothing else,
 * and a package built from a stale `dist/` is the kind of green that means
 * nothing.
 */
for (const [label, command, args] of [
  ['themes', 'node', ['scripts/build-themes.mjs']],
  ['admin', 'npx', ['vite', 'build']],
]) {
  process.stdout.write(`building ${label}…\n`);
  await run(command, args, { maxBuffer: 32 * 1024 * 1024 });
}

/** Text the Worker bundle inlines, matching wrangler.jsonc's Text rule. */
const TEXT_LOADERS = {
  '.liquid': 'text',
  '.css': 'text',
  '.sql': 'text',
  '.md': 'text',
};

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// ---- The framework entry -------------------------------------------------
//
// Bundled for workerd, not Node: it is imported by a site's Worker and then
// re-bundled by that site's Wrangler. Pre-bundling here is what lets the
// shell stay a shell — it needs no loaders, no aliases and no knowledge of
// how Mallok is laid out inside.
const worker = await build({
  entryPoints: ['src/worker/framework.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  target: 'es2022',
  outfile: `${OUT}/worker/index.js`,
  loader: TEXT_LOADERS,
  // Left for the consumer's bundler: these are workerd built-ins.
  external: ['cloudflare:*', 'node:*'],
  metafile: true,
  logLevel: 'warning',
});

// ---- The CLI -------------------------------------------------------------
const cli = await build({
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: `${OUT}/cli/index.js`,
  external: ['sharp'],
  loader: TEXT_LOADERS,
  // Compiled in, not read from a file at run time: a published binary that
  // has to find its own package.json can be moved, symlinked or bundled
  // somewhere that file is not.
  // biome-ignore lint/style/useNamingConvention: an esbuild `define` key is a source identifier, and this one is a compile-time constant by convention
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
  metafile: true,
  logLevel: 'warning',
});
await chmod(`${OUT}/cli/index.js`, 0o755);

// ---- Types ---------------------------------------------------------------
//
// The hand-written public surface, not a declaration emit. `tsc` follows
// every `.d.ts` it loads, and an emitted tree reaches `zod`, `mdast` and
// `hast` through the core barrel — packages this one does not depend on, so a
// site with `skipLibCheck` turned off could not compile at all. What keeps
// this file honest is `test/types/public-surface.ts`, which type-checks the
// implementation against it (src/worker/public.d.ts explains the choice).
await mkdir(`${OUT}/types`, { recursive: true });
await copyFile('src/worker/public.d.ts', `${OUT}/types/worker.d.ts`);

// ---- Assets --------------------------------------------------------------
//
// The compiled admin app and the official themes' files, exactly as they are
// served. `mallok prepare` copies this directory into a site's `dist/assets`.
await cp('dist/assets', `${OUT}/assets`, { recursive: true });

// ---- The project shell ---------------------------------------------------
await cp('template', `${OUT}/template`, { recursive: true });

// The shell's manifest is written here, not committed, because the one thing
// it must get right is the **exact** version of this package — and that is
// only known at build time. No caret, no `file:`, no `workspace:`: a site
// upgrades by running `mallok upgrade --to <version>`, which is a decision,
// not something an install does to you.
await writeFile(
  `${OUT}/template/package.json`,
  `${JSON.stringify(
    {
      name: 'mallok-site',
      version: '0.1.0',
      private: true,
      description: 'A Mallok site.',
      type: 'module',
      engines: { node: '>=22' },
      scripts: {
        dev: 'mallok prepare && wrangler dev',
        build:
          'mallok prepare && wrangler deploy --dry-run --outdir dist/worker',
        deploy: 'mallok prepare && wrangler deploy',
        lint: 'biome check .',
        'lint:fix': 'biome check --write .',
        typecheck: 'tsc --noEmit',
        // Node's own runner: a site should not need a test framework and a
        // version of it to keep in step with the framework's own.
        test: 'node --experimental-strip-types --test "test/*.test.ts"',
        smoke: 'node scripts/smoke.mjs',
      },
      dependencies: {
        mallok: version,
      },
      devDependencies: {
        '@biomejs/biome': '2.5.11',
        '@cloudflare/workers-types': '5.20260828.1',
        '@types/node': '22.20.1',
        typescript: '5.9.3',
        wrangler: '4.124.0',
      },
    },
    null,
    2,
  )}\n`,
);

// ---- Package metadata ----------------------------------------------------
await copyFile('LICENSE', `${OUT}/LICENSE`);
await copyFile('NOTICE', `${OUT}/NOTICE`);

// Attribution for what the two bundles above actually inlined, read from
// their own metafiles. Redistributing a bundle without the notices of what is
// inside it is a licence breach, not a documentation gap.
const notices = await thirdPartyNotices([worker, cli]);
await writeFile(`${OUT}/THIRD_PARTY_NOTICES`, notices.text, 'utf8');
await writeFile(`${OUT}/README.md`, packageReadme(version));

await writeFile(
  `${OUT}/package.json`,
  `${JSON.stringify(
    {
      name: 'mallok',
      version,
      description:
        'Cloudflare-native content website framework: Markdown in D1, instant publishing, no build step.',
      type: 'module',
      bin: { mallok: './cli/index.js' },
      exports: {
        '.': {
          types: './types/worker.d.ts',
          default: './worker/index.js',
        },
        './worker': {
          types: './types/worker.d.ts',
          default: './worker/index.js',
        },
        './package.json': './package.json',
      },
      files: [
        'cli',
        'worker',
        'types',
        'assets',
        'template',
        'LICENSE',
        'NOTICE',
        'THIRD_PARTY_NOTICES',
        'README.md',
      ],
      engines: { node: '>=22' },
      dependencies: { sharp: '0.35.4' },
      license: 'Apache-2.0',
      repository: {
        type: 'git',
        url: 'git+https://github.com/fobstack/mallok.git',
      },
      homepage: 'https://github.com/fobstack/mallok#readme',
      bugs: { url: 'https://github.com/fobstack/mallok/issues' },
      keywords: [
        'cloudflare',
        'cloudflare-workers',
        'cms',
        'd1',
        'framework',
        'static-site',
      ],
    },
    null,
    2,
  )}\n`,
);

const workerBytes = Object.values(worker.metafile.outputs).reduce(
  (sum, output) => sum + output.bytes,
  0,
);
const cliBytes = Object.values(cli.metafile.outputs).reduce(
  (sum, output) => sum + output.bytes,
  0,
);
console.log(`worker entry: ${(workerBytes / 1024).toFixed(1)} KiB`);
console.log(
  `cli bundle:   ${(cliBytes / 1024).toFixed(1)} KiB (sharp external)`,
);
console.log(`notices:      ${notices.packages.length} bundled packages`);

/**
 * The readme npm shows on the package page.
 *
 * Short and pointed at the repository: a second copy of the project's README
 * is a second thing to keep in step, and it goes stale first.
 */
function packageReadme(packageVersion) {
  return [
    '# mallok',
    '',
    '[Mallok](https://github.com/fobstack/mallok) is an open-source,',
    'Cloudflare-native framework for content websites: Markdown in D1,',
    'published instantly, running on your own account.',
    '',
    '```sh',
    'npx mallok create my-site        # a project, verified locally, then deployed',
    'cd my-site',
    'npx mallok upgrade --to <version>',
    '```',
    '',
    'The project it creates is a thin shell: its configuration, its content,',
    'its theme choice and its plugins. The framework itself is this package,',
    'imported by four lines in `src/worker/index.ts`:',
    '',
    '```ts',
    "import { atelier, createMallok, inquiry } from 'mallok/worker';",
    '',
    'export default createMallok({ theme: atelier, plugins: [inquiry] });',
    '```',
    '',
    '`sharp` is a dependency of this package and is used for local image',
    'processing only; it never runs inside the Worker.',
    '',
    `Version ${packageVersion}. Licensed under Apache-2.0; see \`LICENSE\`.`,
    '',
  ].join('\n');
}
