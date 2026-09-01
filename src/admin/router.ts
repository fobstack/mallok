/**
 * A ~30-line history router.
 *
 * A routing library would be more than this app needs: a dozen routes, no
 * nesting, no data loaders. The path helpers live in `routes.ts`.
 */

import { signal } from '@preact/signals';
import { APP_BASE, toHref, toRoute } from './routes.js';

export { APP_BASE, match, toHref } from './routes.js';

/** The current in-app path, always starting with `/`. */
export const route = signal(toRoute(window.location.pathname));

window.addEventListener('popstate', () => {
  route.value = toRoute(window.location.pathname);
});

/** Navigates without a reload. */
export function navigate(path: string, replace = false): void {
  const url = toHref(path);
  if (replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }
  route.value = path;
  window.scrollTo(0, 0);
}

/** True when `pathname` is inside the admin app. */
export function isAppPath(pathname: string): boolean {
  return pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`);
}
