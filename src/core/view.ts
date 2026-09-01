/**
 * Assembling the view a theme renders against.
 *
 * This lives in core, not in the Worker, because the same assembly has to run
 * in three places and produce the same bytes: the Worker on a visitor request,
 * the CLI's `preview`, and the admin's live preview (docs/CLI.md §8,
 * docs/ADMIN.md §6.3). Everything here takes plain data — no database rows,
 * no request objects — so the callers differ only in where they read from.
 */

import type { ImageView } from './assets.js';
import { LOCALE_OPTIONS_KEY } from './constants.js';
import type { FragmentMeta } from './fragment.js';
import { escapeHtml, SafeHtml } from './liquid.js';
import type {
  AlternateView,
  ContentSummaryView,
  ContentView,
  ListView,
  NavItemView,
  PageView,
  RelationsView,
  SiteView,
  ThemeView,
} from './page.js';
import { buildHomePath } from './paths.js';
import type { ThemeManifest } from './theme.js';

/** One navigation entry as configured for a locale. */
export interface NavEntry {
  readonly label: string;
  readonly href: string;
}

/** Site settings as the renderer needs them, free of storage details. */
export interface SiteConfig {
  readonly name: string;
  readonly tagline: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  readonly nav: Readonly<Record<string, readonly NavEntry[]>>;
  readonly themeOptions: Readonly<Record<string, unknown>>;
  readonly mediaBaseUrl: string;
}

/** What every render needs to know about where it is. */
export interface ViewContext {
  readonly settings: SiteConfig;
  readonly manifest: ThemeManifest;
  /** Origin without a trailing slash. */
  readonly origin: string;
  readonly locale: string;
  /** Path of the page being rendered, used to mark the active nav entry. */
  readonly path: string;
  /** Locale strings of the active theme for this locale. */
  readonly strings: Readonly<Record<string, string>>;
  /** What each enabled language calls itself, keyed by locale. */
  readonly languageNames?: Readonly<Record<string, string>>;
}

/** A content item as the view builders take it. */
export interface ContentInput {
  /** Resolved images, keyed by the relative path front matter holds. */
  readonly images?: Readonly<Record<string, ImageView>>;
  /** Resolved non-image assets, keyed by relative path. */
  readonly files?: Readonly<Record<string, string>>;
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
  readonly cover: string;
}

/** A summary as the list and home builders take it. */
export type SummaryInput = Omit<ContentInput, 'updatedAt'>;

/** Base URL of a theme revision's assets, without a trailing slash. */
export function themeAssetBase(themeId: string, version: string): string {
  return `/theme/${themeId}/${version}`;
}

/** Site-wide view data. */
export function buildSiteView(ctx: ViewContext): SiteView {
  const entries = ctx.settings.nav[ctx.locale] ?? [];
  const nav: NavItemView[] = entries.map((entry) => ({
    label: entry.label,
    href: entry.href,
    active: entry.href === ctx.path,
  }));
  return {
    name: ctx.settings.name,
    tagline: ctx.settings.tagline,
    locale: ctx.locale,
    default_locale: ctx.settings.defaultLocale,
    locales: ctx.settings.locales,
    base_url: ctx.origin,
    home_path: buildHomePath(ctx.locale, ctx.settings.defaultLocale),
    nav,
  };
}

/**
 * Theme view data: identity, resolved options and the asset base.
 *
 * An option resolves in three steps: the override for this locale, then the
 * site-wide value, then the manifest default. Without the first step a
 * bilingual site would show one language's marketing copy on both — which is
 * the whole home page, not a detail (docs/THEME_FORMAT.md §6.1).
 */
export function buildThemeView(ctx: ViewContext): ThemeView {
  const overrides = readLocaleOptions(
    ctx.settings.themeOptions[LOCALE_OPTIONS_KEY],
    ctx.locale,
  );
  const options: Record<string, unknown> = {};
  for (const [key, option] of Object.entries(ctx.manifest.options)) {
    options[key] =
      overrides[key] ?? ctx.settings.themeOptions[key] ?? option.default;
  }
  return {
    id: ctx.manifest.id,
    version: ctx.manifest.version,
    options,
    asset_base: themeAssetBase(ctx.manifest.id, ctx.manifest.version),
  };
}

/** Reads the override map for one locale, tolerating a malformed value. */
function readLocaleOptions(
  value: unknown,
  locale: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return {};
  }
  const forLocale = (value as Record<string, unknown>)[locale];
  return forLocale !== null && typeof forLocale === 'object'
    ? (forLocale as Record<string, unknown>)
    : {};
}

/** Turns a summary input into the shape templates iterate over. */
export function buildSummaryView(item: SummaryInput): ContentSummaryView {
  return {
    id: item.id,
    kind: item.kind,
    locale: item.locale,
    slug: item.slug,
    path: item.path,
    title: item.title,
    description: item.description,
    published_at: item.publishedAt,
    cover: item.cover,
    frontmatter: item.frontmatter,
    images: item.images ?? {},
    files: item.files ?? {},
  };
}

