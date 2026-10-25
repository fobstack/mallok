/**
 * Public URL paths. By default the default locale lives at the root and every
 * other locale is prefixed with `/<locale>`; a site that sets
 * `prefixDefaultLocale` prefixes the default locale too, and its root only
 * redirects (docs/ARCHITECTURE.md §9). Every function here takes the setting,
 * so that no caller decides on its own whether a locale carries a prefix.
 */

/** Locale subset used in URLs and `index.<locale>.md` bundle names. */
export const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;

/** How a site writes locales into its URLs. */
export interface LocaleUrls {
  readonly defaultLocale: string;
  /** True when the default locale is prefixed as well (`/en/…`). */
  readonly prefixDefaultLocale?: boolean;
}

/**
 * The URL prefix of `locale` on a site: `''` for the default locale when it
 * lives at the root, `/<locale>` otherwise.
 */
export function localePrefix(locale: string, site: LocaleUrls): string {
  return locale === site.defaultLocale && site.prefixDefaultLocale !== true
    ? ''
    : `/${locale}`;
}

/** Inputs for {@link buildPublicPath}. */
export interface PublicPathInput {
  readonly kind: string;
  readonly locale: string;
  readonly defaultLocale: string;
  /** True when the default locale is prefixed as well. */
  readonly prefixDefaultLocale?: boolean;
  readonly slug: string;
  /** Base segment for the kind (`news`), empty for `page`. */
  readonly base: string;
}

/** Builds the canonical public path of a content item. */
export function buildPublicPath(input: PublicPathInput): string {
  const segments: string[] = [];
  const prefix = localePrefix(input.locale, input);
  if (prefix !== '') {
    segments.push(input.locale);
  }
  if (input.kind !== 'page' && input.base !== '') {
    segments.push(input.base);
  }
  segments.push(input.slug);
  return `/${segments.join('/')}`;
}

/**
 * Builds the home path for a locale.
 *
 * With the default locale at the root, the root is its home and another
 * locale's home keeps the trailing slash it has always had (`/de/`). With
 * every locale prefixed, a home is the bare prefix (`/en`), the address the
 * root redirects to; that mode is new, so it has no older form to keep.
 */
export function buildHomePath(
  locale: string,
  defaultLocale: string,
  prefixDefaultLocale = false,
): string {
  if (prefixDefaultLocale) {
    return `/${locale}`;
  }
  return locale === defaultLocale ? '/' : `/${locale}/`;
}

/** A request path split into its locale and the locale-relative remainder. */
export interface ParsedPath {
  readonly locale: string;
  /** Path without the locale prefix, always starting with `/`. */
  readonly rest: string;
  /**
   * False when the default locale must be prefixed and this path is not:
   * nothing is served at such a path except a redirect to where it moved.
   */
  readonly prefixed: boolean;
}

/**
 * Splits `pathname` into locale and remainder using the enabled locales.
 * Unknown prefixes are treated as part of the path in the default locale.
 */
export function parsePublicPath(
  pathname: string,
  locales: readonly string[],
  defaultLocale: string,
  prefixDefaultLocale = false,
): ParsedPath {
  const match = /^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(\/.*)?$/.exec(pathname);
  if (match !== null) {
    const candidate = match[1] ?? '';
    // The default locale's code is a prefix only when the site prefixes it;
    // otherwise `/en/x` is an ordinary path, as it always was.
    const isPrefix =
      locales.includes(candidate) &&
      (candidate !== defaultLocale || prefixDefaultLocale);
    if (isPrefix) {
      return { locale: candidate, rest: match[2] ?? '/', prefixed: true };
    }
  }
  return {
    locale: defaultLocale,
    rest: pathname === '' ? '/' : pathname,
    prefixed: !prefixDefaultLocale,
  };
}

/** Normalizes a slug: lowercase, ASCII letters, digits and single dashes. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
