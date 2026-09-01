/**
 * Router for `/_mallok/api/*`.
 *
 * Two routes are reachable without a credential — bootstrapping the first
 * administrator and logging in — and every other route requires one. Writes
 * additionally need a scope and, for cookie-authenticated callers, a CSRF
 * token. See docs/SECURITY.md §3.
 */

import {
  bootstrapAdmin,
  changePassword,
  getTokens,
  login,
  logout,
  postToken,
  revokeToken,
  whoami,
} from './admin-auth.js';
import { postClearFragments, postPurgeAll } from './admin-cache.js';
import {
  getContentItem,
  getContentList,
  removeContent,
  saveContent,
} from './admin-content.js';
import { getExport } from './admin-export.js';
import {
  checkMedia,
  getMediaItem,
  getMediaList,
  patchMedia,
  putMedia,
  putVariant,
  removeMedia,
} from './admin-media.js';
import { routePlugins } from './admin-plugins.js';
import {
  getDiagnostics,
  getHealth,
  getSettings,
  getTheme,
  patchSettings,
  postDefaultLocale,
} from './admin-settings.js';
import {
  authenticate,
  csrfOk,
  hasScope,
  type Principal,
  type Scope,
} from './auth.js';
import type { Env } from './env.js';
import { problem } from './http.js';

const PREFIX = '/_mallok/api/';

/** Routes `/_mallok/api/*`. */
export async function handleAdmin(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response> {
  const route = pathname.slice(PREFIX.length);
  const method = request.method.toUpperCase();
  const now = new Date();

  // Unauthenticated entry points.
  if (route === 'auth/bootstrap' && method === 'POST') {
    return bootstrapAdmin(request, env, now);
  }
  if (route === 'auth/login' && method === 'POST') {
    return login(request, env, now);
  }

  const principal = await authenticate(request, env, now);
  if (principal === null) {
    return problem(401, 'Unauthorized.');
  }

  // Every state-changing request from a browser session must carry the CSRF
  // token; bearer tokens are exempt because the browser never sends them.
  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    !(await csrfOk(request, principal))
  ) {
    return problem(403, 'Missing or invalid CSRF token.');
  }

  const url = new URL(request.url);

  switch (`${method} ${route}`) {
    case 'GET health':
      return getHealth(env);
    case 'GET diagnostics':
      return getDiagnostics(env);

    case 'POST auth/logout':
      return logout(env, principal);
    case 'GET auth/me':
      return whoami(env, principal);
    case 'POST auth/password':
      return changePassword(request, env, principal);

    case 'GET tokens':
      return getTokens(env);
    case 'POST tokens':
      return withScope(principal, 'settings:write', () =>
        postToken(request, env, now),
      );

    case 'GET content':
      return getContentList(env, url);
    case 'POST content':
      return withScope(principal, 'content:write', () =>
        saveContent(request, env, ctx),
      );

    case 'GET theme':
      return getTheme();

    case 'POST cache/purge':
      return withScope(principal, 'settings:write', () => postPurgeAll(env));
    case 'POST cache/fragments':
      return withScope(principal, 'settings:write', () =>
        postClearFragments(env, ctx),
      );

    case 'GET export':
      return withScope(principal, 'export', () => getExport(env, ctx));

    case 'GET media':
      return getMediaList(env, url);
    case 'POST media/check':
      return checkMedia(request, env);

    case 'GET settings':
      return getSettings(env);
    case 'PATCH settings':
      return withScope(principal, 'settings:write', () =>
        patchSettings(request, env, ctx),
      );
    case 'POST settings/default-locale':
      return withScope(principal, 'settings:write', () =>
        postDefaultLocale(request, env, ctx),
      );

    default:
      break;
  }

  const contentId = matchPath(route, 'content/');
  if (contentId !== null) {
    if (method === 'GET') {
      return getContentItem(env, contentId);
    }
    if (method === 'DELETE') {
      return withScope(principal, 'content:write', () =>
        removeContent(env, ctx, contentId),
      );
    }
  }

  const tokenId = matchPath(route, 'tokens/');
  if (tokenId !== null && method === 'DELETE') {
    return withScope(principal, 'settings:write', () =>
      revokeToken(env, tokenId, now),
    );
  }

  if (route === 'plugins' || route.startsWith('plugins/')) {
    const response = await routePlugins(
      request,
      env,
      ctx,
      principal,
      route,
      method,
    );
    if (response !== null) {
      return response;
    }
  }

  const media = matchMedia(route);
  if (media !== null) {
    if (media.width !== null) {
      if (method === 'PUT') {
        const { sha, width } = media;
        return withScope(principal, 'media:write', () =>
          putVariant(request, env, sha, width),
        );
      }
      return problem(404, 'Not found.');
    }
    if (method === 'GET') {
      return getMediaItem(env, media.sha);
    }
    if (method === 'PUT') {
      return withScope(principal, 'media:write', () =>
        putMedia(request, env, media.sha, now),
      );
    }
    if (method === 'PATCH') {
      return withScope(principal, 'media:write', () =>
        patchMedia(request, env, media.sha),
      );
    }
    if (method === 'DELETE') {
      return withScope(principal, 'media:write', () =>
        removeMedia(env, media.sha),
      );
    }
  }

  return problem(404, 'Not found.');
}

/** Runs `handler` only when the principal carries `scope`. */
function withScope(
  principal: Principal,
  scope: Scope,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (!hasScope(principal, scope)) {
    return Promise.resolve(
      problem(403, `This token lacks the "${scope}" scope.`),
    );
  }
  return handler();
}

/** A media route: one object, optionally one of its variant widths. */
interface MediaRoute {
  readonly sha: string;
  readonly width: number | null;
}

/** Matches `media/<sha256>` and `media/<sha256>/variants/<width>`. */
function matchMedia(route: string): MediaRoute | null {
  const single = /^media\/([a-f0-9]{64})$/.exec(route);
  if (single !== null) {
    return { sha: single[1] ?? '', width: null };
  }
  const variant = /^media\/([a-f0-9]{64})\/variants\/(\d{1,5})$/.exec(route);
  if (variant !== null) {
    return { sha: variant[1] ?? '', width: Number(variant[2]) };
  }
  return null;
}

/** Extracts a single path segment after `prefix`, or `null`. */
function matchPath(route: string, prefix: string): string | null {
  if (!route.startsWith(prefix)) {
    return null;
  }
  const rest = route.slice(prefix.length);
  if (rest === '' || rest.includes('/')) {
    return null;
  }
  return decodeURIComponent(rest);
}
