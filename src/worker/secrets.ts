/**
 * Encryption for third-party secrets stored in D1 (docs/SECURITY.md §2.2).
 *
 * Each (plugin, secret name) pair derives its own key from `MALLOK_SECRET`
 * via HKDF, so one leaked key never opens another secret. The stored form is
 * `base64(iv || ciphertext-with-tag)` with a fresh 12-byte IV per write.
 */

const HKDF_SALT = 'mallok.plugin.secret.v1';
const IV_BYTES = 12;

async function deriveKey(
  mallokSecret: string,
  pluginId: string,
  secretName: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(mallokSecret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(HKDF_SALT),
      info: new TextEncoder().encode(`${pluginId}:${secretName}`),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts one secret value for storage. */
export async function encryptSecret(
  mallokSecret: string,
  pluginId: string,
  secretName: string,
  value: string,
): Promise<string> {
  const key = await deriveKey(mallokSecret, pluginId, secretName);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), IV_BYTES);
  let binary = '';
  for (const byte of out) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Decrypts one stored secret, or returns `null` when it cannot be read. */
export async function decryptSecret(
  mallokSecret: string,
  pluginId: string,
  secretName: string,
  stored: string,
): Promise<string | null> {
  try {
    const binary = atob(stored);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const key = await deriveKey(mallokSecret, pluginId, secretName);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) },
      key,
      bytes.subarray(IV_BYTES),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
