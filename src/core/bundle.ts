/**
 * Article bundles: the portable unit of Mallok content
 * (docs/CONTENT_FORMAT.md §3–§7).
 *
 * Everything here is pure so the CLI, the admin and the tests all derive the
 * same values from the same bytes. The rule the whole format rests on is
 * that **`index.md` is never rewritten**: aliases are derived into a separate
 * view, relative paths are normalised only as map keys, and an export writes
 * the stored text back verbatim.
 */

import { normalizeRelativePath } from './assets.js';
import { splitFrontmatter } from './frontmatter.js';
import type { ThemeField } from './theme.js';

/** Front-matter keys other tools use for the same thing (§3.3). */
const ALIASES: Readonly<Record<string, string>> = {
  pubDate: 'date',
  publishDate: 'date',
  published: 'date',
  updatedDate: 'updated',
  lastmod: 'updated',
  modified: 'updated',
  heroImage: 'cover',
  image: 'cover',
  featured_image: 'cover',
  thumbnail: 'cover',
  summary: 'description',
  excerpt: 'description',
};

/**
 * Applies the import aliases, producing the canonical view stored in
 * `content.frontmatter`.
 *
 * A canonical key already present always wins — an alias fills a gap, it
 * never overrides what the author wrote explicitly. `categories` is the one
 * that merges rather than replaces, because a document may legitimately
 * carry both it and `tags`.
 */
export function deriveFrontmatter(
  raw: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (raw[alias] === undefined || out[canonical] !== undefined) {
      continue;
    }
    out[canonical] = raw[alias];
  }
  if (Array.isArray(raw.categories)) {
    const extra = raw.categories.filter(
      (entry): entry is string => typeof entry === 'string',
    );
    const existing = Array.isArray(out.tags)
      ? out.tags.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const merged = [...existing];
    for (const entry of extra) {
      if (!merged.includes(entry)) {
        merged.push(entry);
      }
    }
    if (merged.length > 0) {
      out.tags = merged;
    }
  }
  return out;
}

/** Markdown image and link targets, plus inline HTML `src`/`href`. */
const BODY_REFERENCE =
  /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|(?:src|href)\s*=\s*["']([^"']+)["']/g;

/**
 * Every relative path a bundle references, normalised and de-duplicated in
 * the order first seen.
 *
 * Both places named in §4 item 4 are searched: the body (Markdown syntax and
 * surviving inline HTML) and the front matter (`cover` plus any field the
 * theme declared as `image`, `image[]` or `file`).
 */
export function collectAssetPaths(
  markdown: string,
  fields: Readonly<Record<string, ThemeField>> = {},
): string[] {
  const { body, data } = splitFrontmatter(markdown);
  const found: string[] = [];
  const add = (raw: unknown): void => {
    if (typeof raw !== 'string') {
      return;
    }
    const path = normalizeRelativePath(raw);
    if (path !== null && !found.includes(path)) {
      found.push(path);
    }
  };

  for (const match of body.matchAll(BODY_REFERENCE)) {
    add(match[1] ?? match[2]);
  }

  const derived = deriveFrontmatter(data);
  add(derived.cover);
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'image' || field.type === 'file') {
      add(derived[name]);
      continue;
    }
    if (field.type === 'image[]') {
      const value = derived[name];
      if (Array.isArray(value)) {
        for (const entry of value) {
          add(entry);
        }
      }
    }
  }
  return found;
}

/** The status a bundle's front matter asks for (§7.4). */
export type BundleStatus = 'draft' | 'scheduled' | 'published';

/**
 * Resolves the publication status. `draft: true` always wins; otherwise a
 * `date` in the future means scheduled.
 */
export function resolveStatus(
  frontmatter: Readonly<Record<string, unknown>>,
  now: Date,
): BundleStatus {
  if (frontmatter.draft === true) {
    return 'draft';
  }
  const date = frontmatter.date;
  if (typeof date === 'string' || date instanceof Date) {
    const parsed = date instanceof Date ? date : new Date(date);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
      return 'scheduled';
    }
  }
  return 'published';
}

/** Identity file written into every exported bundle (§6). */
export interface BundleIdentity {
  readonly translation_group: string;
  readonly items: Readonly<
    Record<
      string,
      { id: string; created_at: string; path: string; slug?: string }
    >
  >;
}

/** Parses `mallok.json`, returning null for anything unusable. */
export function parseBundleIdentity(text: string): BundleIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.translation_group !== 'string' ||
    record.items === null ||
    typeof record.items !== 'object'
  ) {
    return null;
  }
  const items: Record<
    string,
    { id: string; created_at: string; path: string; slug?: string }
  > = Object.create(null) as Record<
    string,
    { id: string; created_at: string; path: string; slug?: string }
  >;
  for (const [locale, value] of Object.entries(
    record.items as Record<string, unknown>,
  )) {
    if (value === null || typeof value !== 'object') {
      continue;
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.id === 'string' &&
      typeof item.created_at === 'string' &&
      typeof item.path === 'string'
    ) {
      items[locale] = {
        id: item.id,
        created_at: item.created_at,
        path: item.path,
        ...(typeof item.slug === 'string' ? { slug: item.slug } : {}),
      };
    }
  }
  return { translation_group: record.translation_group, items };
}

/** Serialises `mallok.json` with stable key order. */
export function formatBundleIdentity(identity: BundleIdentity): string {
  const locales = Object.keys(identity.items).sort();
  const items = Object.create(null) as Record<string, unknown>;
  for (const locale of locales) {
    const item = identity.items[locale];
    if (item !== undefined) {
      items[locale] = {
        id: item.id,
        created_at: item.created_at,
        path: item.path,
        ...(item.slug === undefined ? {} : { slug: item.slug }),
      };
    }
  }
  return `${JSON.stringify(
    { translation_group: identity.translation_group, items },
    null,
    2,
  )}\n`;
}

/** `index.md` for the default locale, `index.<locale>.md` for the rest. */
export function bundleFileName(locale: string, defaultLocale: string): string {
  return locale === defaultLocale ? 'index.md' : `index.${locale}.md`;
}

/** Reads a locale back out of a bundle file name, or null if it is not one. */
export function localeFromFileName(
  name: string,
  defaultLocale: string,
): string | null {
  if (name === 'index.md') {
    return defaultLocale;
  }
  const match = /^index\.([a-z]{2}(?:-[A-Za-z]{2,4})?)\.md$/.exec(name);
  return match?.[1] ?? null;
}

/** The three input layouts an import accepts (§7.1). */
export type ImportLayout = 'export' | 'bundles' | 'flat';

/**
 * Recognises which layout a set of paths represents.
 *
 * Paths are relative to the root being imported, using forward slashes. The
 * order matters: an export is identified by `site.json` plus `content/`, a
 * bundle set by any `index*.md` inside a subdirectory, and everything else
 * with Markdown at the top level is treated as loose files.
 */
export function detectLayout(paths: readonly string[]): ImportLayout | null {
  const hasSiteJson = paths.includes('site.json');
  const hasContentDir = paths.some((path) => path.startsWith('content/'));
  if (hasSiteJson && hasContentDir) {
    return 'export';
  }
  const hasNestedIndex = paths.some((path) => {
    const parts = path.split('/');
    return parts.length > 1 && /^index(\.[^.]+)?\.md$/.test(parts.at(-1) ?? '');
  });
  if (hasNestedIndex) {
    return 'bundles';
  }
  const hasMarkdown = paths.some((path) => path.endsWith('.md'));
  return hasMarkdown ? 'flat' : null;
}
