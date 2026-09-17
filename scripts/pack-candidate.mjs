/**
 * Packs the release candidate exactly once.
 *
 * The tarball lives outside `dist/pkg`: tests may inspect or even rebuild the
 * package directory, but the file selected for publication remains immutable.
 * Refusing an existing output turns an accidental second pack into a hard
 * failure instead of silently changing what "the candidate" means.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const packageDir = resolve(process.argv[2] ?? 'dist/pkg');
const outputDir = resolve(process.argv[3] ?? 'dist/release');
const manifest = JSON.parse(
  await readFile(resolve(packageDir, 'package.json'), 'utf8'),
);

if (manifest.name !== 'mallok' || typeof manifest.version !== 'string') {
  throw new Error('The candidate source must be a versioned mallok package.');
}

const expectedFile = `mallok-${manifest.version}.tgz`;
const candidate = resolve(outputDir, expectedFile);
const record = resolve(outputDir, 'pack.json');
try {
  // Directory creation is the lock. A check followed by a write would let
  // two packers both observe an empty destination and overwrite each other.
  await mkdir(outputDir);
} catch (error) {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EEXIST'
  ) {
    throw new Error(
      `Refusing to reuse ${outputDir}. A release candidate is packed once.`,
    );
  }
  throw error;
}

const { stdout } = await run(
  'npm',
  ['pack', '--json', '--pack-destination', outputDir],
  { cwd: packageDir, maxBuffer: 32 * 1024 * 1024 },
);
const [packed] = JSON.parse(stdout);
if (packed?.filename !== expectedFile) {
  throw new Error(
    `npm packed ${String(packed?.filename)}, expected ${expectedFile}.`,
  );
}

const bytes = await readFile(candidate);
const metadata = {
  filename: packed.filename,
  size: packed.size,
  unpackedSize: packed.unpackedSize,
  integrity: packed.integrity,
  shasum: packed.shasum,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
await writeFile(record, `${JSON.stringify(metadata, null, 2)}\n`, {
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
