/**
 * Turning the packaged shell into a project directory.
 *
 * The shell ships **inside** the npm package, beside the CLI bundle and the
 * framework entry it depends on. It is not fetched at run time and not cloned
 * from GitHub: a template downloaded later is a template that can disagree
 * with the code reading it, and the first symptom of that is a generated
 * project that does not build.
 *
 * What it contains is the point of 0.1.0-rc.3. A generated project holds its
 * own configuration, content, theme choice and plugins — and nothing of
 * Mallok's own source. The framework arrives as a dependency at an exact
 * version, so upgrading is `mallok upgrade --to <version>` rather than a merge
 * against a repository somebody forked months ago.
 */

import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, EXIT } from './output.js';

/** The installed package's root, whatever path it was installed under. */
export function packageRoot(): string {
  // `<package>/cli/index.js` → `<package>`.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Where the packaged project shell lives. */
export function templateRoot(): string {
  return join(packageRoot(), 'template');
}

/**
 * Where the compiled admin app and the official themes' files live.
 *
 * `mallok prepare` copies this into a site's `dist/assets`, which is what
 * Wrangler uploads to Static Assets.
 */
export function assetsRoot(): string {
  return join(packageRoot(), 'assets');
}

/** Files whose presence means the shell arrived intact. */
const REQUIRED = [
  'package.json',
  'mallok.json',
  'wrangler.jsonc',
  'tsconfig.json',
  'site.json',
  'src/worker/index.ts',
  'scripts/smoke.mjs',
  'test/project.test.ts',
];

/** Files whose presence means the framework half of the package arrived. */
const REQUIRED_PACKAGE = [
  'worker/index.js',
  'types/src/worker/framework.d.ts',
  'assets/_mallok/app/index.html',
];

/**
 * Checks the package before anything is written.
 *
 * A truncated install produces a project that fails at `npm run build`,
 * several minutes and one Cloudflare account later. Failing here costs
 * nothing.
 */
export async function verifyTemplate(root = templateRoot()): Promise<void> {
  const missing: string[] = [];
  for (const file of REQUIRED) {
    try {
      await access(join(root, file));
    } catch {
      missing.push(`template/${file}`);
    }
  }
  // Only meaningful for a real install; tests point `root` at a fixture.
  if (root === templateRoot()) {
    for (const file of REQUIRED_PACKAGE) {
      try {
        await access(join(packageRoot(), file));
      } catch {
        missing.push(file);
      }
    }
  }
  if (missing.length > 0) {
    throw new CliError(
      EXIT.user,
      `The mallok package is incomplete: ${missing.join(', ')}.`,
      'Reinstall it — `npm install -g mallok@latest` or `npx mallok@latest`.',
    );
  }
}

/** Whether a directory is absent or empty. */
export async function isUsableTarget(target: string): Promise<boolean> {
  try {
    const entries = await readdir(target);
    return entries.filter((name) => name !== '.DS_Store').length === 0;
  } catch {
    return true;
  }
}

/**
 * Whether a directory already holds a project this command generated.
 *
 * A shape check rather than a marker file: a marker can be deleted or copied,
 * and what matters is whether the files the next steps act on are there.
 */
export async function isMallokProject(target: string): Promise<boolean> {
  for (const file of [
    'package.json',
    'wrangler.jsonc',
    'src/worker/index.ts',
  ]) {
    try {
      await access(join(target, file));
    } catch {
      return false;
    }
  }
  return true;
}

export interface GenerateOptions {
  /** Absolute path of the directory to create. */
  readonly target: string;
  /** The site's name, used in `package.json`. */
  readonly name: string;
  readonly templateDir?: string;
}

/**
 * Writes a complete project.
 *
 * Nothing is transformed except the manifest's name: the shell is a working
 * project as it stands, and rewriting files on the way out is how a generator
 * produces something its own tests never saw.
 */
export async function generateProject(options: GenerateOptions): Promise<void> {
  const root = options.templateDir ?? templateRoot();
  await verifyTemplate(root);
  await mkdir(options.target, { recursive: true });
  await cp(root, options.target, { recursive: true });

  // npm strips a file called `.gitignore` out of a published tarball, so the
  // shell carries it undotted and it is restored here. Without this a
  // generated project has no ignore file at all, and the first `git add .`
  // stages `.dev.vars`.
  await rename(
    join(options.target, 'gitignore'),
    join(options.target, '.gitignore'),
  ).catch(() => undefined);

  const manifestPath = join(options.target, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >;
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, name: options.name }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * The Wrangler this project locked, not whatever `npx` would fetch.
 *
 * `npx wrangler` resolves to the newest release on the registry, so a command
 * could deploy — or delete — with a Wrangler the project has never been built
 * against, and the failure would arrive after the resources existed. The
 * binary in the project's own `node_modules` is the one its lockfile pinned.
 */
export function projectWrangler(projectDir: string): string {
  return resolve(projectDir, 'node_modules/.bin/wrangler');
}

/** Whether that binary is actually there yet. */
export async function hasProjectWrangler(projectDir: string): Promise<boolean> {
  try {
    await access(projectWrangler(projectDir));
    return true;
  } catch {
    return false;
  }
}
