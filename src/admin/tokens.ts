/**
 * How the account page presents an API token (docs/ADMIN.md §12).
 *
 * `GET /_mallok/api/tokens` returns revoked tokens too, with `revokedAt` set:
 * a revocation is history worth seeing, so the list keeps it. The page used to
 * ignore the field, which left a revoked token looking active with a live
 * Revoke button — and a second click got a 404 nobody reported, so revoking
 * looked like the button did nothing.
 */

import { ApiError } from './api.js';

/** One row of `GET /_mallok/api/tokens`. Secrets are never included. */
export interface TokenSummary {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

/** What the row shows, and whether it offers Revoke. */
export interface TokenView {
  readonly status: string;
  readonly revocable: boolean;
}

/** Status text for a row; only a token that is still live can be revoked. */
export function describeToken(token: TokenSummary): TokenView {
  const used =
    token.lastUsedAt === null
      ? 'Never used'
      : `Last used ${token.lastUsedAt.slice(0, 10)}`;
  if (token.revokedAt !== null) {
    return {
      status: `Revoked ${token.revokedAt.slice(0, 10)} · ${used.toLowerCase()}`,
      revocable: false,
    };
  }
  return { status: used, revocable: true };
}

/**
 * The notice for a revoke that failed. A 404 means the token is already
 * revoked or gone — in another tab, say — which is the outcome the operator
 * wanted, so it is said as such rather than as an error code.
 */
export function revokeFailureMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    return caught.status === 404
      ? 'That token was already revoked.'
      : caught.message;
  }
  return 'Could not revoke the token.';
}
