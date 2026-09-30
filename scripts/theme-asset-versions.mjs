/**
 * Keeps theme asset URLs naming the bytes they serve.
 *
 * `scripts/build-themes.mjs` stages a theme's assets under
 * `/theme/<id>/<version>/` and serves them `immutable` for a year, so a
 * browser that has fetched one never asks for it again. An asset changed
 * without bumping `theme.json`'s `version` therefore reaches new visitors
 * only, and everyone else keeps the old file (docs/THEME_FORMAT.md §13). That
 * is how Atelier's carousel fix first went out under the unchanged 2.5.0, and
 * nothing noticed.
 *
 * `test/core/theme-asset-versions.json` records, per theme, the version last
 * recorded and the SHA-256 of every file under its `assets/`. A theme whose
 * bytes differ from the record under the same version fails the test, and so
 * does a new version nobody recorded — otherwise the next change would have
 * nothing to be compared against.
 *
 *   pnpm themes:record
 *
 * records every theme whose version moved forward, and refuses to record one
 * whose assets changed under the version it already had.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const THEMES_DIR = 'src/themes';
export const RECORD_PATH = 'test/core/theme-asset-versions.json';
const RECORD_COMMAND = 'pnpm themes:record';

/** Every theme's version and asset digests, keyed by directory name. */
export async function fingerprintThemes(themesDir = THEMES_DIR) {
  const names = (await readdir(themesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const themes = {};
  for (const name of names) {
    const dir = join(themesDir, name);
    const manifest = JSON.parse(
      await readFile(join(dir, 'theme.json'), 'utf8'),
    );
    themes[name] = {
      version: manifest.version,
      assets: await digestTree(join(dir, 'assets')),
    };
  }
  return themes;
}

/** SHA-256 of every file under `dir`, keyed by its forward-slash path. */
async function digestTree(dir) {
  if (!existsSync(dir)) {
    return {};
  }
  const files = [];
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = join(entry.parentPath ?? entry.path, entry.name);
    const digest = createHash('sha256')
      .update(await readFile(absolute))
      .digest('hex');
    files.push([relative(dir, absolute).split(sep).join('/'), digest]);
  }
  files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(files);
}

/** Paths added, removed or changed between two digest maps, sorted. */
function changedAssets(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter((path) => before[path] !== after[path])
    .sort()
    .map((path) => `assets/${path}`);
}

/** Negative, zero or positive, comparing two `x.y.z` versions numerically. */
function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * How one theme stands against its record: `ok`, `unrecorded` (new theme or a
 * newer version, fixed by recording it), or a refusal — `changed` or
 * `backwards` — that recording must not paper over.
 */
function classify(name, recorded, theme) {
  if (recorded === undefined) {
    return {
      kind: 'unrecorded',
      message: `${name}@${theme.version} is not recorded. Run \`${RECORD_COMMAND}\`.`,
    };
  }
  if (theme.version === recorded.version) {
    const changed = changedAssets(recorded.assets, theme.assets);
    if (changed.length === 0) {
      return { kind: 'ok', message: '' };
    }
    return {
      kind: 'changed',
      message:
        `${name}@${theme.version} changed ${changed.join(', ')} without a ` +
        `new version. Its assets are cached as immutable under that version ` +
        `(docs/THEME_FORMAT.md §13): bump "version" in ` +
        `src/themes/${name}/theme.json, then run \`${RECORD_COMMAND}\`.`,
    };
  }
  if (compareVersions(theme.version, recorded.version) < 0) {
    return {
      kind: 'backwards',
      message:
        `${name} went from ${recorded.version} back to ${theme.version}. A ` +
        `version only moves forward: an older one's URLs may already be ` +
        `cached with different bytes.`,
    };
  }
  return {
    kind: 'unrecorded',
    message:
      `${name}@${theme.version} is not recorded (the record has ` +
      `${recorded.version}). Run \`${RECORD_COMMAND}\`.`,
  };
}

function recordedTheme(record, name) {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/**
 * Every way `current` disagrees with `record`, one sentence each. Empty means
 * every theme's asset URLs still name the bytes they serve.
 */
export function compareThemeAssets(record, current) {
  const problems = [];
  for (const [name, theme] of Object.entries(current)) {
    const verdict = classify(name, recordedTheme(record, name), theme);
    if (verdict.kind !== 'ok') {
      problems.push(verdict.message);
    }
  }
  for (const name of Object.keys(record)) {
    if (!Object.hasOwn(current, name)) {
      problems.push(
        `${name} is recorded but no longer exists. Run \`${RECORD_COMMAND}\`.`,
      );
    }
  }
  return problems;
}

/**
 * The record `current` should leave behind, and the themes it refused to
 * record. A refused theme keeps its old entry, so the test goes on failing
 * until its version is bumped.
 */
export function recordThemeAssets(record, current) {
  const next = {};
  const refused = [];
  for (const [name, theme] of Object.entries(current)) {
    const recorded = recordedTheme(record, name);
    const verdict = classify(name, recorded, theme);
    if (verdict.kind === 'changed' || verdict.kind === 'backwards') {
      refused.push(verdict.message);
      next[name] = recorded;
    } else {
      next[name] = theme;
    }
  }
  return { record: next, refused };
}

async function readRecord(path) {
  return existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : {};
}

// `node scripts/theme-asset-versions.mjs` checks; `--record` records.
if (process.argv[1]?.endsWith('theme-asset-versions.mjs')) {
  const record = await readRecord(RECORD_PATH);
  const current = await fingerprintThemes();
  if (process.argv.includes('--record')) {
    const { record: next, refused } = recordThemeAssets(record, current);
    await writeFile(RECORD_PATH, `${JSON.stringify(next, null, 2)}\n`);
    for (const message of refused) {
      console.error(`✗ ${message}`);
    }
    process.exitCode = refused.length > 0 ? 1 : 0;
  } else {
    const problems = compareThemeAssets(record, current);
    for (const message of problems) {
      console.error(`✗ ${message}`);
    }
    process.exitCode = problems.length > 0 ? 1 : 0;
  }
}
