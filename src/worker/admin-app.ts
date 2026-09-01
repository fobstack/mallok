/**
 * Serving the admin single-page app from Workers Static Assets.
 *
 * The build output lives under `dist/assets/_mallok/app/`, so the asset
 * server answers `/_mallok/app/` and every hashed file directly — those
 * requests never reach this Worker and are not billed as Worker invocations
 * (docs/TECH_STACK.md §6).
 *
 * What does reach the Worker is a client-side route such as
 * `/_mallok/app/settings/appearance`: no file matches it, and
 * `not_found_handling: "none"` sends it here. The answer is the app shell,
 * which then renders that route in the browser.
 */

import type { Env } from './env.js';
import { problem } from './http.js';

/** Path prefix the admin is served from. */
export const APP_PREFIX = '/_mallok/app';

/** Reports whether `pathname` belongs to the admin app. */
export function isAppPath(pathname: string): boolean {
  return pathname === APP_PREFIX || pathname.startsWith(`${APP_PREFIX}/`);
}

/** Serves the app shell for a client-side route. */
export async function handleApp(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return problem(405, 'Method not allowed.');
  }
  if (env.ASSETS === undefined) {
    return problem(
      503,
      'The admin app is not part of this build. Run `pnpm build` and deploy again.',
    );
  }

  const url = new URL(request.url);
  const shell = await env.ASSETS.fetch(
    new Request(`${url.origin}${APP_PREFIX}/index.html`, {
      method: 'GET',
      headers: request.headers,
    }),
  );
  if (!shell.ok) {
    return problem(
      503,
      'The admin app is not part of this build. Run `pnpm build` and deploy again.',
    );
  }

  const response = new Response(shell.body, shell);
  // The shell is tiny and must never be stale after a deploy; the hashed
  // assets it pulls carry their own immutable caching.
  response.headers.set('cache-control', 'no-cache');
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}
