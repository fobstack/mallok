/**
 * D1 access for the `media` table.
 *
 * Reference counting is the part that matters: `ref_count` says how many
 * content rows name this object in their `assets` map, and it is updated in
 * the same batch as the content write so the two can never disagree
 * (docs/DATA_MODEL.md §2.4).
 */

import type { MediaRow } from './queries.js';

/** A media object to insert. */
export interface NewMedia {
  readonly sha256: string;
  readonly kind: 'image' | 'file';
  readonly mime: string;
  readonly ext: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly originalName: string;
  readonly alt: string | null;
  readonly now: string;
}

/** Loads one media row. */
export async function findMedia(
  db: D1Database,
  sha256: string,
): Promise<MediaRow | null> {
  return db
    .prepare('SELECT * FROM media WHERE sha256 = ?')
    .bind(sha256)
    .first<MediaRow>();
}

/** Returns the subset of `hashes` that already exists, for upload dedupe. */
export async function existingMedia(
  db: D1Database,
  hashes: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(hashes)];
  if (unique.length === 0) {
    return [];
  }
  const placeholders = unique.map(() => '?').join(', ');
  const rows = await db
    .prepare(`SELECT sha256 FROM media WHERE sha256 IN (${placeholders})`)
    .bind(...unique)
    .all<{ sha256: string }>();
  return rows.results.map((row) => row.sha256);
}

/**
 * Inserts a media object. Content addressing makes this idempotent: the same
 * bytes always produce the same key, so a repeated upload is a no-op rather
 * than a conflict.
 */
export async function insertMedia(
  db: D1Database,
  media: NewMedia,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO media
         (sha256, kind, mime, ext, bytes, width, height, variants,
          original_name, alt, ref_count, unreferenced_since, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, ?, ?)`,
    )
    .bind(
      media.sha256,
      media.kind,
      media.mime,
      media.ext,
      media.bytes,
      media.width,
      media.height,
      media.originalName,
      media.alt,
      // A freshly uploaded object is unreferenced until content names it, so
      // the garbage-collection clock starts now.
      media.now,
      media.now,
    )
    .run();
}

/** Replaces the recorded variant widths of an image. */
export async function setVariants(
  db: D1Database,
  sha256: string,
  widths: readonly number[],
): Promise<void> {
  const sorted = [...new Set(widths)].sort((a, b) => a - b);
  await db
    .prepare('UPDATE media SET variants = ? WHERE sha256 = ?')
    .bind(JSON.stringify(sorted), sha256)
    .run();
}

/** Updates the default alt text of an image. */
export async function setMediaAlt(
  db: D1Database,
  sha256: string,
  alt: string | null,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE media SET alt = ? WHERE sha256 = ?')
    .bind(alt, sha256)
    .run();
  return result.meta.changes === 1;
}

/** Filter for the media library listing. */
export interface MediaListFilter {
  readonly kind?: 'image' | 'file';
  /** Only objects no content references. */
  readonly unusedOnly?: boolean;
  readonly limit: number;
  readonly offset: number;
}

/** Lists media, newest first. Bounded by `limit`, never counts the table. */
export async function listMedia(
  db: D1Database,
  filter: MediaListFilter,
): Promise<{ items: MediaRow[]; hasNext: boolean }> {
  const clauses: string[] = [];
  const bindings: (string | number)[] = [];
  if (filter.kind !== undefined) {
    clauses.push('kind = ?');
    bindings.push(filter.kind);
  }
  if (filter.unusedOnly === true) {
    clauses.push('ref_count = 0');
  }
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
  const rows = await db
    .prepare(
      `SELECT * FROM media ${where}
       ORDER BY created_at DESC, sha256
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, filter.limit + 1, filter.offset)
    .all<MediaRow>();
  return {
    items: rows.results.slice(0, filter.limit),
    hasNext: rows.results.length > filter.limit,
  };
}

/** Deletes a media row only while nothing references it. */
export async function deleteUnreferencedMedia(
  db: D1Database,
  sha256: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM media WHERE sha256 = ? AND ref_count = 0')
    .bind(sha256)
    .run();
  return result.meta.changes === 1;
}

/** Media eligible for garbage collection: unreferenced since before `cutoff`. */
export async function mediaToCollect(
  db: D1Database,
  cutoff: string,
  limit: number,
): Promise<MediaRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM media
       WHERE ref_count = 0
         AND unreferenced_since IS NOT NULL
         AND unreferenced_since < ?
       ORDER BY unreferenced_since
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<MediaRow>();
  return rows.results;
}

/**
 * Builds the statements that move `ref_count` from one asset set to another.
 * Returned rather than executed so the caller can put them in the same batch
 * as the content write.
 */
export function refCountStatements(
  db: D1Database,
  previous: readonly string[],
  next: readonly string[],
  now: string,
): D1PreparedStatement[] {
  const before = new Set(previous);
  const after = new Set(next);
  const statements: D1PreparedStatement[] = [];

  for (const sha of after) {
    if (!before.has(sha)) {
      statements.push(
        db
          .prepare(
            `UPDATE media
             SET ref_count = ref_count + 1, unreferenced_since = NULL
             WHERE sha256 = ?`,
          )
          .bind(sha),
      );
    }
  }
  for (const sha of before) {
    if (!after.has(sha)) {
      statements.push(
        db
          .prepare(
            // The CASE reads the pre-update ref_count, so it decides on the
            // value this statement is about to write.
            `UPDATE media
             SET ref_count = MAX(0, ref_count - 1),
                 unreferenced_since =
                   CASE WHEN ref_count - 1 <= 0 THEN ? ELSE NULL END
             WHERE sha256 = ?`,
          )
          .bind(now, sha),
      );
    }
  }
  return statements;
}

/** Extracts the distinct media hashes named by an `assets` JSON column. */
export function assetHashes(assetsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(assetsJson);
    if (parsed === null || typeof parsed !== 'object') {
      return [];
    }
    return [
      ...new Set(
        Object.values(parsed as Record<string, unknown>).filter(
          (value): value is string => typeof value === 'string',
        ),
      ),
    ];
  } catch {
    return [];
  }
}
