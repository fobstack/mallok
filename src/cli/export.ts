/**
 * `mallok export` (docs/CLI.md §7, docs/CONTENT_FORMAT.md §8).
 *
 * The site returns a manifest; the CLI writes the files. Text arrives inline
 * and media is fetched from the site, so a large export streams file by file
 * instead of being assembled in the Worker.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
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
}

/**
 * Refuses a path that would escape the export directory.
 *
 * The manifest comes from a site the user chose, but writing files is the one
 * place where a bad value costs more than an error message.
 */
function safeJoin(root: string, relative: string): string {
  const parts = relative.split('/');
  if (parts.some((part) => part === '..' || part === '' || part === '.')) {
    throw new CliError(
      EXIT.remote,
      `The site returned an unusable path: ${relative}`,
    );
  }
  return join(root, ...parts);
}

/** Writes a full export into `directory`. */
export async function exportSite(
  client: SiteClient,
  directory: string,
  report: Reporter,
): Promise<{ files: number; media: number; content: number }> {
  report.step(`Reading the export manifest from ${client.origin}…`);
  const manifest = await client.get<ExportManifest>('/export');

  let written = 0;
  for (const file of manifest.files) {
    const target = safeJoin(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    if (file.text !== undefined) {
      // `index*.md` is written byte for byte as stored: an export never
      // rewrites source text (docs/CONTENT_FORMAT.md §8).
      await writeFile(target, file.text, 'utf8');
    } else if (file.url !== undefined) {
      await writeFile(target, await client.bytes(file.url));
    } else {
      continue;
    }
    written++;
    if (written % 25 === 0) {
      report.step(`  ${written}/${manifest.files.length} files`);
    }
  }

  report.step(`Wrote ${written} files to ${directory}${sep}`);
  return {
    files: written,
    media: manifest.counts.media,
    content: manifest.counts.content,
  };
}
