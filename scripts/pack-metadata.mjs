/** Validates the one-package JSON record returned by `npm pack --json`. */

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`npm pack returned an invalid ${name}.`);
  }
  return value;
}

function canonicalSha512(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) {
    return false;
  }
  const encoded = value.slice('sha512-'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return false;
  }
  const digest = Buffer.from(encoded, 'base64');
  return digest.byteLength === 64 && digest.toString('base64') === encoded;
}

export function parsePackMetadata(stdout, expectedFile, actualSize) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('npm pack returned invalid JSON.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 1 ||
    parsed[0] === null ||
    typeof parsed[0] !== 'object'
  ) {
    throw new Error('npm pack did not return exactly one package record.');
  }

  const [packed] = parsed;
  if (packed.filename !== expectedFile) {
    throw new Error(
      `npm packed ${String(packed.filename)}, expected ${expectedFile}.`,
    );
  }
  const size = positiveInteger(packed.size, 'size');
  if (size !== actualSize) {
    throw new Error(
      `npm pack reported ${size} bytes, but the candidate has ${actualSize}.`,
    );
  }
  const unpackedSize = positiveInteger(packed.unpackedSize, 'unpackedSize');
  if (!canonicalSha512(packed.integrity)) {
    throw new Error('npm pack returned an invalid integrity.');
  }
  if (
    typeof packed.shasum !== 'string' ||
    !/^[a-f0-9]{40}$/.test(packed.shasum)
  ) {
    throw new Error('npm pack returned an invalid shasum.');
  }

  return {
    filename: packed.filename,
    size,
    unpackedSize,
    integrity: packed.integrity,
    shasum: packed.shasum,
  };
}
