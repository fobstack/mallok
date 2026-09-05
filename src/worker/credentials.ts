/**
 * Password hashing and opaque token generation.
 *
 * Everything here uses WebCrypto only: PBKDF2-SHA256 for passwords, because
 * Argon2 and bcrypt exist only as WASM builds that neither fit the script
 * budget nor run inside the Free plan's CPU limit (docs/SECURITY.md §3.1).
 *
 * Tokens are random bytes. Only their SHA-256 is stored, so a database dump
 * does not yield usable credentials.
 */

import { sha256Hex } from '../core/index.js';

/**
 * PBKDF2 iterations for new passwords.
 *
 * Measured for real on workerd (docs/ARCHITECTURE.md §18 item 5,
 * docs/tasks/TASK-01.md §5, 2026-09-03): 50 000 iterations costs ≈ 10 ms of
 * CPU — right at the Free plan's 10 ms budget for a login request, not
 * comfortably under it the way the earlier local Node estimate (7.8 ms)
 * suggested.
 *
 * Raising this constant is safe: {@link passwordNeedsUpgrade} re-derives a
 * stored hash with the current parameters on the next successful login. But
 * there is a hard ceiling to raise it towards, not just a CPU-budget one:
 * see {@link PBKDF2_RECOMMENDED_ITERATIONS}.
 */
export const PBKDF2_ITERATIONS = 50_000;

/**
 * OWASP's 2023 recommendation, for the disclosure the admin UI must show.
 *
 * **This value is unreachable on this runtime.** workerd's WebCrypto
 * implementation rejects any PBKDF2 call above 100 000 iterations outright
 * ("iteration counts above 100000 are not supported") — confirmed against a
 * real account, not a CPU-time question at all (docs/ARCHITECTURE.md §18
 * item 5). The honest ceiling to disclose is 100 000, itself well past the
 * CPU budget above. Kept at OWASP's figure so the disclosure names the
 * target rather than silently substituting a weaker one; whether to change
 * that is a product decision, not an engineering one.
 */
export const PBKDF2_RECOMMENDED_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const DERIVED_BITS = 256;
const TOKEN_BYTES = 32;

/** Parameters stored alongside a password hash (`admin_user.password_params`). */
export interface PasswordParams {
  readonly iterations: number;
  /** Base64 of the per-user salt. */
  readonly salt: string;
}

/** A freshly derived password hash and the parameters that produced it. */
export interface DerivedPassword {
  /** Base64 of the derived bits. */
  readonly hash: string;
  readonly params: PasswordParams;
}

/** Derives a new password hash with the current parameters and a fresh salt. */
export async function hashPassword(password: string): Promise<DerivedPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const params: PasswordParams = {
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
  };
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return { hash: toBase64(hash), params };
}

/**
 * Verifies a password against a stored hash. Returns `false` for malformed
 * parameters rather than throwing, so a corrupt row cannot be probed by
 * watching for a different error.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  params: PasswordParams,
): Promise<boolean> {
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(params.salt);
    expected = fromBase64(storedHash);
  } catch {
    return false;
  }
  if (!Number.isInteger(params.iterations) || params.iterations < 1) {
    return false;
  }
  const actual = await derive(password, salt, params.iterations);
  return timingSafeEqualBytes(actual, expected);
}

/** Reports whether a stored password should be re-derived on next login. */
export function passwordNeedsUpgrade(params: PasswordParams): boolean {
  return params.iterations < PBKDF2_ITERATIONS;
}

/** Parses the `password_params` JSON column, or `null` when malformed. */
export function parsePasswordParams(json: string): PasswordParams | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const { iterations, salt } = parsed as Record<string, unknown>;
    if (typeof iterations !== 'number' || typeof salt !== 'string') {
      return null;
    }
    return { iterations, salt };
  } catch {
    return null;
  }
}

/** Prefix that lets secret scanners recognise a Mallok API token. */
export const API_TOKEN_PREFIX = 'mlk_live_';

/** A newly minted token: the plaintext to show once, and the id to store. */
export interface MintedToken {
  /** Shown to the user exactly once. */
  readonly plaintext: string;
  /** `sha256(plaintext)`, the primary key of the stored row. */
  readonly id: string;
}

/** Mints an opaque API token. */
export async function mintApiToken(): Promise<MintedToken> {
  const plaintext = `${API_TOKEN_PREFIX}${randomBase64Url(TOKEN_BYTES)}`;
  return { plaintext, id: await sha256Hex(plaintext) };
}

/** Mints a session token. The cookie value never reaches the database. */
export async function mintSessionToken(): Promise<MintedToken> {
  const plaintext = randomBase64Url(TOKEN_BYTES);
  return { plaintext, id: await sha256Hex(plaintext) };
}

/** Generates a CSRF token. It is stored in plaintext; it grants nothing. */
export function mintCsrfToken(): string {
  return randomBase64Url(TOKEN_BYTES);
}

/**
 * Constant-time comparison of two strings of unknown length. Both are hashed
 * first so the comparison itself sees fixed-size inputs.
 */
export async function constantTimeEquals(
  a: string,
  b: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    DERIVED_BITS,
  );
  return new Uint8Array(bits);
}

function randomBase64Url(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(buffer)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  // Both operands are fixed-size derived bits, so a direct comparison is safe.
  return crypto.subtle.timingSafeEqual(a, b);
}
