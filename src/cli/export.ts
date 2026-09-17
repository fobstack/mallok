/**
 * `mallok export` (docs/CLI.md §7, docs/CONTENT_FORMAT.md §8).
 *
 * The site returns a manifest; the CLI writes the files. Text arrives inline
 * and media is fetched from the site, so a large export streams file by file
 * instead of being assembled in the Worker.
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  exportPathKey,
  exportPathProblem,
  sha256HexOfBytes,
} from '../core/index.js';
import type { SiteClient } from './client.js';
import { CliError, EXIT, type Reporter } from './output.js';

/** One file the manifest asks for. */
interface ExportFile {
  readonly path: string;
  readonly text?: string;
  readonly sha256?: string;
  readonly url?: string;
}

interface ExportManifest {
  readonly files: readonly ExportFile[];
  readonly counts: {
    readonly content: number;
    readonly files: number;
    readonly media: number;
  };
  readonly pluginExportFailures: readonly {
    readonly plugin: string;
    readonly error: string;
  }[];
}

interface DestinationState {
  readonly existed: boolean;
  readonly dev?: number;
  readonly ino?: number;
}

/**
 * Refuses a path that would escape the export directory.
 *
 * The manifest comes from a site the user chose, but writing files is the one
 * place where a bad value costs more than an error message.
 */
function safeJoin(root: string, requestedPath: string): string {
  if (typeof requestedPath !== 'string') {
    throw new CliError(EXIT.remote, 'The site returned a non-string path.');
  }
  const problem = exportPathProblem(requestedPath);
  if (problem !== null) {
    throw new CliError(
      EXIT.remote,
      `The site returned an unusable path ${JSON.stringify(requestedPath)}: it ${problem}.`,
    );
  }
  const parts = requestedPath.split('/');
  const base = resolve(root);
  const target = resolve(base, ...parts);
  const fromBase = relative(base, target);
  if (
    fromBase === '' ||
    fromBase === '..' ||
    fromBase.startsWith(`..${sep}`) ||
    isAbsolute(fromBase)
  ) {
    throw new CliError(
      EXIT.remote,
      `The site returned an unusable path: ${JSON.stringify(requestedPath)}`,
    );
  }
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidManifest(reason: string): never {
  throw new CliError(
    EXIT.remote,
    `The site returned an invalid export manifest: ${reason}`,
  );
}

/** Checks every remote value before any filesystem mutation. */
function parseManifest(value: unknown): ExportManifest {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return invalidManifest('files must be an array.');
  }

  const files: ExportFile[] = value.files.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.path !== 'string') {
      return invalidManifest(`files[${index}] must contain a string path.`);
    }
    const hasText = typeof entry.text === 'string';
    const hasUrl = typeof entry.url === 'string';
    if (hasText === hasUrl) {
      return invalidManifest(
        `files[${index}] must contain exactly one of text or url.`,
      );
    }
    if (
      hasUrl &&
      (!(entry.url as string).startsWith('/') ||
        (entry.url as string).startsWith('//') ||
        (entry.url as string).includes('\\'))
    ) {
      return invalidManifest(`files[${index}].url must be site-relative.`);
    }
    if (
      hasUrl &&
      (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))
    ) {
      return invalidManifest(
        `files[${index}].sha256 must identify the downloaded bytes.`,
      );
    }
    return {
      path: entry.path,
      ...(hasText ? { text: entry.text as string } : {}),
      ...(hasUrl ? { url: entry.url as string } : {}),
      ...(typeof entry.sha256 === 'string' ? { sha256: entry.sha256 } : {}),
    };
  });

  if (!isRecord(value.counts)) {
    return invalidManifest('counts must be an object.');
  }
  const rawCounts = value.counts;
  const count = (name: 'content' | 'files' | 'media'): number => {
    const result = rawCounts[name];
    if (!Number.isSafeInteger(result) || (result as number) < 0) {
      return invalidManifest(`counts.${name} must be a non-negative integer.`);
    }
    return result as number;
  };
  const counts = {
    content: count('content'),
    files: count('files'),
    media: count('media'),
  };
  if (counts.files !== files.length) {
    return invalidManifest('counts.files does not match files.length.');
  }

  const rawFailures = value.pluginExportFailures ?? [];
  if (!Array.isArray(rawFailures)) {
    return invalidManifest('pluginExportFailures must be an array.');
  }
  const pluginExportFailures = rawFailures.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.plugin !== 'string' ||
      typeof entry.error !== 'string'
    ) {
      return invalidManifest(
        `pluginExportFailures[${index}] must contain plugin and error strings.`,
      );
    }
    return { plugin: entry.plugin, error: entry.error };
  });

  return { files, counts, pluginExportFailures };
}

