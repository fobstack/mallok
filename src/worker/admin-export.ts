/**
 * Export (docs/CONTENT_FORMAT.md §5, §8).
 *
 * The Worker produces a **manifest**, not an archive. Zipping a whole site
 * would mean pulling every media object through the Worker, which neither the
 * CPU budget nor the memory budget allows and which contradicts "the Worker
 * does not process media" (docs/ARCHITECTURE.md §8). The CLI streams the
 * files to disk and the admin assembles a zip in the browser; both read this
 * one manifest, so both produce the same layout.
 *
 * Nothing secret is included: no sessions, no tokens, no plugin secrets, no
 * `render_cache` (docs/CONTENT_FORMAT.md §8).
 */

import {
  type BundleIdentity,
  bundleFileName,
  exportPathKey,
  exportPathProblem,
  formatBundleIdentity,
  slugify,
} from '../core/index.js';
import {
  type ContentRow,
  listAllForExport,
  listRedirects,
  listUnreferencedMedia,
  loadMediaBySha,
  loadSite,
  loadSiteRenderData,
} from '../db/queries.js';
import { activeTheme } from './composition.js';
import type { Env } from './env.js';
import { json, problem } from './http.js';
import { collectPluginExports } from './plugin-runtime.js';
import { parseSiteSettings } from './site.js';

/** Rows read per page; an export of any size walks these. */
const PAGE = 200;
const MAX_PAGES = 500;

/** One file the caller must write, and where its bytes come from. */
export interface ExportFile {
  /** Path inside the export directory. */
  readonly path: string;
  /** Inline text, for `index.md`, `mallok.json`, `site.json`, the CSVs. */
  readonly text?: string;
  /**
   * A media object the caller fetches itself. `url` is a path on this site
   * that serves the original bytes, so neither the CLI nor the browser needs
   * to know how media is stored.
   */
  readonly sha256?: string;
  readonly url?: string;
}

function bundleDirectorySlug(slug: string, translationGroup: string): string {
  const normalized = slugify(slug);
  return normalized === '' ? `item-${translationGroup}` : normalized;
}

function portableMediaName(original: string, ext: string): string {
  let name = '';
  for (const character of original.normalize('NFC')) {
    const codePoint = character.codePointAt(0) ?? 0;
    name +=
      '/\\<>:"|?*'.includes(character) ||
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? '-'
        : character;
  }
  name = name.replace(/^[ .]+|[ .]+$/g, '');
  if (name === '') {
    name = `file.${ext}`;
  }
  const characters = [...name];
  while (new TextEncoder().encode(characters.join('')).byteLength > 200) {
    characters.pop();
  }
  return characters.join('').replace(/[ .]+$/g, '') || `file.${ext}`;
}

function coreExportProblem(files: readonly ExportFile[]): string | null {
  const claimed = new Map<string, string>();
  for (const file of files) {
    const unsafe = exportPathProblem(file.path);
    if (unsafe !== null) {
      return `${JSON.stringify(file.path)} ${unsafe}`;
    }
    const key = exportPathKey(file.path);
    const previous = claimed.get(key);
    if (previous !== undefined) {
      return `${JSON.stringify(file.path)} conflicts with ${JSON.stringify(previous)}`;
    }
    claimed.set(key, file.path);
  }
  return null;
}

