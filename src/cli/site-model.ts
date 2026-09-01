/**
 * The site model a static build works from.
 *
 * This is the file-based equivalent of the Worker's D1 queries: given every
 * document read off disk, it resolves what the Worker resolves with SQL —
 * publication status, public paths, translation groups, `reference`
 * relations, tags and list pagination.
 *
 * It is pure and holds everything in memory. That is the honest trade of a
 * build: no database, and a limit set by how much content fits in RAM.
 */

import {
  buildPublicPath,
  deriveFrontmatter,
  resolveStatus,
  splitFrontmatter,
  type ThemeManifest,
} from '../core/index.js';
import type { Bundle } from './scan.js';

/** One document in the model. */
export interface SiteItem {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly markdown: string;
  readonly body: string;
  readonly tags: readonly string[];
  /** Bundle members share this, which is what makes them translations. */
  readonly translationGroup: string;
  /** Relative path → absolute path on disk. */
  readonly assets: ReadonlyMap<string, string>;
  readonly missing: readonly string[];
  readonly status: 'draft' | 'scheduled' | 'published';
}

/** The whole site, ready to render. */
export interface SiteModel {
  readonly items: readonly SiteItem[];
  readonly published: readonly SiteItem[];
  readonly locales: readonly string[];
  readonly defaultLocale: string;
}

/** Site configuration, in the shape an export's `site.json` uses. */
export interface SiteConfigFile {
  readonly name: string;
  readonly tagline?: string | null;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  readonly nav?: Readonly<
    Record<string, readonly { label: string; href: string }[]>
  >;
  readonly seo?: Readonly<Record<string, unknown>>;
  readonly themeOptions?: Readonly<Record<string, unknown>>;
}

