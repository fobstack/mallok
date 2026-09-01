/**
 * Validates every theme in `src/themes/` and stages its assets for Static
 * Assets.
 *
 * This is where a theme is checked (docs/THEME_FORMAT.md §3): the same rules
 * that used to run when an archive was uploaded now run here, so a broken
 * theme fails the build in the author's terminal instead of after a deploy.
 *
 * Run by `pnpm build` before Wrangler bundles the Worker.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { build } from 'esbuild';

const THEMES_DIR = 'src/themes';
const ASSETS_DIR = 'dist/assets';

/** Bundles the validator out of `src/core` so this script can call it. */
async function loadValidator() {
  await mkdir('dist/build', { recursive: true });
  await build({
    entryPoints: ['src/core/theme-package.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    conditions: ['workerd', 'worker', 'browser'],
    target: 'es2022',
    outfile: 'dist/build/theme-package.mjs',
    logLevel: 'warning',
  });
  return import('../dist/build/theme-package.mjs');
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
async function readTree(dir) {
  const out = [];
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = join(entry.parentPath ?? entry.path, entry.name);
    out.push({
      path: relative(dir, absolute).split(sep).join('/'),
      bytes: new Uint8Array(await readFile(absolute)),
    });
  }
  return out;
}

const { readThemePackage, ThemePackageError } = await loadValidator();

const themeDirs = (await readdir(THEMES_DIR, { withFileTypes: true })).filter(
  (entry) => entry.isDirectory(),
);

await rm(join(ASSETS_DIR, 'theme'), { recursive: true, force: true });

let failures = 0;
for (const dir of themeDirs) {
  const source = join(THEMES_DIR, dir.name);
  let pkg;
  try {
    pkg = readThemePackage(await readTree(source), dir.name);
  } catch (error) {
    failures++;
    const detail =
      error instanceof ThemePackageError || error instanceof Error
        ? error.message
        : String(error);
    console.error(`✗ ${dir.name}: ${detail}`);
    continue;
  }

  // Assets are staged under the theme's version, so their URLs change only
  // when the theme does and can therefore be cached forever.
  const target = join(
    ASSETS_DIR,
    'theme',
    pkg.manifest.id,
    pkg.manifest.version,
  );
  await mkdir(target, { recursive: true });
  const assetCount = Object.keys(pkg.assets).length;
  if (assetCount > 0) {
    await cp(join(source, 'assets'), target, { recursive: true });
  }
  console.log(
    `✓ ${pkg.manifest.id}@${pkg.manifest.version}: ` +
      `${Object.keys(pkg.files).length} templates, ${assetCount} assets`,
  );
}

// Static Assets applies its own headers unless a `_headers` file says
// otherwise, and its default is `max-age=0, must-revalidate`. Theme asset
// URLs carry the theme version, so they can be cached forever; `nosniff` is
// there because a theme is only half-trusted (docs/THEME_FORMAT.md §11).
await writeFile(
  join(ASSETS_DIR, '_headers'),
  [
    '/theme/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '  X-Content-Type-Options: nosniff',
    '',
  ].join('\n'),
);

if (failures > 0) {
  console.error(
    `\n${failures} theme(s) failed validation. See docs/THEME_FORMAT.md §3.`,
  );
  process.exit(1);
}
