/**
 * Pure path helpers.
 *
 * Kept apart from `router.ts` because that module touches `window` at import
 * time; these functions are the part worth testing.
 */

/** Path prefix Static Assets serves the app from. */
export const APP_BASE = '/_mallok/app';

/** The first-run wizard's own URL (docs/ADMIN.md §5). */
export const SETUP_PATH = '/_mallok/setup';

/** Turns a browser pathname into an in-app route. */
export function toRoute(pathname: string): string {
  if (pathname === SETUP_PATH || pathname.startsWith(`${SETUP_PATH}/`)) {
    return '/setup';
  }
  const rest = pathname.startsWith(APP_BASE)
    ? pathname.slice(APP_BASE.length)
    : pathname;
  if (rest === '' || rest === '/') {
    return '/';
  }
  return rest.replace(/\/+$/, '');
}

/** Turns an in-app route into a browser URL. */
export function toHref(path: string): string {
  return `${APP_BASE}${path === '/' ? '/' : path}`;
}

/**
 * Matches `pattern` (e.g. `/content/:id`) against `path` and returns the
 * captured segments, or `null` when it does not match.
 */
export function match(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter((part) => part !== '');
  const pathParts = path.split('/').filter((part) => part !== '');
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index] ?? '';
    if (part.startsWith(':')) {
      if (actual === '') {
        return null;
      }
      params[part.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (part !== actual) {
      return null;
    }
  }
  return params;
}
