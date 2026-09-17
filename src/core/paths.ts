/**
 * Public URL paths. The default locale lives at the root, every other locale
 * is prefixed with `/<locale>`. See docs/ARCHITECTURE.md §9.
 */

/** Locale subset used in URLs and `index.<locale>.md` bundle names. */
export const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;

/** Inputs for {@link buildPublicPath}. */
export interface PublicPathInput {
  readonly kind: string;
  readonly locale: string;
  readonly defaultLocale: string;
  readonly slug: string;
  /** Base segment for the kind (`news`), empty for `page`. */
  readonly base: string;
}

/** Builds the canonical public path of a content item. */
export function buildPublicPath(input: PublicPathInput): string {
  const segments: string[] = [];
  if (input.locale !== input.defaultLocale) {
    segments.push(input.locale);
  }
  if (input.kind !== 'page' && input.base !== '') {
    segments.push(input.base);
  }
  segments.push(input.slug);
  return `/${segments.join('/')}`;
}

/** Builds the home path for a locale. */
export function buildHomePath(locale: string, defaultLocale: string): string {
  return locale === defaultLocale ? '/' : `/${locale}/`;
}

/** A request path split into its locale and the locale-relative remainder. */
export interface ParsedPath {
  readonly locale: string;
  /** Path without the locale prefix, always starting with `/`. */
  readonly rest: string;
}

/**
 * Splits `pathname` into locale and remainder using the enabled locales.
 * Unknown prefixes are treated as part of the path in the default locale.
 */
export function parsePublicPath(
  pathname: string,
  locales: readonly string[],
  defaultLocale: string,
): ParsedPath {
  const match = /^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(\/.*)?$/.exec(pathname);
  if (match !== null) {
    const candidate = match[1] ?? '';
    if (candidate !== defaultLocale && locales.includes(candidate)) {
      return { locale: candidate, rest: match[2] ?? '/' };
    }
  }
  return { locale: defaultLocale, rest: pathname === '' ? '/' : pathname };
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