function readTags(frontmatter: Readonly<Record<string, unknown>>): string[] {
  const value = frontmatter.tags;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Turns scanned bundles into the model.
 *
 * `now` decides what counts as published, exactly as the Worker's
 * `published_at <= ?` does, so a scheduled post stays out of a build made
 * before its date.
 */
export function buildSiteModel(
  bundles: readonly Bundle[],
  config: SiteConfigFile,
  now: Date,
): SiteModel {
  const items: SiteItem[] = [];

  for (const bundle of bundles) {
    // Every locale of a bundle shares one group, which is what makes the
    // language switcher and `hreflang` work (docs/ARCHITECTURE.md §9).
    const group = `${bundle.kind}:${bundle.name}`;
    for (const document of bundle.documents) {
      const { data, body } = splitFrontmatter(document.markdown);
      const frontmatter = deriveFrontmatter(data);
      const title =
        typeof frontmatter.title === 'string' ? frontmatter.title.trim() : '';
      if (title === '') {
        continue;
      }
      // A translation's slug is not in its own front matter — an export
      // never rewrites source text, so it records the identity in
      // `mallok.json` instead (docs/CONTENT_FORMAT.md §6). Without reading
      // it back, every language would land on the default locale's slug.
      const recorded = bundle.identity?.items[document.locale]?.path;
      const fromIdentity =
        recorded === undefined
          ? undefined
          : (recorded
              .split('/')
              .filter((part) => part !== '')
              .at(-1) ?? undefined);
      const slug =
        typeof frontmatter.slug === 'string' && frontmatter.slug !== ''
          ? frontmatter.slug
          : (fromIdentity ?? bundle.name);
      const status = resolveStatus(frontmatter, now);
      const published =
        typeof frontmatter.date === 'string'
          ? frontmatter.date
          : now.toISOString();
      items.push({
        id: `${bundle.kind}:${document.locale}:${slug}`,
        kind: bundle.kind,
        locale: document.locale,
        slug,
        path: buildPublicPath({
          kind: bundle.kind,
          locale: document.locale,
          defaultLocale: config.defaultLocale,
          slug,
          base: config.kinds[bundle.kind]?.base ?? bundle.kind,
        }),
        title,
        description:
          typeof frontmatter.description === 'string'
            ? frontmatter.description
            : '',
        publishedAt: published,
        updatedAt:
          typeof frontmatter.updated === 'string'
            ? frontmatter.updated
            : published,
        frontmatter,
        markdown: document.markdown,
        body,
        tags: readTags(frontmatter),
        translationGroup: group,
        assets: document.assets,
        missing: document.missing,
        status,
      });
    }
  }

  const published = items.filter((item) => item.status === 'published');
  return {
    items,
    published,
    locales: config.locales,
    defaultLocale: config.defaultLocale,
  };
}

/** Translations of one item, itself included, ordered by locale. */
export function translationsOf(model: SiteModel, item: SiteItem): SiteItem[] {
  return model.published
    .filter((entry) => entry.translationGroup === item.translationGroup)
    .sort((a, b) => a.locale.localeCompare(b.locale));
}

/** What a `reference` field points at, and what points back (§7.5). */
export interface Relations {
  readonly refs: Record<string, SiteItem>;
  readonly backrefs: Record<string, SiteItem[]>;
  readonly siblings: SiteItem[];
  /**
   * Fields whose value names nothing that exists.
   *
   * A served site can leave these to the editor's content picker; a build
   * has no such safety net, so it reports them rather than quietly dropping
   * the link.
   */
  readonly dangling: readonly { field: string; value: string }[];
}

const BACKREF_LIMIT = 24;
const SIBLING_LIMIT = 6;

/**
 * Resolves relations the same way the Worker does — off the manifest, not
 * off hardcoded kind names — so a static build and a served site show the
 * same links.
 */
export function relationsFor(
  model: SiteModel,
  item: SiteItem,
  manifest: ThemeManifest,
): Relations {
  const kind = manifest.kinds[item.kind];
  const refs: Record<string, SiteItem> = {};
  const backrefs: Record<string, SiteItem[]> = {};
  const dangling: { field: string; value: string }[] = [];

  for (const [field, decl] of Object.entries(kind?.fields ?? {})) {
    if (decl.type !== 'reference' || decl.kind === undefined) {
      continue;
    }
    const slug = item.frontmatter[field];
    if (typeof slug !== 'string' || slug === '') {
      continue;
    }
    const target = model.published.find(
      (entry) =>
        entry.kind === decl.kind &&
        entry.locale === item.locale &&
        entry.slug === slug,
    );
    if (target === undefined) {
      dangling.push({ field, value: slug });
      continue;
    }
    refs[field] = target;
  }

  for (const [otherKind, decl] of Object.entries(manifest.kinds)) {
    if (otherKind === item.kind) {
      continue;
    }
    for (const [field, fieldDecl] of Object.entries(decl.fields ?? {})) {
      if (fieldDecl.type !== 'reference' || fieldDecl.kind !== item.kind) {
        continue;
      }
      backrefs[otherKind] = model.published
        .filter(
          (entry) =>
            entry.kind === otherKind &&
            entry.locale === item.locale &&
            entry.frontmatter[field] === item.slug,
        )
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, BACKREF_LIMIT);
    }
  }

  const siblings =
    kind?.listLayout === undefined
      ? []
      : model.published
          .filter(
            (entry) =>
              entry.kind === item.kind &&
              entry.locale === item.locale &&
              entry.id !== item.id,
          )
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, SIBLING_LIMIT);

  return { refs, backrefs, siblings, dangling };
}

/** Published items of one kind and locale, newest first. */
export function listOf(
  model: SiteModel,
  kind: string,
  locale: string,
): SiteItem[] {
  return model.published
    .filter((entry) => entry.kind === kind && entry.locale === locale)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** Every tag in use in one locale, with the items carrying it. */
export function tagsOf(
  model: SiteModel,
  locale: string,
): Map<string, SiteItem[]> {
  const tags = new Map<string, SiteItem[]>();
  for (const item of model.published) {
    if (item.locale !== locale) {
      continue;
    }
    for (const tag of item.tags) {
      const list = tags.get(tag) ?? [];
      list.push(item);
      tags.set(tag, list);
    }
  }
  for (const list of tags.values()) {
    list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  return tags;
}