/**
 * Core-generated `<head>` markup: `hreflang` for every translation plus
 * `x-default`, and JSON-LD when the page has any.
 *
 * A theme must output this (docs/THEME_FORMAT.md §7.1). It is the one place
 * the product guarantees correct multilingual signals regardless of who wrote
 * the templates.
 */
export function buildHeadTags(
  ctx: ViewContext,
  alternates: readonly AlternateView[],
  jsonLd: Record<string, unknown> | null,
): SafeHtml {
  const parts: string[] = [];
  if (alternates.length > 1) {
    for (const alternate of alternates) {
      parts.push(
        `<link rel="alternate" hreflang="${escapeHtml(alternate.locale)}" href="${escapeHtml(alternate.href)}">`,
      );
    }
    const fallback = alternates.find(
      (alternate) => alternate.locale === ctx.settings.defaultLocale,
    );
    if (fallback !== undefined) {
      parts.push(
        `<link rel="alternate" hreflang="x-default" href="${escapeHtml(fallback.href)}">`,
      );
    }
  }
  if (jsonLd !== null) {
    // `<` is escaped so content can never close the script element early.
    const payload = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
    parts.push(`<script type="application/ld+json">${payload}</script>`);
  }
  return new SafeHtml(parts.join('\n'));
}

/** The rendered fragment a content page needs. */
export interface FragmentInputView {
  readonly html: string;
  readonly meta: FragmentMeta;
}

/**
 * Related content for one page, as plain inputs. Callers resolve these from
 * wherever they read content; the shapes are the same everywhere.
 */
export interface RelationsInput {
  readonly refs?: Readonly<Record<string, SummaryInput>>;
  readonly backrefs?: Readonly<Record<string, readonly SummaryInput[]>>;
  readonly siblings?: readonly SummaryInput[];
}

/** Turns relation inputs into the view groups templates iterate over. */
export function buildRelationsView(
  relations: RelationsInput = {},
): RelationsView {
  const refs: Record<string, ReturnType<typeof buildSummaryView>> = {};
  for (const [field, item] of Object.entries(relations.refs ?? {})) {
    refs[field] = buildSummaryView(item);
  }
  const backrefs: Record<string, ReturnType<typeof buildSummaryView>[]> = {};
  for (const [kind, items] of Object.entries(relations.backrefs ?? {})) {
    backrefs[kind] = items.map(buildSummaryView);
  }
  return {
    refs,
    backrefs,
    siblings: (relations.siblings ?? []).map(buildSummaryView),
  };
}

/** Builds the view for one content item on its own page. */
export function buildContentPageView(
  ctx: ViewContext,
  content: ContentInput,
  fragment: FragmentInputView,
  translations: readonly { locale: string; path: string }[],
  relations: RelationsInput = {},
): PageView {
  const alternates: AlternateView[] = translations.map((item) => ({
    locale: item.locale,
    href: `${ctx.origin}${item.path}`,
    name: ctx.languageNames?.[item.locale] ?? item.locale,
  }));
  const summary = buildSummaryView(content);
  const view: ContentView = {
    ...summary,
    html: new SafeHtml(fragment.html),
    excerpt: fragment.meta.excerpt,
    reading_time: fragment.meta.readingTimeMinutes,
    headings: fragment.meta.headings,
    updated_at: content.updatedAt,
    translations: alternates,
    faq: faqPairs(content.frontmatter.faq),
    ...buildRelationsView(relations),
  };
  const description = content.description || fragment.meta.excerpt;
  const jsonLd = contentJsonLd(ctx, content, description);
  return {
    site: buildSiteView(ctx),
    theme: buildThemeView(ctx),
    t: ctx.strings,
    page: {
      title: content.title,
      description,
      canonical: `${ctx.origin}${content.path}`,
      kind: 'content',
      locale: ctx.locale,
      alternates,
      head: buildHeadTags(ctx, alternates, jsonLd),
    },
    content: view,
  };
}

/** Structured data for one content page (docs/SEO_PERFORMANCE.md §5). */
function contentJsonLd(
  ctx: ViewContext,
  content: ContentInput,
  description: string,
): Record<string, unknown> | null {
  if (content.kind === 'article') {
    return {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: content.title,
      datePublished: content.publishedAt,
      dateModified: content.updatedAt,
      inLanguage: content.locale,
      mainEntityOfPage: `${ctx.origin}${content.path}`,
    };
  }
  if (content.kind === 'product') {
    const sku = content.frontmatter.sku ?? content.frontmatter.grade;
    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: content.title,
      ...(description === '' ? {} : { description }),
      ...(typeof sku === 'string' ? { sku } : {}),
      url: `${ctx.origin}${content.path}`,
    };
  }
  if (content.kind === 'faq') {
    const pairs = faqPairs(content.frontmatter.faq);
    // Structured data may only describe what the page actually shows
    // (docs/SEO_PERFORMANCE.md §5); with no question list there is nothing
    // truthful to emit.
    if (pairs.length === 0) {
      return null;
    }
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: content.locale,
      mainEntity: pairs.map((pair) => ({
        '@type': 'Question',
        name: pair.question,
        acceptedAnswer: { '@type': 'Answer', text: pair.answer },
      })),
    };
  }
  return null;
}