/** Turns rows into the file list an export writes. */
function buildFiles(
  rows: readonly ContentRow[],
  defaultLocale: string,
  mediaExt: ReadonlyMap<string, string>,
): ExportFile[] {
  const files: ExportFile[] = [];
  const claimedDirectories = new Set<string>();
  // Rows arrive ordered by kind then group, so a group's locales are adjacent.
  const groups = new Map<string, ContentRow[]>();
  for (const row of rows) {
    const key = `${row.kind}/${row.translation_group}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const [key, members] of groups) {
    const kind = key.split('/')[0] ?? 'page';
    // The bundle is named after the default-locale slug when there is one,
    // so a re-import lands in the same folder.
    const primary =
      members.find((row) => row.locale === defaultLocale) ?? members[0];
    if (primary === undefined) {
      continue;
    }
    const directorySlug = bundleDirectorySlug(
      primary.slug,
      primary.translation_group,
    );
    const baseDir = `content/${kind}/${directorySlug}`;
    const baseKey = exportPathKey(baseDir);
    let dir = claimedDirectories.has(baseKey)
      ? `${baseDir}-${primary.translation_group}`
      : baseDir;
    let collision = 2;
    while (claimedDirectories.has(exportPathKey(dir))) {
      dir = `${baseDir}-${primary.translation_group}-${collision}`;
      collision++;
    }
    claimedDirectories.add(exportPathKey(dir));
    const items: Record<
      string,
      { id: string; created_at: string; path: string; slug: string }
    > = Object.create(null) as Record<
      string,
      { id: string; created_at: string; path: string; slug: string }
    >;

    for (const row of members) {
      files.push({
        path: `${dir}/${bundleFileName(row.locale, defaultLocale)}`,
        // Byte-identical to what is stored: an export never rewrites source
        // text (docs/CONTENT_FORMAT.md §8).
        text: row.markdown,
      });
      items[row.locale] = {
        id: row.id,
        created_at: row.created_at,
        path: row.path,
        slug: row.slug,
      };
      let assets: Record<string, string> = {};
      try {
        assets = JSON.parse(row.assets) as Record<string, string>;
      } catch {
        assets = {};
      }
      for (const [relative, sha] of Object.entries(assets)) {
        const path = `${dir}/${relative}`;
        const ext = mediaExt.get(sha);
        // A hash with no media row is a dangling reference; the bundle keeps
        // the reference in its text and simply ships no file, which is the
        // documented "missing image" state (docs/CONTENT_FORMAT.md §4.6).
        if (ext !== undefined && !files.some((file) => file.path === path)) {
          files.push({ path, sha256: sha, url: `/media/${sha}.${ext}` });
        }
      }
    }

    const identity: BundleIdentity = {
      translation_group: primary.translation_group,
      items,
    };
    files.push({
      path: `${dir}/mallok.json`,
      text: formatBundleIdentity(identity),
    });
  }
  return files;
}

/** Escapes one CSV field per RFC 4180. */
function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** Serves the export manifest. */
export async function getExport(
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const siteRow = await loadSite(env.DB);
  if (siteRow === null) {
    return problem(503, 'Site is not initialized.');
  }
  const settings = parseSiteSettings(siteRow);

  const rows: ContentRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await listAllForExport(env.DB, PAGE, page * PAGE);
    rows.push(...batch);
    if (batch.length < PAGE) {
      break;
    }
  }

  // One lookup for every hash the export references, so the file list can
  // carry a ready-to-fetch URL instead of making the caller ask per file.
  const hashes = new Set<string>();
  for (const row of rows) {
    try {
      for (const sha of Object.values(
        JSON.parse(row.assets) as Record<string, string>,
      )) {
        hashes.add(sha);
      }
    } catch {
      // A malformed assets column costs that row its media, not the export.
    }
  }
  const mediaExt = new Map<string, string>();
  for (const media of await loadMediaBySha(env.DB, [...hashes])) {
    mediaExt.set(media.sha256, media.ext);
  }

  const files = buildFiles(rows, settings.defaultLocale, mediaExt);

  // Site settings, in the portable shape: no Worker, D1 or R2 identifiers
  // (docs/CONTENT_FORMAT.md §5).
  files.push({
    path: 'site.json',
    text: `${JSON.stringify(
      {
        name: settings.name,
        tagline: settings.tagline,
        defaultLocale: settings.defaultLocale,
        locales: settings.locales,
        kinds: settings.kinds,
        nav: settings.nav,
        seo: JSON.parse(siteRow.seo || '{}'),
        themeOptions: settings.themeOptions,
        // Recorded for information only: a theme is source code, so an
        // import cannot install it (docs/CONTENT_FORMAT.md §5).
        theme: {
          id: activeTheme().manifest.id,
          version: activeTheme().manifest.version,
          note: 'Themes ship with the source. Make sure the target build contains this one.',
        },
      },
      null,
      2,
    )}\n`,
  });

  const redirects = await listRedirects(env.DB);
  files.push({
    path: 'redirects.csv',
    text: `from,to,status\r\n${redirects
      .map((row) =>
        [row.from_path, row.to_path, row.status].map(csvCell).join(','),
      )
      .join('\r\n')}${redirects.length === 0 ? '' : '\r\n'}`,
  });

  for (const item of await listUnreferencedMedia(env.DB)) {
    files.push({
      // Unreferenced media keeps its original name, prefixed with a hash
      // fragment so two files of the same name cannot collide
      // (docs/CONTENT_FORMAT.md §5).
      path: `media/${item.sha256.slice(0, 8)}-${portableMediaName(item.original_name, item.ext)}`,
      sha256: item.sha256,
      url: `/media/${item.sha256}.${item.ext}`,
    });
  }

  const invalidCoreFile = coreExportProblem(files);
  if (invalidCoreFile !== null) {
    return problem(
      500,
      `The stored content cannot be exported safely: ${invalidCoreFile}.`,
    );
  }

  // Plugins that own business data contribute their own files; the core does
  // not know what an inquiry is (docs/CONTENT_FORMAT.md §5).
  const pluginData = await collectPluginExports(
    env,
    ctx,
    (await loadSiteRenderData(env.DB)).plugins,
    settings,
    files.map((file) => file.path),
  );
  files.push(...pluginData.files);

  return json({
    generatedFor: settings.name,
    pluginExportFailures: pluginData.failed,
    defaultLocale: settings.defaultLocale,
    files,
    counts: {
      content: rows.length,
      files: files.length,
      media: files.filter((file) => file.sha256 !== undefined).length,
    },
  });
}