async function readDestination(root: string): Promise<DestinationState> {
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (info === null) {
    return { existed: false };
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new CliError(
      EXIT.user,
      `The export destination must be a new or empty directory: ${root}`,
    );
  }
  if ((await readdir(root)).length !== 0) {
    throw new CliError(
      EXIT.user,
      `The export destination is not empty: ${root}`,
      'Choose a new directory so a failed export cannot mix old and new backup files.',
    );
  }
  return { existed: true, dev: info.dev, ino: info.ino };
}

async function assertDestinationUnchanged(
  root: string,
  original: DestinationState,
): Promise<void> {
  const current = await readDestination(root);
  if (
    current.existed !== original.existed ||
    (original.existed &&
      (current.dev !== original.dev || current.ino !== original.ino))
  ) {
    throw new CliError(
      EXIT.user,
      `The export destination changed while the backup was being assembled: ${root}`,
    );
  }
}

/** Writes a full export into `directory`. */
export async function exportSite(
  client: SiteClient,
  directory: string,
  report: Reporter,
): Promise<{ files: number; media: number; content: number }> {
  report.step(`Reading the export manifest from ${client.origin}…`);
  const manifest = parseManifest(await client.get<unknown>('/export'));

  if (manifest.pluginExportFailures.length > 0) {
    const plugins = manifest.pluginExportFailures
      .map((failure) => failure.plugin)
      .join(', ');
    throw new CliError(
      EXIT.remote,
      `The site could not export data for these plugins: ${plugins}. No files were written.`,
      'Fix or disable the failing plugins, then export again.',
    );
  }

  const root = resolve(directory);

  // Check the whole manifest before the first write. Otherwise a malicious
  // last entry can leave a partially written export before it is refused.
  const planned: ExportFile[] = [];
  const targets = new Map<string, string>();
  for (const file of manifest.files) {
    safeJoin(root, file.path);
    const key = exportPathKey(file.path);
    const previous = targets.get(key);
    if (previous !== undefined) {
      throw new CliError(
        EXIT.remote,
        `The site returned the export path more than once: ${JSON.stringify(file.path)} (already ${JSON.stringify(previous)}).`,
      );
    }
    targets.set(key, file.path);
    planned.push(file);
  }

  const destination = await readDestination(root);
  await mkdir(dirname(root), { recursive: true });
  const staging = await mkdtemp(resolve(dirname(root), '.mallok-export-'));
  let published = false;
  let written = 0;
  try {
    for (const file of planned) {
      const target = safeJoin(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      if (file.text !== undefined) {
        // `index*.md` is written byte for byte as stored: an export never
        // rewrites source text (docs/CONTENT_FORMAT.md §8).
        await writeFile(target, file.text, 'utf8');
      } else if (file.url !== undefined) {
        const bytes = await client.bytes(file.url);
        if (
          file.sha256 === undefined ||
          (await sha256HexOfBytes(bytes)) !== file.sha256
        ) {
          throw new CliError(
            EXIT.remote,
            `The downloaded bytes for ${JSON.stringify(file.path)} do not match its sha256.`,
          );
        }
        await writeFile(target, bytes);
      }
      written++;
      if (written % 25 === 0) {
        report.step(`  ${written}/${manifest.files.length} files`);
      }
    }

    await assertDestinationUnchanged(root, destination);
    if (destination.existed) {
      await rmdir(root);
    }
    try {
      await rename(staging, root);
      published = true;
    } catch (error) {
      if (destination.existed) {
        await mkdir(root).catch(() => undefined);
      }
      throw error;
    }
  } finally {
    if (!published) {
      await rm(staging, { recursive: true, force: true });
    }
  }

  report.step(`Wrote ${written} files to ${root}${sep}`);
  return {
    files: written,
    media: manifest.counts.media,
    content: manifest.counts.content,
  };
}
