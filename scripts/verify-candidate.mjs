/** Verifies that the already packed candidate has not changed. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const candidate = resolve(
  process.argv[2] ??
    (() => {
      throw new Error('Usage: node scripts/verify-candidate.mjs <tarball>');
    })(),
);
const recordPath = resolve(dirname(candidate), 'pack.json');
const record = JSON.parse(await readFile(recordPath, 'utf8'));
const bytes = await readFile(candidate);

const actual = {
  filename: basename(candidate),
  size: bytes.byteLength,
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  shasum: createHash('sha1').update(bytes).digest('hex'),
  sha256: createHash('sha256').update(bytes).digest('hex'),
};

for (const key of ['filename', 'size', 'integrity', 'shasum', 'sha256']) {
  if (record[key] !== actual[key]) {
    throw new Error(
      `Candidate ${key} changed: recorded ${String(record[key])}, ` +
        `actual ${String(actual[key])}.`,
    );
  }
}

process.stdout.write(`candidate verified: ${actual.sha256}\n`);
