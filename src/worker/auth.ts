/**
 * Authentication and authorization for the management API.
 *
 * Two credentials reach this module: a session cookie issued to a browser,
 * and a bearer token used by the CLI. They authorize the same operations —
 * "the CLI cannot have abilities the admin lacks" (docs/TECH_STACK.md §8) —
 * but only the cookie is subject to CSRF, because only the cookie is sent by
 * the browser automatically. See docs/SECURITY.md §3.
 */

import { sha256Hex } from '../core/index.js';
import {
  type ApiTokenRow,
  findLiveApiToken,
  findLiveSession,
  touchApiToken,
} from '../db/auth.js';
import { constantTimeEquals } from './credentials.js';
import type { Env } from './env.js';

/** Operations a credential may be allowed to perform. */
export const SCOPES = [
  'content:write',
  'media:write',
  'export',
  'settings:write',
] as const;

/** One authorization scope. */
export type Scope = (typeof SCOPES)[number];

/** Reports whether an arbitrary string is a known scope. */
export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** A browser session belonging to an administrator. */
export interface SessionPrincipal {
  readonly kind: 'session';
  readonly userId: string;
  readonly sessionId: string;
  /** Expected value of the CSRF header on writes. */
  readonly csrf: string;
}

/** A bearer token used by the CLI or CI. */
export interface TokenPrincipal {
  readonly kind: 'token';
  readonly tokenId: string;
  readonly name: string;
  readonly scopes: readonly Scope[];
}

/** Whoever is making the request. */
export type Principal = SessionPrincipal | TokenPrincipal;

/** Name of the session cookie. */
export const SESSION_COOKIE = 'mallok_session';

/** Header carrying the CSRF token on session-authenticated writes. */
export const CSRF_HEADER = 'x-mallok-csrf';

/** How long a new session stays valid. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Identifies the caller, or returns `null` when no valid credential is
 * present. A bearer token wins over a cookie so that an authenticated browser
 * can still exercise token paths.
 */
export async function authenticate(
  request: Request,
  env: Env,
  now: Date,
): Promise<Principal | null> {
  const bearer = readBearer(request);
  if (bearer !== null) {
    return authenticateToken(env, bearer, now);
  }
  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie !== null) {
    return authenticateSession(env, cookie, now);
  }
  return null;
}

/**
 * Reports whether `principal` may perform `scope`. A session belongs to the
 * single administrator and therefore carries every scope; tokens carry only
 * what was granted when they were created.
 */
export function hasScope(principal: Principal, scope: Scope): boolean {
  if (principal.kind === 'session') {
    return true;
  }
  return principal.scopes.includes(scope);
}

/**
 * Verifies the CSRF token of a state-changing request. Bearer tokens are
 * exempt: they are not sent by the browser on its own, so there is nothing to
 * forge (docs/SECURITY.md §3.3).
 */
export async function csrfOk(
  request: Request,
  principal: Principal,
): Promise<boolean> {
  if (principal.kind === 'token') {
    return true;
  }
  const presented = request.headers.get(CSRF_HEADER);
  if (presented === null || presented === '') {
    return false;
  }
  return constantTimeEquals(presented, principal.csrf);
}

/** Builds the `Set-Cookie` value that establishes a session. */
export function sessionCookie(token: string, expiresAt: Date): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/_mallok',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  return attributes.join('; ');
}

/** Builds the `Set-Cookie` value that clears a session. */
export function clearedSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/_mallok',
    'Max-Age=0',
  ].join('; ');
}

/** Reads one cookie from a request, or `null` when absent. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (header === null) {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

function readBearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match === null ? null : (match[1]?.trim() ?? null);
}

async function authenticateToken(
  env: Env,
  plaintext: string,
  now: Date,
): Promise<TokenPrincipal | null> {
  const id = await sha256Hex(plaintext);
  const row = await findLiveApiToken(env.DB, id);
  if (row === null) {
    return null;
  }
  // Best effort: a failed touch must not deny an otherwise valid request.
  await touchApiToken(env.DB, id, now.toISOString()).catch(() => undefined);
  return {
    kind: 'token',
    tokenId: row.id,
    name: row.name,
    scopes: parseScopes(row),
  };
}

async function authenticateSession(
  env: Env,
  token: string,
  now: Date,
): Promise<SessionPrincipal | null> {
  const id = await sha256Hex(token);
  const row = await findLiveSession(env.DB, id, now.toISOString());
  if (row === null) {
    return null;
  }
  return {
    kind: 'session',
    userId: row.user_id,
    sessionId: row.id,
    csrf: row.csrf,
  };
}

function parseScopes(row: ApiTokenRow): Scope[] {
  try {
    const parsed: unknown = JSON.parse(row.scopes);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is Scope => typeof value === 'string' && isScope(value),
    );
  } catch {
    return [];
  }
}
