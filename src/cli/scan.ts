/**
 * Reading article bundles off disk (docs/CLI.md §6.1, §6.2).
 *
 * Three layouts are accepted and identified rather than guessed at; a
 * directory that matches none stops the run with the list of what could not
 * be recognised (docs/CONTENT_FORMAT.md §7.1).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  type BundleIdentity,
  collectAssetPaths,
  detectLayout,
  type ImportLayout,
  localeFromFileName,
  parseBundleIdentity,
} from '../core/index.js';
import { CliError, EXIT } from './output.js';

/** One locale's document inside a bundle. */
export interface BundleDocument {
  readonly locale: string;
  readonly fileName: string;
  /** Verbatim file text; this is what gets stored. */
  readonly markdown: string;
  /** Relative path → absolute path on disk, for files that exist. */
  readonly assets: ReadonlyMap<string, string>;
  /** Referenced paths with no file behind them (a normal state). */
  readonly missing: readonly string[];
}

/** One article bundle read from disk. */
export interface Bundle {
  /** Directory name, used as the default slug. */
  readonly name: string;
  readonly dir: string;
  readonly kind: string;
  readonly documents: readonly BundleDocument[];
  readonly identity: BundleIdentity | null;
  /** Image slots the pipeline declared but has not filled yet (§7.5). */
  readonly unfilledSlots: readonly string[];
}

/** What a scan produced. */
export interface ScanResult {
  readonly layout: ImportLayout;
  readonly bundles: readonly Bundle[];
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(dir, full).split(sep).join('/'));
      }
    }
  };
  await walk(dir);
  return out;
}

/** Hex sha256 of a file's bytes. */
export async function hashFile(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

/** Reads `image-slots.json`, returning the slots with no file yet. */
async function readUnfilledSlots(
  dir: string,
  present: ReadonlySet<string>,
): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(dir, 'image-slots.json'), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const slots = Array.isArray(parsed)
      ? parsed
      : ((parsed as { slots?: unknown })?.slots ?? []);
    if (!Array.isArray(slots)) {
      return [];
    }
    return slots
      .map((slot) =>
        typeof slot === 'string'
          ? slot
          : typeof (slot as { path?: unknown })?.path === 'string'
            ? (slot as { path: string }).path
            : null,
      )
      .filter((slot): slot is string => slot !== null && !present.has(slot));
  } catch {
    return [];
  }
}

async function readDocument(
  dir: string,
  fileName: string,
  locale: string,
  fields: Parameters<typeof collectAssetPaths>[1],
): Promise<BundleDocument> {
  const markdown = await readFile(join(dir, fileName), 'utf8');
  const referenced = collectAssetPaths(markdown, fields);
  const assets = new Map<string, string>();
  const missing: string[] = [];
  for (const path of referenced) {
    const full = join(dir, ...path.split('/'));
    try {
      const info = await stat(full);
      if (info.isFile()) {
        assets.set(path, full);
        continue;
      }
    } catch {
      // Falls through to "missing", which is a normal state.
    }
    missing.push(path);
  }
  return { locale, fileName, markdown, assets, missing };
}

/** Inputs of {@link scanDirectory}. */
export interface ScanOptions {
  readonly defaultLocale: string;
  /** Enabled content kinds; a directory must match one of these. */
  readonly kinds: readonly string[];
  /** Forces the kind for every bundle, from `--kind`. */
  readonly kind?: string;
  /** Field declarations per kind, so media fields are scanned. */
  readonly fields?: Readonly<
    Record<string, Parameters<typeof collectAssetPaths>[1]>
  >;
}

/**
 * Reads every bundle under `root`.
 *
 * The kind comes from `--kind` when given, otherwise from the directory that
 * holds the bundle. An unrecognised directory stops the run: guessing, or
 * quietly filing everything under `article`, would put content at a URL the
 * author did not choose (docs/CONTENT_FORMAT.md §7.1).
 */
export async function scanDirectory(
  root: string,
  options: ScanOptions,
): Promise<ScanResult> {
  const paths = await listFiles(root);
  const layout = detectLayout(paths);
  if (layout === null) {
    throw new CliError(
      EXIT.user,
      `No Markdown found in ${root}.`,
      'Expected an export directory, a folder of article bundles, or loose .md files.',
    );
  }

  /** Directories that hold an `index*.md`, with their kind directory. */
  const bundleDirs = new Map<string, string>();
  const flatFiles: string[] = [];
  for (const path of paths) {
    const parts = path.split('/');
    const file = parts.at(-1) ?? '';
    if (!file.endsWith('.md')) {
      continue;
    }
    if (/^index(\.[^.]+)?\.md$/.test(file) && parts.length > 1) {
      const dir = parts.slice(0, -1).join('/');
      bundleDirs.set(dir, parts.length > 2 ? (parts.at(-3) ?? '') : '');
      continue;
    }
    if (parts.length === 1 || layout === 'flat') {
      flatFiles.push(path);
    }
  }

  const unknownKinds = new Set<string>();
  const resolveKind = (fromPath: string): string | null => {
    if (options.kind !== undefined) {
      return options.kind;
    }
    if (fromPath !== '' && options.kinds.includes(fromPath)) {
      return fromPath;
    }
    unknownKinds.add(fromPath === '' ? '(top level)' : fromPath);
    return null;
  };

  const bundles: Bundle[] = [];

  for (const [dir, kindDir] of bundleDirs) {
    const kind = resolveKind(kindDir);
    if (kind === null) {
      continue;
    }
    const absolute = join(root, ...dir.split('/'));
    const fields = options.fields?.[kind] ?? {};
    const documents: BundleDocument[] = [];
    for (const entry of await readdir(absolute)) {
      const locale = localeFromFileName(entry, options.defaultLocale);
      if (locale !== null) {
        documents.push(await readDocument(absolute, entry, locale, fields));
      }
    }
    documents.sort((a, b) => a.locale.localeCompare(b.locale));

    let identity: BundleIdentity | null = null;
    try {
      identity = parseBundleIdentity(
        await readFile(join(absolute, 'mallok.json'), 'utf8'),
      );
    } catch {
      identity = null;
    }

    const present = new Set<string>();
    for (const document of documents) {
      for (const path of document.assets.keys()) {
        present.add(path);
      }
    }
    bundles.push({
      name: dir.split('/').at(-1) ?? dir,
      dir: absolute,
      kind,
      documents,
      identity,
      unfilledSlots: await readUnfilledSlots(absolute, present),
    });
  }

  for (const path of flatFiles) {
    const kind = resolveKind(
      path.includes('/') ? (path.split('/').at(-2) ?? '') : '',
    );
    if (kind === null) {
      continue;
    }
    const parts = path.split('/');
    const absolute = join(root, ...parts.slice(0, -1));
    const fileName = parts.at(-1) ?? '';
    const fields = options.fields?.[kind] ?? {};
    bundles.push({
      name: fileName.replace(/\.md$/, ''),
      dir: absolute,
      kind,
      documents: [
        await readDocument(absolute, fileName, options.defaultLocale, fields),
      ],
      identity: null,
      unfilledSlots: [],
    });
  }

  if (bundles.length === 0 && unknownKinds.size > 0) {
    throw new CliError(
      EXIT.user,
      `These folders do not match any content type enabled on the site: ${[
        ...unknownKinds,
      ].join(', ')}.`,
      `Enabled types: ${options.kinds.join(', ')}. Pass --kind to set one explicitly.`,
    );
  }
  bundles.sort((a, b) => a.name.localeCompare(b.name));
  return { layout, bundles };
}
