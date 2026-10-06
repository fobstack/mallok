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

/**
 * One sample record for a plugin that keeps data of its own — a product's
 * variants, say (docs/PLUGIN_API.md §7.5).
 *
 * The wizard does not write the plugin's tables. It hands `values` to the
 * `save` handler of the plugin's `records` panel, after checking them
 * against the fields the panel declares: exactly what happens when someone
 * fills in that form in the admin.
 */
export interface StarterRecord {
  /** The plugin's id. It must be one of the starter's `plugins`. */
  readonly plugin: string;
  /** The id of one of that plugin's `records` panels. */
  readonly panel: string;
  /** The panel's fields, as its form would submit them. */
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * For a panel attached to content (`attachTo`): the starter document the
   * record belongs to, by its kind and its default-locale slug.
   */
  readonly attachedTo?: { readonly kind: string; readonly slug: string };
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
  /** One tagline, or one per language keyed by locale. */
  readonly tagline: string | Readonly<Record<string, string>>;
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
  /**
   * Sample data for the starter's plugins, imported after the documents and
   * in this order.
   */
  readonly records?: readonly StarterRecord[];
}
