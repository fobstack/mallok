/**
 * Hashing helpers built on WebCrypto so they run identically in Node,
 * browsers and workerd.
 */

const encoder = new TextEncoder();

/** Returns the lowercase hex SHA-256 digest of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  return sha256HexOfBytes(encoder.encode(text));
}

/** Returns the lowercase hex SHA-256 digest of a byte buffer. */
export async function sha256HexOfBytes(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/** Encodes bytes as lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Serializes a JSON value with object keys sorted recursively, so that two
 * structurally equal values always produce the same string. Used to build
 * cache keys; not intended for round-tripping arbitrary data.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
