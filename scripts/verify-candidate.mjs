/** Verifies that the already packed candidate has not changed. */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const candidate = resolve(
  process.argv[2] ??
    (() => {
      throw new Error('Usage: node scripts/verify-candidate.mjs <tarball>');
    })(),
);
const recordPath = resolve(dirname(candidate), 'pack.json');
const record = JSON.parse(await readFile(recordPath, 'utf8'));
const bytes = await readFile(candidate);

if (
  !Number.isSafeInteger(record.unpackedSize) ||
  record.unpackedSize <= 0 ||
  typeof record.sourceCommit !== 'string' ||
  !/^[a-f0-9]{40,64}$/.test(record.sourceCommit)
) {
  throw new Error('The candidate record is incomplete or invalid.');
}
const { stdout: currentCommitOutput } = await run('git', ['rev-parse', 'HEAD']);
const currentCommit = currentCommitOutput.trim();
if (currentCommit !== record.sourceCommit) {
  throw new Error(
    `Candidate source commit changed: recorded ${record.sourceCommit}, current ${currentCommit}.`,
  );
}

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
