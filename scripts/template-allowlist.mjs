/**
 * What a generated Mallok project contains.
 *
 * An **allowlist**, not an ignore list. The difference matters: a project
 * template is copied into a directory the user will commit and deploy, and an
 * ignore list fails open — the day someone adds `.env.production` or a
 * credential dump to the repository, a denylist ships it and nobody notices
 * until it is on npm. This list has to be edited to include anything, so the
 * failure mode is a missing file and a red build rather than a leaked secret.
 *
 * Everything here is either source the project builds from, configuration it
 * needs, or content the wizard imports.
 */

/** Whole directories, copied recursively. */
export const TEMPLATE_DIRECTORIES = [
  // The product itself, `src/runtime` included — Mallok is one package.
  'src',
  // Themes and starters live in `src`, but the build scripts and the content
  // the first-run wizard imports do not.
  'scripts',
  'content',
  // The project's own tests. A generated site has to be able to run the same
  // gate this repository does — `pnpm test` is part of what proves a template
  // is usable, and shipping a project that cannot test itself would make
  // "verified" mean less at every later step.
  'test',
];

/** Individual files. */
export const TEMPLATE_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'wrangler.jsonc',
  'tsconfig.json',
  'tsconfig.base.json',
  'biome.json',
  'vitest.config.ts',
  'vite.config.ts',
  'text-modules.d.ts',
  'site.json',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
  '.dev.vars.example',
  'LICENSE',
  'NOTICE',
];

/**
 * Never copied, whatever else matches.
 *
 * The allowlist above already excludes these by omission; this is the second
 * line, so a future directory addition cannot quietly bring one along. Each is
 * either a credential, a build output, or a machine-local artefact.
 */
export const TEMPLATE_DENY = [
  '.git',
  '.dev.vars',
  '.env',
  '.mallok',
  '.wrangler',
  '.tmp',
  '.claude',
  '.DS_Store',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '_to_delete',
];

/** Whether a path segment is refused outright. */
export function isDenied(name) {
  if (TEMPLATE_DENY.includes(name)) {
    return true;
  }
  // `.env`, `.env.local`, `.env.production` — all of them.
  if (name === '.env' || name.startsWith('.env.')) {
    return true;
  }
  // Any stray key material, whatever it is called.
  return /\.(pem|key|p12|pfx)$/i.test(name);
}
