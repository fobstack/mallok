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

/** Most segments a slug may have (`crypto/crypto-quote` has two). */
export const MAX_SLUG_SEGMENTS = 4;

/** Longest slug, separators included. */
export const MAX_SLUG_LENGTH = 200;

/**
 * Path segments the Worker answers before the public site, or that a page's
 * router claims, so a slug of a kind with no base may not start with them
 * (`src/worker/index.ts`, `src/worker/pages/runtime.ts`).
 */
const RESERVED_FIRST_SEGMENTS = new Set(['tags', 'media', 'theme']);

/** Why a slug cannot be used, and the value that could, if there is one. */
export interface SlugProblem {
  readonly message: string;
  /** A value that would be accepted, when one follows from the input. */
  readonly suggestion?: string;
}

/**
 * Normalizes a slug of one to four segments: each segment as
 * {@link slugify} makes it, empty segments dropped.
 */
export function canonicalSlug(slug: string): string {
  return slug
    .split('/')
    .map(slugify)
    .filter((segment) => segment !== '')
    .slice(0, MAX_SLUG_SEGMENTS)
    .join('/');
}

/**
 * Checks a slug on its own: one to four segments of lowercase Latin letters,
 * digits and single dashes, joined by `/` (docs/CONTENT_FORMAT.md §3.1).
 *
 * A slug becomes a URL and, flattened, a folder name in an export, which is
 * why each segment must be exactly what `slugify` makes of it. A slug that
 * starts with `page/<number>` is refused because `/<base>/page/<n>` is a
 * list's page. Returns null when the slug is usable.
 */
export function slugProblem(slug: string): SlugProblem | null {
  const segments = slug.split('/');
  const suggestion = canonicalSlug(slug);
  const withSuggestion = (message: string): SlugProblem =>
    suggestion !== '' && suggestion !== slug
      ? { message: `${message} Use "${suggestion}".`, suggestion }
      : { message };
  if (slug.length > MAX_SLUG_LENGTH) {
    return {
      message: `The slug is longer than ${MAX_SLUG_LENGTH} characters.`,
    };
  }
  if (segments.length > MAX_SLUG_SEGMENTS) {
    return withSuggestion(
      `The slug has ${segments.length} segments; at most ${MAX_SLUG_SEGMENTS} are allowed.`,
    );
  }
  const empty = segments.indexOf('');
  if (empty !== -1) {
    return withSuggestion(
      slug === ''
        ? 'The slug is empty.'
        : 'The slug has an empty segment: it starts or ends with "/", or has "//".',
    );
  }
  for (const [index, segment] of segments.entries()) {
    const canonical = slugify(segment);
    if (canonical === segment) {
      continue;
    }
    if (segments.length === 1) {
      // The words a one-segment slug has always been refused with.
      return canonical === ''
        ? {
            message: `The slug "${slug}" has no Latin letters or digits to build a folder name from. Provide one written in Latin characters.`,
          }
        : {
            message: `The slug must use lowercase Latin letters, digits and single dashes. Use "${canonical}".`,
            suggestion: canonical,
          };
    }
    const which = `Segment ${index + 1} ("${segment}")`;
    if (canonical === '') {
      return withSuggestion(
        `${which} has no Latin letters or digits to build a folder name from. Write it in Latin characters.`,
      );
    }
    return withSuggestion(
      `${which} must use lowercase Latin letters, digits and single dashes.`,
    );
  }
  if (
    segments.length > 1 &&
    segments[0] === 'page' &&
    /^\d+$/.test(segments[1] ?? '')
  ) {
    return {
      message: `A slug cannot start with "page/${segments[1]}": that is the address of a list's page ${segments[1]}.`,
    };
  }
  return null;
}

/**
 * Checks a slug against the site it is saved on. A slug of several segments
 * in a kind with no base sits at the root of its locale, so its first segment
 * must not be an address the site already answers: `tags`, `media`, `theme`,
 * another kind's base, or an enabled locale. A one-segment slug is not held
 * to this, so that nothing a site could save before is refused now.
 */
export function slugPlacementProblem(
  slug: string,
  base: string,
  site: {
    readonly locales: readonly string[];
    readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  },
): SlugProblem | null {
  const segments = slug.split('/');
  const first = segments[0] ?? '';
  if (base !== '' || segments.length < 2) {
    return null;
  }
  if (RESERVED_FIRST_SEGMENTS.has(first)) {
    return {
      message: `A slug with several segments cannot start with "${first}/": the site answers that address itself.`,
    };
  }
  const kind = Object.entries(site.kinds).find(
    ([, config]) => config.base !== '' && config.base === first,
  );
  if (kind !== undefined) {
    return {
      message: `A slug with several segments cannot start with "${first}/": that is the address of the kind "${kind[0]}".`,
    };
  }
  if (site.locales.includes(first)) {
    return {
      message: `A slug with several segments cannot start with "${first}/": that is the prefix of the language "${first}".`,
    };
  }
  return null;
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
