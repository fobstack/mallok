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
import { parsePackMetadata } from './pack-metadata.mjs';

const run = promisify(execFile);
const packageDir = resolve(process.argv[2] ?? 'dist/pkg');
const outputDir = resolve(process.argv[3] ?? 'dist/release');

// Bind the candidate to the repository that actually contains the package
// directory. Using the caller's cwd here would let an unrelated clean checkout
// hide dirty source used to build an absolute packageDir.
const { stdout: sourceRootOutput } = await run('git', [
  '-C',
  packageDir,
  'rev-parse',
  '--show-toplevel',
]);
const sourceRoot = sourceRootOutput.trim();
const [{ stdout: sourceCommitOutput }, { stdout: sourceStatus }] =
  await Promise.all([
    run('git', ['-C', sourceRoot, 'rev-parse', 'HEAD']),
    run('git', [
      '-C',
      sourceRoot,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]),
  ]);
const sourceCommit = sourceCommitOutput.trim();
if (!/^[a-f0-9]{40,64}$/.test(sourceCommit)) {
  throw new Error('Could not identify the source Git commit.');
}
if (sourceStatus !== '') {
  throw new Error(
    'Refusing to pack a release candidate from a dirty Git worktree. Commit or remove every tracked and untracked change first.',
  );
}

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
const bytes = await readFile(candidate);
const packed = parsePackMetadata(stdout, expectedFile, bytes.byteLength);
const metadata = {
  filename: packed.filename,
  size: packed.size,
  unpackedSize: packed.unpackedSize,
  integrity: packed.integrity,
  shasum: packed.shasum,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sourceCommit,
};
await writeFile(record, `${JSON.stringify(metadata, null, 2)}\n`, {
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
