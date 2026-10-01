import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/admin/api.js';
import {
  describeToken,
  revokeFailureMessage,
  type TokenSummary,
} from '../../src/admin/tokens.js';

/**
 * The token list keeps revoked tokens as history. It used to ignore
 * `revokedAt`, so a revoked token looked active and offered Revoke again, and
 * the second click's 404 was swallowed — revoking looked like a dead button.
 */
const live: TokenSummary = {
  id: 'tok_1',
  name: 'ci',
  scopes: ['content:write'],
  createdAt: '2026-10-01T16:47:03.742Z',
  lastUsedAt: null,
  revokedAt: null,
};

describe('describeToken', () => {
  it('offers Revoke for a live token that was never used', () => {
    expect(describeToken(live)).toEqual({
      status: 'Never used',
      revocable: true,
    });
  });

  it('shows the last use of a live token', () => {
    expect(
      describeToken({ ...live, lastUsedAt: '2026-10-01T16:47:52.339Z' }),
    ).toEqual({ status: 'Last used 2026-10-01', revocable: true });
  });

  it('shows a revoked token as revoked, with no Revoke', () => {
    expect(
      describeToken({
        ...live,
        lastUsedAt: '2026-10-01T16:47:52.339Z',
        revokedAt: '2026-10-01T17:07:03.201Z',
      }),
    ).toEqual({
      status: 'Revoked 2026-10-01 · last used 2026-10-01',
      revocable: false,
    });
  });

  it('shows a revoked token that was never used', () => {
    expect(
      describeToken({ ...live, revokedAt: '2026-10-02T00:00:00.000Z' }),
    ).toEqual({ status: 'Revoked 2026-10-02 · never used', revocable: false });
  });
});

describe('revokeFailureMessage', () => {
  it('says a 404 means the token was already revoked', () => {
    expect(revokeFailureMessage(new ApiError(404, 'Not found.'))).toBe(
      'That token was already revoked.',
    );
  });

  it("passes on the server's message for any other refusal", () => {
    expect(
      revokeFailureMessage(
        new ApiError(403, 'This operation needs the "settings:write" scope.'),
      ),
    ).toBe('This operation needs the "settings:write" scope.');
  });

  it('falls back to a plain message for a network failure', () => {
    expect(revokeFailureMessage(new TypeError('Failed to fetch'))).toBe(
      'Could not revoke the token.',
    );
  });
});
