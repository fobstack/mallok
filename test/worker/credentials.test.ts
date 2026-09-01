import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/core/index.js';
import {
  API_TOKEN_PREFIX,
  constantTimeEquals,
  hashPassword,
  mintApiToken,
  mintCsrfToken,
  mintSessionToken,
  PBKDF2_ITERATIONS,
  parsePasswordParams,
  passwordNeedsUpgrade,
  verifyPassword,
} from '../../src/worker/credentials.js';

const PASSWORD = 'a reasonably long test password';

describe('password hashing', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const derived = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, derived.hash, derived.params)).toBe(
      true,
    );
    expect(
      await verifyPassword('something else', derived.hash, derived.params),
    ).toBe(false);
  });

  it('salts every derivation separately', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);
    expect(first.params.salt).not.toBe(second.params.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('records the current iteration count', async () => {
    const derived = await hashPassword(PASSWORD);
    expect(derived.params.iterations).toBe(PBKDF2_ITERATIONS);
    expect(passwordNeedsUpgrade(derived.params)).toBe(false);
  });

  it('flags a hash derived with a lower cost for upgrade', () => {
    expect(
      passwordNeedsUpgrade({ iterations: 1_000, salt: 'AAAAAAAAAAAAAAAA' }),
    ).toBe(true);
  });

  it('returns false instead of throwing on corrupt parameters', async () => {
    const derived = await hashPassword(PASSWORD);
    expect(
      await verifyPassword(PASSWORD, derived.hash, {
        iterations: 0,
        salt: derived.params.salt,
      }),
    ).toBe(false);
    expect(
      await verifyPassword(PASSWORD, derived.hash, {
        iterations: PBKDF2_ITERATIONS,
        salt: 'not base64 !!!',
      }),
    ).toBe(false);
    expect(
      await verifyPassword(PASSWORD, 'not base64 !!!', derived.params),
    ).toBe(false);
  });

  it('rejects a hash of the wrong length', async () => {
    const derived = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, 'AAAA', derived.params)).toBe(false);
  });
});

describe('password parameter parsing', () => {
  it('round-trips valid parameters', async () => {
    const derived = await hashPassword(PASSWORD);
    expect(parsePasswordParams(JSON.stringify(derived.params))).toEqual(
      derived.params,
    );
  });

  it('returns null for anything malformed', () => {
    expect(parsePasswordParams('not json')).toBeNull();
    expect(parsePasswordParams('null')).toBeNull();
    expect(parsePasswordParams('[]')).toBeNull();
    expect(parsePasswordParams('{"iterations":"many","salt":"AA"}')).toBeNull();
    expect(parsePasswordParams('{"iterations":1}')).toBeNull();
  });
});

describe('token minting', () => {
  it('stores only the hash of an API token', async () => {
    const token = await mintApiToken();
    expect(token.plaintext.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(token.id).toBe(await sha256Hex(token.plaintext));
    expect(token.id).not.toContain(token.plaintext);
  });

  it('stores only the hash of a session token', async () => {
    const token = await mintSessionToken();
    expect(token.id).toBe(await sha256Hex(token.plaintext));
  });

  it('never repeats a token', async () => {
    const minted = await Promise.all(
      Array.from({ length: 20 }, () => mintApiToken()),
    );
    expect(new Set(minted.map((token) => token.plaintext)).size).toBe(20);
    expect(new Set(Array.from({ length: 20 }, mintCsrfToken)).size).toBe(20);
  });
});

describe('constant-time comparison', () => {
  it('compares by value regardless of length', async () => {
    expect(await constantTimeEquals('abc', 'abc')).toBe(true);
    expect(await constantTimeEquals('abc', 'abd')).toBe(false);
    expect(await constantTimeEquals('abc', 'abcdef')).toBe(false);
    expect(await constantTimeEquals('', '')).toBe(true);
  });
});
