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

import {
  exportPathKey,
  exportPathProblem,
  sha256HexOfBytes,
} from '../core/index.js';
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
  const failures = manifest.pluginExportFailures ?? [];
  if (failures.length > 0) {
    throw new Error(
      `The export is incomplete because these plugins failed: ${failures
        .map((failure) => failure.plugin)
        .join(', ')}. No backup was downloaded.`,
    );
  }

  const claimed = new Map<string, string>();
  for (const file of manifest.files) {
    const problem = exportPathProblem(file.path);
    if (problem !== null) {
      throw new Error(`The export path "${file.path}" ${problem}.`);
    }
    const key = exportPathKey(file.path);
    const previous = claimed.get(key);
    if (previous !== undefined) {
      throw new Error(
        `The export path "${file.path}" conflicts with "${previous}".`,
      );
    }
    claimed.set(key, file.path);
    const hasText = typeof file.text === 'string';
    const hasUrl = typeof file.url === 'string';
    if (hasText === hasUrl) {
      throw new Error(
        `The export entry "${file.path}" must contain exactly one of text or url.`,
      );
    }
    if (
      hasUrl &&
      (!file.url?.startsWith('/') ||
        file.url.startsWith('//') ||
        file.url.includes('\\'))
    ) {
      throw new Error(
        `The export URL for "${file.path}" is not site-relative.`,
      );
    }
    if (
      hasUrl &&
      (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))
    ) {
      throw new Error(
        `The export entry "${file.path}" has no valid sha256 for its downloaded bytes.`,
      );
    }
  }

  const { zipSync } = await import('fflate');

  const encoder = new TextEncoder();
  const entries = Object.create(null) as Record<string, Uint8Array>;
  let done = 0;
  for (const file of manifest.files) {
    if (file.text !== undefined) {
      entries[file.path] = encoder.encode(file.text);
    } else if (file.url !== undefined) {
      const response = await fetch(file.url, { credentials: 'same-origin' });
      if (!response.ok) {
        throw new Error(
          `Could not fetch "${file.path}" while building the export (${response.status}).`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if ((await sha256HexOfBytes(bytes)) !== file.sha256) {
        throw new Error(
          `The downloaded bytes for "${file.path}" do not match its sha256.`,
        );
      }
      entries[file.path] = bytes;
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
    failures,
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
