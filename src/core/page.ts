/**
 * The view contract between core and themes, and the stage-two entry point.
 *
 * Property names use snake_case because that is the Liquid convention theme
 * authors know from Shopify and Jekyll. Everything a template can see is
 * listed here; there is no way to reach "the whole database".
 */

import type { ImageView } from './assets.js';
import type { HeadingInfo } from './fragment.js';
import type { CompiledTheme, SafeHtml } from './liquid.js';

/** One navigation entry. */
export interface NavItemView {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}

/** Site-wide data. */
export interface SiteView {
  readonly name: string;
  readonly tagline: string;
  /** Locale of the page being rendered. */
  readonly locale: string;
  readonly default_locale: string;
  readonly locales: readonly string[];
  /** Origin without trailing slash, e.g. `https://example.com`. */
  readonly base_url: string;
  /** Home path of the current locale (`/` or `/<locale>/`). */
  readonly home_path: string;
  readonly nav: readonly NavItemView[];
}

/** A link to the same content in another locale. */
export interface AlternateView {
  readonly locale: string;
  readonly href: string;
  /**
   * What this language calls itself — "中文", not "Chinese" and not "zh".
   *
   * A reader looking for their own language scans for its own name; showing
   * it in the language they cannot read defeats the switcher. Themes declare
   * it as `language_name` in their locale pack; without one this falls back
   * to the locale code.
   */
  readonly name: string;
}

/** Summary of a content item, used on lists and the home page. */
export interface ContentSummaryView {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly published_at: string;
  readonly cover: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /**
   * Public URLs of the images this item references, keyed by the relative
   * path that appears in its front matter — so a theme can turn an `image`
   * or `image[]` field into a working `src` without knowing where media
   * lives (docs/THEME_FORMAT.md §7.4).
   */
  readonly images: Readonly<Record<string, ImageView>>;
  /** Public URLs of referenced non-image assets, keyed by relative path. */
  readonly files: Readonly<Record<string, string>>;
}

/**
 * Related content reachable from one item, resolved from the `reference`
 * fields a theme declares (docs/THEME_FORMAT.md §7.5). All three groups are
 * always present, empty when there is nothing to show, so a template never
 * has to guard before iterating.
 */
export interface RelationsView {
  /**
   * The target of each `reference` field, keyed by field name — e.g.
   * `content.refs.category` on a product page. A field pointing at nothing
   * (missing or unpublished) is simply absent.
   */
  readonly refs: Readonly<Record<string, ContentSummaryView>>;
  /**
   * Items that point back at this one, keyed by their kind — e.g.
   * `content.backrefs.product` on a category page.
   */
  readonly backrefs: Readonly<Record<string, readonly ContentSummaryView[]>>;
  /** Recent items of the same kind, this one excluded. */
  readonly siblings: readonly ContentSummaryView[];
}

/** One question and its answer as templates iterate them. */
export interface FaqPairView {
  readonly question: string;
  readonly answer: string;
}

/** The full content item on its own page. */
export interface ContentView extends ContentSummaryView {
  readonly html: SafeHtml;
  readonly excerpt: string;
  readonly reading_time: number;
  readonly headings: readonly HeadingInfo[];
  readonly updated_at: string;
  readonly translations: readonly AlternateView[];
  readonly refs: RelationsView['refs'];
  readonly backrefs: RelationsView['backrefs'];
  readonly siblings: RelationsView['siblings'];
  /**
   * Normalized `faq` front matter. Core owns this because the same pairs
   * feed the FAQPage structured data it emits (docs/SEO_PERFORMANCE.md §5),
   * and a template must not have to re-derive them from two possible shapes.
   * Empty for content that declares none.
   */
  readonly faq: readonly FaqPairView[];
}

/** A paginated list of one kind, or of one tag. */
export interface ListView {
  /** The content kind, or `tag` for a tag archive. */
  readonly kind: string;
  /** The tag being listed; empty for an ordinary kind list. */
  readonly tag: string;
  readonly items: readonly ContentSummaryView[];
  readonly page: number;
  readonly has_next: boolean;
  readonly next_path: string;
  readonly prev_path: string;
}

/** Per-page metadata for `<head>`. */
export interface PageMetaView {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly kind: 'home' | 'content' | 'list';
  readonly locale: string;
  readonly alternates: readonly AlternateView[];
  /** Core-generated tags (JSON-LD, hreflang) the theme must place in head. */
  readonly head: SafeHtml;
}

/** Theme-specific data. */
export interface ThemeView {
  readonly id: string;
  readonly version: string;
  readonly options: Readonly<Record<string, unknown>>;
  /**
   * Base URL of this theme revision's assets in R2, without a trailing
   * slash. It carries the revision, so the files it points at can be cached
   * forever (docs/THEME_FORMAT.md §11).
   */
  readonly asset_base: string;
}

/** Everything a template can access. */
export interface PageView {
  readonly site: SiteView;
  readonly page: PageMetaView;
  readonly theme: ThemeView;
  /** Locale strings from the theme's language files. */
  readonly t: Readonly<Record<string, string>>;
  readonly content?: ContentView;
  readonly list?: ListView;
  /** Recent items per kind for the home page, keyed by kind. */
  readonly recent?: Readonly<Record<string, readonly ContentSummaryView[]>>;
}

/** Renders a full page with the given theme template. */
export function renderPage(
  theme: CompiledTheme,
  layoutPath: string,
  view: PageView,
): Promise<string> {
  return theme.render(layoutPath, view);
}
