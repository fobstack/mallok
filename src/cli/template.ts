/**
 * Turning the packaged template into a project directory.
 *
 * The template ships **inside** the npm package, next to the CLI bundle. It is
 * not fetched at run time and not cloned from GitHub: a template downloaded
 * later is a template that can disagree with the CLI reading it, and the first
 * symptom of that is a generated project that does not build.
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

/** Where the packaged template lives, relative to the built CLI. */
export function templateRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'template');
}

/** Files whose presence means the template arrived intact. */
const REQUIRED = [
  'package.json',
  'pnpm-lock.yaml',
  'wrangler.jsonc',
  'tsconfig.json',
  'src/worker/index.ts',
  'src/runtime/core/index.ts',
  'src/db/migrations/0001_init.sql',
];

/**
 * Checks the template before anything is written.
 *
 * A truncated package produces a project that fails at `pnpm build`, several
 * minutes and one Cloudflare account later. Failing here costs nothing.
 */
export async function verifyTemplate(root = templateRoot()): Promise<void> {
  const missing: string[] = [];
  for (const file of REQUIRED) {
    try {
      await access(join(root, file));
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new CliError(
      EXIT.user,
      `The mallok package is missing template files: ${missing.join(', ')}.`,
      'Reinstall the package — `npm install -g mallok@latest` or `npx mallok@latest`.',
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
 * Deliberately a shape check rather than a marker file: a marker can be
 * deleted or copied, and what matters is whether the three files the next
 * steps will act on are actually there.
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
  /** The site's name, used in `package.json` and `site.json`. */
  readonly name: string;
  readonly templateDir?: string;
}

/**
 * Writes a complete project.
 *
 * Nothing is transformed except the manifest's name: the template is a working
 * project as it stands, and rewriting files on the way out is how a generator
 * produces something its own tests never saw.
 */
export async function generateProject(options: GenerateOptions): Promise<void> {
  const root = options.templateDir ?? templateRoot();
  await verifyTemplate(root);
  await mkdir(options.target, { recursive: true });
  await cp(root, options.target, { recursive: true });

  // npm strips a file called `.gitignore` out of a published tarball, so the
  // template carries it undotted and it is restored here. Without this a
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
 * `npx wrangler` resolves to the newest release on the registry, so a create
 * run could deploy with a Wrangler the project has never been built against —
 * and the failure would arrive after the resources existed. The binary in the
 * generated project's own `node_modules` is the one its lockfile pinned.
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
