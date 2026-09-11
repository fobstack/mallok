/**
 * `mallok prepare` — stage everything Static Assets serves.
 *
 * A Mallok site uploads two kinds of file it does not itself compile: the
 * admin application, and the theme's stylesheets and images. Both ship inside
 * the `mallok` package, and this copies them into the project's `dist/assets`
 * so that `wrangler deploy` uploads them.
 *
 * It runs before every build and every deploy, and it is idempotent — the
 * directory is rebuilt from the package each time, so a stale asset from an
 * older version cannot survive an upgrade.
 */

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { readThemePackage, ThemePackageError } from '../core/index.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { assetsRoot } from './template.js';

/** Where a project may keep a theme of its own. */
const PROJECT_THEME = 'src/theme';

export interface PrepareResult {
  readonly assets: number;
  readonly projectTheme: string | null;
}

/** Every file under a directory, as forward-slashed relative paths. */
async function readTree(
  dir: string,
): Promise<{ path: string; bytes: Uint8Array }[]> {
  const out: { path: string; bytes: Uint8Array }[] = [];
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = join(entry.parentPath, entry.name);
    out.push({
      path: relative(dir, absolute).split(sep).join('/'),
      bytes: new Uint8Array(await readFile(absolute)),
    });
  }
  return out;
}

async function countFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

/** Stages the package's assets, and the project's own theme if it has one. */
export async function prepareAssets(
  projectDir: string,
  report: Reporter,
): Promise<PrepareResult> {
  const source = assetsRoot();
  const target = join(projectDir, 'dist/assets');

  const staged = await countFiles(source);
  if (staged === 0) {
    throw new CliError(
      EXIT.user,
      'The mallok package carries no assets to stage.',
      'Reinstall it: the admin application is part of the package.',
    );
  }

  // Rebuilt rather than merged: an asset left behind by an older version is
  // a file the site still serves and nobody can explain.
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });

  let projectTheme: string | null = null;
  const themeDir = join(projectDir, PROJECT_THEME);
  try {
    await readdir(themeDir);
  } catch {
    report.step(`Staged ${staged} asset files.`);
    return { assets: staged, projectTheme: null };
  }

  // A theme in the project is validated here, in the author's terminal,
  // rather than at first render on a deployed site.
  let pkg: ReturnType<typeof readThemePackage>;
  try {
    pkg = readThemePackage(await readTree(themeDir), 'theme');
  } catch (error) {
    throw new CliError(
      EXIT.user,
      `${PROJECT_THEME} is not a valid theme: ${
        error instanceof ThemePackageError || error instanceof Error
          ? error.message
          : String(error)
      }`,
      'See https://github.com/fobstack/mallok/blob/main/docs/THEME_FORMAT.md',
    );
  }
  projectTheme = `${pkg.manifest.id}@${pkg.manifest.version}`;

  const assetCount = Object.keys(pkg.assets).length;
  if (assetCount > 0) {
    // Staged under the theme's version, so the URLs change only when the
    // theme does and can therefore be cached forever.
    const themeTarget = join(
      target,
      'theme',
      pkg.manifest.id,
      pkg.manifest.version,
    );
    await mkdir(themeTarget, { recursive: true });
    await cp(join(themeDir, 'assets'), themeTarget, { recursive: true });
  }

  // Static Assets applies `max-age=0, must-revalidate` unless a `_headers`
  // file says otherwise. Theme asset URLs carry the theme version, so they
  // are immutable; `nosniff` is there because a theme is only half-trusted.
  await writeFile(
    join(target, '_headers'),
    [
      '/theme/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '  X-Content-Type-Options: nosniff',
      '',
    ].join('\n'),
    'utf8',
  );

  report.step(
    `Staged ${staged + assetCount} asset files, including ${projectTheme}.`,
  );
  return { assets: staged + assetCount, projectTheme };
}
