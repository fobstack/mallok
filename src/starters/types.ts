/**
 * What a starter is (docs/ARCHITECTURE.md §11).
 *
 * A starter is not a runtime object: it is the repository you forked, with a
 * theme chosen, plugins listed, and a set of example bundles that the setup
 * wizard imports once. After the import the content is ordinary content —
 * there is no link back to the starter and no way to tell it apart from
 * something typed by hand.
 */

/** One example document a starter ships, with its translations. */
export interface StarterDocument {
  readonly kind: string;
  /** Slug in the site's default locale. */
  readonly slug: string;
  /** Full `index.md` text, stored verbatim like any other content. */
  readonly markdown: string;
  /**
   * Other locales of the same item, keyed by locale.
   *
   * They join the default-locale item's translation group, so the site ships
   * with `hreflang` already correct rather than as an exercise for the owner
   * (docs/ARCHITECTURE.md §9). A starter may translate some pages and not
   * others — that is the normal state of a real site, and the editor's
   * language switcher offers to create what is missing.
   */
  readonly translations?: Readonly<
    Record<string, { readonly slug: string; readonly markdown: string }>
  >;
}

/** Settings a starter proposes for a fresh site. */
export interface StarterSettings {
  /**
   * Languages the starter's content covers. The wizard adds them to whatever
   * the operator chose, so picking a language in step 2 never removes one the
   * starter needs.
   */
  readonly locales?: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  readonly nav: Readonly<
    Record<string, readonly { label: string; href: string }[]>
  >;
  readonly themeOptions: Readonly<Record<string, unknown>>;
  readonly tagline: string;
}

/** A starter, as the wizard consumes it. */
export interface Starter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The theme this starter's content and settings assume. */
  readonly theme: string;
  /** Plugins the wizard switches on. */
  readonly plugins: readonly string[];
  readonly settings: StarterSettings;
  readonly documents: readonly StarterDocument[];
}