/** One question and its answer, as both the view and JSON-LD need them. */
export interface FaqPair {
  readonly question: string;
  readonly answer: string;
}

/**
 * Reads a `faq` front-matter value into question/answer pairs.
 *
 * Two shapes are accepted because two tools write it: the admin's `keyvalue`
 * control produces a map (`{question: answer}`), while hand-written Markdown
 * usually carries a list of `{question, answer}` objects. Anything that is
 * not a pair of non-empty strings is dropped rather than guessed at.
 */
export function faqPairs(value: unknown): FaqPair[] {
  const pairs: FaqPair[] = [];
  const push = (question: unknown, answer: unknown): void => {
    if (
      typeof question === 'string' &&
      typeof answer === 'string' &&
      question.trim() !== '' &&
      answer.trim() !== ''
    ) {
      pairs.push({ question: question.trim(), answer: answer.trim() });
    }
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      push(record.question ?? record.q, record.answer ?? record.a);
    }
    return pairs;
  }
  if (value !== null && typeof value === 'object') {
    for (const [question, answer] of Object.entries(value)) {
      push(question, answer);
    }
  }
  return pairs;
}

/** Builds the view for the home page of one locale. */
export function buildHomePageView(
  ctx: ViewContext,
  recent: Readonly<Record<string, readonly SummaryInput[]>>,
): PageView {
  const recentViews: Record<string, ContentSummaryView[]> = {};
  for (const [kind, items] of Object.entries(recent)) {
    recentViews[kind] = items.map(buildSummaryView);
  }
  const canonical = `${ctx.origin}${buildHomePath(ctx.locale, ctx.settings.defaultLocale)}`;
  const alternates: AlternateView[] = ctx.settings.locales.map((locale) => ({
    locale,
    href: `${ctx.origin}${buildHomePath(locale, ctx.settings.defaultLocale)}`,
    name: ctx.languageNames?.[locale] ?? locale,
  }));
  return {
    site: buildSiteView(ctx),
    theme: buildThemeView(ctx),
    t: ctx.strings,
    page: {
      title: ctx.settings.name,
      description: ctx.settings.tagline,
      canonical,
      kind: 'home',
      locale: ctx.locale,
      alternates,
      head: buildHeadTags(ctx, alternates, {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: ctx.settings.name,
        url: canonical,
      }),
    },
    recent: recentViews,
  };
}

/** Inputs for one page of a kind's list. */
export interface ListInput {
  readonly kind: string;
  readonly items: readonly SummaryInput[];
  readonly hasNext: boolean;
  readonly page: number;
  /** Locale-prefixed base path of the list, e.g. `/de/news`. */
  readonly basePath: string;
  /** Base segment shared by every locale, e.g. `news`. */
  readonly kindBase: string;
  /** Set on a tag archive; the label the page is listing by. */
  readonly tag?: string;
}

/** Builds the view for one page of a kind's list. */
export function buildListPageView(ctx: ViewContext, list: ListInput): PageView {
  const suffix = list.page > 1 ? `/page/${list.page}` : '';
  const view: ListView = {
    kind: list.kind,
    tag: list.tag ?? '',
    items: list.items.map(buildSummaryView),
    page: list.page,
    has_next: list.hasNext,
    next_path: list.hasNext ? `${list.basePath}/page/${list.page + 1}` : '',
    prev_path:
      list.page > 2
        ? `${list.basePath}/page/${list.page - 1}`
        : list.page === 2
          ? list.basePath
          : '',
  };
  // Every locale shows the same list under its own prefix, so the page has
  // real alternates and must say so (docs/SEO_PERFORMANCE.md §4).
  const alternates: AlternateView[] = ctx.settings.locales.map((locale) => {
    const prefix = locale === ctx.settings.defaultLocale ? '' : `/${locale}`;
    return {
      locale,
      href: `${ctx.origin}${prefix}/${list.kindBase}${suffix}`,
      name: ctx.languageNames?.[locale] ?? locale,
    };
  });
  const title =
    list.tag !== undefined && list.tag !== ''
      ? list.tag
      : (ctx.strings[list.kind] ??
        ctx.manifest.kinds[list.kind]?.label ??
        list.kind);
  return {
    site: buildSiteView(ctx),
    theme: buildThemeView(ctx),
    t: ctx.strings,
    page: {
      title,
      description: '',
      canonical: `${ctx.origin}${list.basePath}${suffix}`,
      kind: 'list',
      locale: ctx.locale,
      alternates,
      head: buildHeadTags(ctx, alternates, null),
    },
    list: view,
  };
}
