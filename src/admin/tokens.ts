/**
 * How the account page presents an API token (docs/ADMIN.md §12).
 *
 * `GET /_mallok/api/tokens` returns revoked tokens too, with `revokedAt` set:
 * a revocation is history worth seeing, so the list keeps it. The page used to
 * ignore the field, which left a revoked token looking active with a live
 * Revoke button — and a second click got a 404 nobody reported, so revoking
 * looked like the button did nothing.
 */

import { t } from '@lingui/core/macro';
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
  const lastUsed = token.lastUsedAt?.slice(0, 10);
  if (token.revokedAt !== null) {
    const revoked = token.revokedAt.slice(0, 10);
    // Whole sentences, not a status glued to a lower-cased "used" phrase:
    // case and word order are the translation's to decide.
    return {
      status:
        lastUsed === undefined
          ? t`Revoked ${revoked} · never used`
          : t`Revoked ${revoked} · last used ${lastUsed}`,
      revocable: false,
    };
  }
  return {
    status: lastUsed === undefined ? t`Never used` : t`Last used ${lastUsed}`,
    revocable: true,
  };
}

/**
 * The notice for a revoke that failed. A 404 means the token is already
 * revoked or gone — in another tab, say — which is the outcome the operator
 * wanted, so it is said as such rather than as an error code.
 */
export function revokeFailureMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    return caught.status === 404
      ? t`That token was already revoked.`
      : caught.message;
  }
  return t`Could not revoke the token.`;
}
