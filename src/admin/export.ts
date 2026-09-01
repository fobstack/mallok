/**
 * Building a site export in the browser (docs/CONTENT_FORMAT.md §5, §8).
 *
 * The Worker returns a manifest, not an archive — zipping a whole site inside
 * it would pull every media object through the Worker, which the CPU and
 * memory budgets do not allow (docs/ARCHITECTURE.md §8). So the browser
 * fetches the files and zips them here, from the same manifest the CLI reads.
 *
 * `fflate` does the zipping: a hand-written ZIP writer is exactly the kind of
 * thing a mature library should do (docs/TECH_STACK.md §11.6).
 */

import { api } from './api.js';

/** One file the manifest asks for. */
interface ExportFile {
  readonly path: string;
  readonly text?: string;
  readonly sha256?: string;
  readonly url?: string;
}

interface ExportManifest {
  readonly generatedFor: string;
  readonly files: readonly ExportFile[];
  readonly counts: {
    readonly content: number;
    readonly files: number;
    readonly media: number;
  };
  readonly pluginExportFailures: readonly {
    plugin: string;
    error: string;
  }[];
}

/** Progress as the export is assembled. */
export interface ExportProgress {
  readonly done: number;
  readonly total: number;
}

/** What an export produced. */
export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
  readonly counts: ExportManifest['counts'];
  readonly failures: ExportManifest['pluginExportFailures'];
}

/** Fetches every file in the manifest and zips them. */
export async function buildExportZip(
  onProgress?: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  const manifest = await api<ExportManifest>('/export');
  const { zipSync } = await import('fflate');

  const encoder = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  let done = 0;
  for (const file of manifest.files) {
    if (file.text !== undefined) {
      entries[file.path] = encoder.encode(file.text);
    } else if (file.url !== undefined) {
      const response = await fetch(file.url, { credentials: 'same-origin' });
      if (response.ok) {
        entries[file.path] = new Uint8Array(await response.arrayBuffer());
      }
      // A missing object is the documented missing-media state, not a
      // failure: the reference stays in the text and no file is written.
    }
    done++;
    onProgress?.({ done, total: manifest.files.length });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob: new Blob([zipSync(entries, { level: 6 }) as BlobPart], {
      type: 'application/zip',
    }),
    fileName: `mallok-export-${stamp}.zip`,
    counts: manifest.counts,
    failures: manifest.pluginExportFailures ?? [],
  };
}

/** Hands the finished archive to the browser. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
