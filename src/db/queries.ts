/**
 * All D1 access for the Worker. SQL is hand-written and parameterized; row
 * types mirror docs/DATA_MODEL.md. Nothing outside `src/db` should see D1
 * statement objects.
 */

import { assetHashes, refCountStatements } from './media.js';

/** Row of the single-row `site` table. */
export interface SiteRow {
  readonly id: number;
  readonly name: string;
  readonly tagline: string | null;
  readonly default_locale: string;
  /** JSON array of enabled locales. */
  readonly locales: string;
  /** JSON map of enabled kinds to `{ base }`. */
  readonly kinds: string;
  readonly theme_options: string;
  readonly nav: string;
  readonly seo: string;
  readonly domain: string | null;
  readonly media_base_url: string | null;
  readonly cache_ttl: number;
  readonly max_image_edge: number | null;
  readonly content_rev: number;
  readonly setup_completed_at: string | null;
  /** When the one-time setup key was spent; null until the wizard runs. */
  readonly setup_key_used_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Row of the `content` table. */
export interface ContentRow {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly translation_group: string;
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly description: string | null;
  readonly frontmatter: string;
  readonly markdown: string;
  readonly markdown_sha256: string;
  readonly assets: string;
  readonly cover_sha256: string | null;
  readonly status: 'draft' | 'scheduled' | 'published';
  readonly published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly rev: number;
}

/** Columns of `content` needed for lists; never includes `markdown`. */
export type ContentSummaryRow = Omit<
  ContentRow,
  'markdown' | 'markdown_sha256' | 'assets'
>;

const SUMMARY_COLUMNS =
  'id, kind, locale, translation_group, slug, path, title, description, frontmatter, cover_sha256, status, published_at, created_at, updated_at, rev';

/** Row of the `render_cache` table. */
export interface RenderCacheRow {
  readonly cache_key: string;
  readonly content_id: string;
  readonly html: string;
  readonly meta: string;
  readonly pipeline_version: string;
  readonly created_at: string;
}

/** Row of the `plugin_state` table. */
export interface PluginStateRow {
  readonly plugin_id: string;
  readonly enabled: number;
  readonly version: string;
  readonly settings: string;
  readonly secrets: string;
  readonly updated_at: string;
}

/** A published translation of some content: locale and public path. */
export interface TranslationRow {
  readonly locale: string;
  readonly path: string;
}

/** Everything a cold render of one content page needs, from one batch. */
export interface ContentRenderData {
  readonly site: SiteRow | null;
  readonly content: ContentRow | null;
  readonly fragment: RenderCacheRow | null;
  readonly plugins: readonly PluginStateRow[];
  readonly translations: readonly TranslationRow[];
}

/**
 * Loads the site, the content at `path`, its cached fragment, the active
 * and the plugin states in a single D1 batch (constant query count, bounded
 * rows). The theme is absent on purpose: it is compiled into the build.
 */
export async function loadContentRenderData(
  db: D1Database,
  path: string,
): Promise<ContentRenderData> {
  const [site, content, fragment, plugins, translations] = await db.batch([
    db.prepare('SELECT * FROM site WHERE id = 1'),
    db.prepare('SELECT * FROM content WHERE path = ?').bind(path),
    db
      .prepare(
        `SELECT rc.* FROM render_cache rc
           JOIN content c ON c.id = rc.content_id
           WHERE c.path = ?
           ORDER BY rc.created_at DESC LIMIT 1`,
      )
      .bind(path),
    db.prepare('SELECT * FROM plugin_state WHERE enabled = 1'),
    db
      .prepare(
        `SELECT c2.locale, c2.path FROM content c1
           JOIN content c2 ON c2.translation_group = c1.translation_group
           WHERE c1.path = ? AND c2.status = 'published'
           ORDER BY c2.locale`,
      )
      .bind(path),
  ]);
  return {
    site: firstOrNull<SiteRow>(site),
    content: firstOrNull<ContentRow>(content),
    fragment: firstOrNull<RenderCacheRow>(fragment),
    plugins: (plugins?.results ?? []) as PluginStateRow[],
    translations: (translations?.results ?? []) as TranslationRow[],
  };
}

/** Data for the home page and kind lists. */
export interface SiteRenderData {
  readonly site: SiteRow | null;
  readonly plugins: readonly PluginStateRow[];
}

/** Loads site settings and plugin states in one batch. */
export async function loadSiteRenderData(
  db: D1Database,
): Promise<SiteRenderData> {
  const [site, plugins] = await db.batch([
    db.prepare('SELECT * FROM site WHERE id = 1'),
    db.prepare('SELECT * FROM plugin_state WHERE enabled = 1'),
  ]);
  return {
    site: firstOrNull<SiteRow>(site),
    plugins: (plugins?.results ?? []) as PluginStateRow[],
  };
}

/**
 * Lists published items of one kind and locale, newest first. Fetches one
 * row more than `limit` so callers can tell whether a next page exists
 * without a `COUNT(*)`.
 */
export async function listPublished(
  db: D1Database,
  kind: string,
  locale: string,
  limit: number,
  offset: number,
  now: string,
): Promise<{ items: ContentSummaryRow[]; hasNext: boolean }> {
  const rows = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM content
       WHERE kind = ? AND locale = ? AND status = 'published' AND published_at <= ?
       ORDER BY published_at DESC, id
       LIMIT ? OFFSET ?`,
    )
    .bind(kind, locale, now, limit + 1, offset)
    .all<ContentSummaryRow>();
  const items = rows.results.slice(0, limit);
  return { items, hasNext: rows.results.length > limit };
}

/** Default values for a freshly deployed site. */
export interface SiteDefaults {
  readonly name: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
}

/** Creates the single `site` row if it does not exist yet. */
export async function ensureSiteRow(
  db: D1Database,
  defaults: SiteDefaults,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO site
         (id, name, default_locale, locales, kinds, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      defaults.name,
      defaults.defaultLocale,
      JSON.stringify(defaults.locales),
      JSON.stringify(defaults.kinds),
      now,
      now,
    )
    .run();
}

/** Loads the site row, or `null` before first boot. */
export async function loadSite(db: D1Database): Promise<SiteRow | null> {
  return db.prepare('SELECT * FROM site WHERE id = 1').first<SiteRow>();
}

/** Finds content by its natural key, for idempotent re-publishing. */
export async function findContentByKey(
  db: D1Database,
  kind: string,
  locale: string,
  slug: string,
): Promise<ContentRow | null> {
  return db
    .prepare('SELECT * FROM content WHERE kind = ? AND locale = ? AND slug = ?')
    .bind(kind, locale, slug)
    .first<ContentRow>();
}

/** Input for {@link upsertContent}. */
export interface ContentUpsert {
  readonly row: ContentRow;
  readonly fragment: {
    readonly cacheKey: string;
    readonly html: string;
    readonly meta: string;
    readonly pipelineVersion: string;
  };
  /** Public path the content had before this write, if it changed. */
  readonly previousPath?: string;
  /**
   * The `assets` JSON this content had before this write. Needed so media
   * reference counts move in the same batch as the row itself.
   */
  readonly previousAssets?: string;
}

/**
 * Writes a content row and its fragment in one batch. Older fragments of the
 * same content are dropped, media reference counts follow the change in
 * `assets`, and a redirect is recorded when the path changed.
 */
export async function upsertContent(
  db: D1Database,
  input: ContentUpsert,
): Promise<void> {
  const { row, fragment } = input;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO content (
           id, kind, locale, translation_group, slug, path, title, description,
           frontmatter, markdown, markdown_sha256, assets, cover_sha256, status,
           published_at, created_at, updated_at, rev
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           kind = excluded.kind,
           locale = excluded.locale,
           translation_group = excluded.translation_group,
           slug = excluded.slug,
           path = excluded.path,
           title = excluded.title,
           description = excluded.description,
           frontmatter = excluded.frontmatter,
           markdown = excluded.markdown,
           markdown_sha256 = excluded.markdown_sha256,
           assets = excluded.assets,
           cover_sha256 = excluded.cover_sha256,
           status = excluded.status,
           published_at = excluded.published_at,
           updated_at = excluded.updated_at,
           rev = content.rev + 1`,
      )
      .bind(
        row.id,
        row.kind,
        row.locale,
        row.translation_group,
        row.slug,
        row.path,
        row.title,
        row.description,
        row.frontmatter,
        row.markdown,
        row.markdown_sha256,
        row.assets,
        row.cover_sha256,
        row.status,
        row.published_at,
        row.created_at,
        row.updated_at,
        row.rev,
      ),
    db
      .prepare(
        'DELETE FROM render_cache WHERE content_id = ? AND cache_key != ?',
      )
      .bind(row.id, fragment.cacheKey),
    db
      .prepare(
        `INSERT OR REPLACE INTO render_cache
           (cache_key, content_id, html, meta, pipeline_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        fragment.cacheKey,
        row.id,
        fragment.html,
        fragment.meta,
        fragment.pipelineVersion,
        row.updated_at,
      ),
  ];
  if (input.previousPath !== undefined && input.previousPath !== row.path) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO redirect (from_path, to_path, status, content_id, created_at)
           VALUES (?, ?, 301, ?, ?)`,
        )
        .bind(input.previousPath, row.path, row.id, row.updated_at),
    );
  }
  statements.push(
    ...refCountStatements(
      db,
      assetHashes(input.previousAssets ?? '{}'),
      assetHashes(row.assets),
      row.updated_at,
    ),
  );
  await db.batch(statements);
}

/** Stores a freshly generated fragment for existing content. */
export async function putFragment(
  db: D1Database,
  contentId: string,
  fragment: ContentUpsert['fragment'],
  now: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        'DELETE FROM render_cache WHERE content_id = ? AND cache_key != ?',
      )
      .bind(contentId, fragment.cacheKey),
    db
      .prepare(
        `INSERT OR REPLACE INTO render_cache
           (cache_key, content_id, html, meta, pipeline_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        fragment.cacheKey,
        contentId,
        fragment.html,
        fragment.meta,
        fragment.pipelineVersion,
        now,
      ),
  ]);
}

/** Looks up a redirect for a path that has no content. */
export async function findRedirect(
  db: D1Database,
  fromPath: string,
): Promise<{ to_path: string; status: number } | null> {
  return db
    .prepare('SELECT to_path, status FROM redirect WHERE from_path = ?')
    .bind(fromPath)
    .first<{ to_path: string; status: number }>();
}

/** Publishes scheduled content whose time has come; returns affected rows. */
export async function publishDue(
  db: D1Database,
  now: string,
): Promise<ContentSummaryRow[]> {
  const due = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM content
       WHERE status = 'scheduled' AND published_at <= ?`,
    )
    .bind(now)
    .all<ContentSummaryRow>();
  if (due.results.length === 0) {
    return [];
  }
  await db.batch(
    due.results.map((row) =>
      db
        .prepare(
          "UPDATE content SET status = 'published', updated_at = ? WHERE id = ?",
        )
        .bind(now, row.id),
    ),
  );
  return due.results;
}

function firstOrNull<T>(result: D1Result<unknown> | undefined): T | null {
  const row = result?.results[0];
  return row === undefined ? null : (row as T);
}

/** Row of the `media` table. */
export interface MediaRow {
  readonly sha256: string;
  readonly kind: 'image' | 'file';
  readonly mime: string;
  readonly ext: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  /** JSON array of variant widths. */
  readonly variants: string;
  readonly original_name: string;
  readonly alt: string | null;
  readonly ref_count: number;
  readonly unreferenced_since: string | null;
  readonly created_at: string;
}

const MEDIA_CHUNK = 40;

/** Loads media rows for the given hashes; bounded by the number of hashes. */
export async function loadMediaBySha(
  db: D1Database,
  hashes: readonly string[],
): Promise<MediaRow[]> {
  const unique = [...new Set(hashes)];
  const rows: MediaRow[] = [];
  for (let i = 0; i < unique.length; i += MEDIA_CHUNK) {
    const chunk = unique.slice(i, i + MEDIA_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db
      .prepare(`SELECT * FROM media WHERE sha256 IN (${placeholders})`)
      .bind(...chunk)
      .all<MediaRow>();
    rows.push(...result.results);
  }
  return rows;
}

/** Loads a content row by id. */
export async function findContentById(
  db: D1Database,
  id: string,
): Promise<ContentRow | null> {
  return db
    .prepare('SELECT * FROM content WHERE id = ?')
    .bind(id)
    .first<ContentRow>();
}

/** Filter for the admin content list. */
export interface ContentListFilter {
  readonly kind?: string;
  readonly locale?: string;
  readonly status?: ContentRow['status'];
  readonly limit: number;
  readonly offset: number;
}

/**
 * Lists content for the admin, newest edit first. Unlike {@link listPublished}
 * this sees drafts and scheduled items, but it still reads only summary
 * columns and still avoids `COUNT(*)` (docs/DATA_MODEL.md §3).
 */
export async function listContent(
  db: D1Database,
  filter: ContentListFilter,
): Promise<{ items: ContentSummaryRow[]; hasNext: boolean }> {
  const clauses: string[] = [];
  const bindings: (string | number)[] = [];
  if (filter.kind !== undefined) {
    clauses.push('kind = ?');
    bindings.push(filter.kind);
  }
  if (filter.locale !== undefined) {
    clauses.push('locale = ?');
    bindings.push(filter.locale);
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?');
    bindings.push(filter.status);
  }
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
  const rows = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM content
       ${where}
       ORDER BY updated_at DESC, id
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, filter.limit + 1, filter.offset)
    .all<ContentSummaryRow>();
  return {
    items: rows.results.slice(0, filter.limit),
    hasNext: rows.results.length > filter.limit,
  };
}

/**
 * Deletes content, its cached fragments and its share of the media reference
 * counts. Redirects that pointed at it are left in place: an external link to
 * the old path should still resolve until the operator removes it
 * deliberately.
 */
export async function deleteContent(
  db: D1Database,
  row: Pick<ContentRow, 'id' | 'assets'>,
  now: string,
): Promise<boolean> {
  const [deleted] = await db.batch([
    db.prepare('DELETE FROM content WHERE id = ?').bind(row.id),
    db.prepare('DELETE FROM render_cache WHERE content_id = ?').bind(row.id),
    ...refCountStatements(db, assetHashes(row.assets), [], now),
  ]);
  return (deleted?.meta.changes ?? 0) > 0;
}

/** Columns of `site` the management API may change. */
export interface SitePatch {
  readonly name?: string;
  readonly tagline?: string | null;
  readonly locales?: string;
  readonly kinds?: string;
  readonly theme_options?: string;
  readonly nav?: string;
  readonly seo?: string;
  readonly domain?: string | null;
  readonly media_base_url?: string | null;
  readonly cache_ttl?: number;
  readonly max_image_edge?: number | null;
  readonly setup_completed_at?: string | null;
  readonly setup_key_used_at?: string | null;
}

/**
 * Applies a partial update to the single `site` row. `default_locale` is
 * deliberately absent: changing it rewrites every public path and must go
 * through the dedicated flow (docs/DATA_MODEL.md §2.2).
 */
export async function updateSite(
  db: D1Database,
  patch: SitePatch,
  now: string,
): Promise<void> {
  const entries = Object.entries(patch).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return;
  }
  const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
  const bindings = entries.map(([, value]) => value as string | number | null);
  await db
    .prepare(`UPDATE site SET ${assignments}, updated_at = ? WHERE id = 1`)
    .bind(...bindings, now)
    .run();
}

/** Row counts used by the admin's diagnostics page. */
export interface StorageCounts {
  readonly content: number;
  readonly published: number;
  readonly media: number;
  readonly redirects: number;
  readonly fragments: number;
  readonly jobsPending: number;
}

/** Counts rows per table. Bounded work: one aggregate query per table. */
export async function countStorage(db: D1Database): Promise<StorageCounts> {
  const [content, published, media, redirects, fragments, jobs] =
    await db.batch([
      db.prepare('SELECT COUNT(*) AS n FROM content'),
      db.prepare(
        "SELECT COUNT(*) AS n FROM content WHERE status = 'published'",
      ),
      db.prepare('SELECT COUNT(*) AS n FROM media'),
      db.prepare('SELECT COUNT(*) AS n FROM redirect'),
      db.prepare('SELECT COUNT(*) AS n FROM render_cache'),
      db.prepare("SELECT COUNT(*) AS n FROM job WHERE status = 'pending'"),
    ]);
  const read = (result: D1Result<unknown> | undefined): number =>
    (result?.results[0] as { n?: number } | undefined)?.n ?? 0;
  return {
    content: read(content),
    published: read(published),
    media: read(media),
    redirects: read(redirects),
    fragments: read(fragments),
    jobsPending: read(jobs),
  };
}

/** Ids of applied schema migrations, newest last. */
export async function appliedMigrations(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare('SELECT id FROM migration ORDER BY applied_at, id')
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

/** Identity and location of one content row, for bulk path work. */
export interface ContentLocation {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly path: string;
}

/**
 * Every content row's identity and current path, ordered by locale.
 *
 * Only used by the deliberate bulk operation that changes the default locale,
 * which is why reading the whole table is acceptable here and nowhere else.
 */
export async function listContentLocations(
  db: D1Database,
): Promise<ContentLocation[]> {
  const rows = await db
    .prepare(
      'SELECT id, kind, locale, slug, path FROM content ORDER BY locale, id',
    )
    .all<ContentLocation>();
  return rows.results;
}

/** One content row moving from `from` to `to`. */
export interface PathMove {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Rewrites public paths and records a redirect for each one.
 *
 * `moves` must be ordered so that a path is vacated before another row claims
 * it, because `content.path` is unique. The caller guarantees that by moving
 * every row that gains a locale prefix before any row that loses one.
 */
export async function movePaths(
  db: D1Database,
  moves: readonly PathMove[],
  now: string,
  chunkSize = 20,
): Promise<void> {
  for (let i = 0; i < moves.length; i += chunkSize) {
    const chunk = moves.slice(i, i + chunkSize);
    const statements: D1PreparedStatement[] = [];
    for (const move of chunk) {
      statements.push(
        db
          .prepare('UPDATE content SET path = ?, updated_at = ? WHERE id = ?')
          .bind(move.to, now, move.id),
        db
          .prepare(
            `INSERT OR REPLACE INTO redirect
               (from_path, to_path, status, content_id, created_at)
             VALUES (?, ?, 301, ?, ?)`,
          )
          .bind(move.from, move.to, move.id, now),
      );
    }
    await db.batch(statements);
  }
}

/** Changes the site's default locale. Paths must already have been moved. */
export async function setDefaultLocale(
  db: D1Database,
  locale: string,
  now: string,
): Promise<void> {
  await db
    .prepare('UPDATE site SET default_locale = ?, updated_at = ? WHERE id = 1')
    .bind(locale, now)
    .run();
}

/** Published translations of one content item, including itself. */
export async function listTranslationsOf(
  db: D1Database,
  translationGroup: string,
): Promise<ContentSummaryRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM content
       WHERE translation_group = ?
       ORDER BY locale`,
    )
    .bind(translationGroup)
    .all<ContentSummaryRow>();
  return rows.results;
}

/** One row of the sitemap query: location plus translation identity. */
export interface SitemapRow {
  readonly path: string;
  readonly locale: string;
  readonly translation_group: string;
  readonly updated_at: string;
}

/**
 * Published pages for the sitemap, ordered stably. Fetches one row more than
 * `limit` so the caller can tell whether another page exists.
 */
export async function listForSitemap(
  db: D1Database,
  now: string,
  limit: number,
  offset: number,
): Promise<{ rows: SitemapRow[]; hasNext: boolean }> {
  const result = await db
    .prepare(
      `SELECT path, locale, translation_group, updated_at FROM content
       WHERE status = 'published' AND published_at <= ?
       ORDER BY translation_group, locale
       LIMIT ? OFFSET ?`,
    )
    .bind(now, limit + 1, offset)
    .all<SitemapRow>();
  return {
    rows: result.results.slice(0, limit),
    hasNext: result.results.length > limit,
  };
}

/**
 * Removes derived fragments that can no longer be served: rows written by an
 * older pipeline, and rows whose content is gone (docs/DATA_MODEL.md §4).
 */
export async function collectRenderCache(
  db: D1Database,
  pipelineVersion: string,
): Promise<number> {
  const [stale, orphaned] = await db.batch([
    db
      .prepare('DELETE FROM render_cache WHERE pipeline_version != ?')
      .bind(pipelineVersion),
    db.prepare(
      'DELETE FROM render_cache WHERE content_id NOT IN (SELECT id FROM content)',
    ),
  ]);
  return (stale?.meta.changes ?? 0) + (orphaned?.meta.changes ?? 0);
}

/** Row of the `job` table. */
export interface JobRow {
  readonly id: string;
  readonly type: string;
  readonly payload: string;
  readonly run_at: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly last_error: string | null;
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  readonly created_at: string;
  readonly updated_at: string;
}

/** Queues a job for the cron tick. Returns its id. */
export async function enqueueJob(
  db: D1Database,
  type: string,
  payload: unknown,
  runAt: string,
  now: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO job (id, type, payload, run_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(id, type, JSON.stringify(payload), runAt, now, now)
    .run();
  return id;
}

/** Due jobs of one type, oldest first, bounded. */
export async function dueJobs(
  db: D1Database,
  type: string,
  now: string,
  limit: number,
): Promise<JobRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM job
       WHERE type = ? AND status = 'pending' AND run_at <= ?
       ORDER BY run_at LIMIT ?`,
    )
    .bind(type, now, limit)
    .all<JobRow>();
  return rows.results;
}

/** Marks a job done. */
export async function completeJob(
  db: D1Database,
  id: string,
  now: string,
): Promise<void> {
  await db
    .prepare("UPDATE job SET status = 'done', updated_at = ? WHERE id = ?")
    .bind(now, id)
    .run();
}

/**
 * Records a failed attempt: exponential backoff while attempts remain,
 * `failed` once they run out (docs/DATA_MODEL.md §2.9).
 */
export async function failJob(
  db: D1Database,
  job: JobRow,
  error: string,
  now: Date,
): Promise<void> {
  const attempts = job.attempts + 1;
  if (attempts >= job.max_attempts) {
    await db
      .prepare(
        "UPDATE job SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?",
      )
      .bind(attempts, error.slice(0, 500), now.toISOString(), job.id)
      .run();
    return;
  }
  const delayMs = 60_000 * 2 ** attempts;
  const runAt = new Date(now.getTime() + delayMs).toISOString();
  await db
    .prepare(
      `UPDATE job SET status = 'pending', attempts = ?, last_error = ?, run_at = ?,
         updated_at = ? WHERE id = ?`,
    )
    .bind(attempts, error.slice(0, 500), runAt, now.toISOString(), job.id)
    .run();
}

/** Enables or disables a registered plugin. Instant effect. */
export async function setPluginEnabled(
  db: D1Database,
  pluginId: string,
  enabled: boolean,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE plugin_state SET enabled = ?, updated_at = ? WHERE plugin_id = ?',
    )
    .bind(enabled ? 1 : 0, now, pluginId)
    .run();
  return result.meta.changes === 1;
}

/** Full plugin state rows, enabled or not, for the admin. */
export async function listPluginState(
  db: D1Database,
): Promise<PluginStateRow[]> {
  const rows = await db
    .prepare('SELECT * FROM plugin_state')
    .all<PluginStateRow>();
  return rows.results;
}

/** One plugin's state row. */
export async function findPluginState(
  db: D1Database,
  pluginId: string,
): Promise<PluginStateRow | null> {
  return db
    .prepare('SELECT * FROM plugin_state WHERE plugin_id = ?')
    .bind(pluginId)
    .first<PluginStateRow>();
}

/** Writes a plugin's settings JSON. */
export async function setPluginSettings(
  db: D1Database,
  pluginId: string,
  settingsJson: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE plugin_state SET settings = ?, updated_at = ? WHERE plugin_id = ?',
    )
    .bind(settingsJson, now, pluginId)
    .run();
}

/** Writes a plugin's encrypted secrets JSON. */
export async function setPluginSecrets(
  db: D1Database,
  pluginId: string,
  secretsJson: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE plugin_state SET secrets = ?, updated_at = ? WHERE plugin_id = ?',
    )
    .bind(secretsJson, now, pluginId)
    .run();
}

/** Registers a compiled-in plugin's state row on first boot. */
export async function ensurePluginRow(
  db: D1Database,
  pluginId: string,
  version: string,
  defaultSettingsJson: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO plugin_state (plugin_id, enabled, version, settings, updated_at)
       VALUES (?, 0, ?, ?, ?)
       ON CONFLICT (plugin_id) DO UPDATE SET version = excluded.version`,
    )
    .bind(pluginId, version, defaultSettingsJson, now)
    .run();
}

/** Drops finished jobs older than the retention window. */
export async function cleanupJobs(
  db: D1Database,
  before: string,
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM job WHERE status = 'done' AND updated_at < ?")
    .bind(before)
    .run();
  return result.meta.changes;
}

/**
 * One published item of a kind by slug, as a summary. Used to resolve a
 * theme's `reference` field (docs/THEME_FORMAT.md §7.5) to its target.
 */
export function summaryBySlug(
  db: D1Database,
  kind: string,
  locale: string,
  slug: string,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM content
       WHERE kind = ? AND locale = ? AND slug = ?
         AND status = 'published' AND published_at <= ?`,
    )
    .bind(kind, locale, slug, now);
}

/**
 * Published items of `kind` whose front-matter `field` holds `slug` — the
 * reverse of a `reference` field, e.g. the products in a category.
 *
 * `field` is a template identifier from the theme manifest, never request
 * data, and the schema restricts it to `[a-z_][a-z0-9_]*`; the value is
 * bound. Row reads are bounded by the kind-and-locale index prefix
 * (docs/DATA_MODEL.md §3).
 */
export function listByReference(
  db: D1Database,
  kind: string,
  locale: string,
  field: string,
  slug: string,
  limit: number,
  now: string,
): D1PreparedStatement {
  // The manifest schema already restricts field names, but this is the one
  // place an identifier reaches SQL as text, so it re-checks rather than
  // trusting a caller.
  if (!/^[a-z][a-z0-9_]*$/.test(field)) {
    throw new Error(`Refusing to query by unsafe field name "${field}".`);
  }
  return db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM content
       WHERE kind = ? AND locale = ? AND status = 'published' AND published_at <= ?
         AND json_extract(frontmatter, '$.${field}') = ?
       ORDER BY published_at DESC, id
       LIMIT ?`,
    )
    .bind(kind, locale, now, slug, limit);
}

/** Recent published items of the same kind, excluding one id. */
export function listSiblings(
  db: D1Database,
  kind: string,
  locale: string,
  excludeId: string,
  limit: number,
  now: string,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM content
       WHERE kind = ? AND locale = ? AND status = 'published' AND published_at <= ?
         AND id <> ?
       ORDER BY published_at DESC, id
       LIMIT ?`,
    )
    .bind(kind, locale, now, excludeId, limit);
}

/** Every content row of a translation group, for export. */
export async function listAllForExport(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<ContentRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM content
       ORDER BY kind, translation_group, locale
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<ContentRow>();
  return rows.results;
}

/** Every redirect, for export. */
export async function listRedirects(
  db: D1Database,
): Promise<{ from_path: string; to_path: string; status: number }[]> {
  const rows = await db
    .prepare(
      'SELECT from_path, to_path, status FROM redirect ORDER BY from_path',
    )
    .all<{ from_path: string; to_path: string; status: number }>();
  return rows.results;
}

/** Media not referenced by any content, for the export's `media/` folder. */
export async function listUnreferencedMedia(
  db: D1Database,
): Promise<{ sha256: string; ext: string; original_name: string }[]> {
  const rows = await db
    .prepare(
      `SELECT sha256, ext, original_name FROM media
       WHERE ref_count = 0 ORDER BY created_at`,
    )
    .all<{ sha256: string; ext: string; original_name: string }>();
  return rows.results;
}

/**
 * Empties the fragment cache.
 *
 * `render_cache` is derived data: every row can be regenerated from the
 * Markdown that produced it (docs/DATA_MODEL.md §4), which is what makes
 * clearing the whole table a safe operation rather than data loss. Pages
 * simply cost a stage-one render the next time they are requested.
 */
export async function clearRenderCache(db: D1Database): Promise<number> {
  const result = await db.prepare('DELETE FROM render_cache').run();
  return result.meta.changes;
}

/**
 * Published content carrying a tag, newest first.
 *
 * `tags` is a JSON array in front matter, so `json_each` expands it and the
 * match happens on the expanded rows. Scanning is bounded by the locale's
 * published rows (docs/DATA_MODEL.md §3); like the reverse-reference query it
 * would want an expression index on a very large site.
 */
export async function listByTag(
  db: D1Database,
  locale: string,
  tag: string,
  limit: number,
  offset: number,
  now: string,
): Promise<{ items: ContentSummaryRow[]; hasNext: boolean }> {
  const rows = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS.split(', ')
        .map((column) => `c.${column}`)
        .join(', ')}
       FROM content c
       WHERE c.locale = ? AND c.status = 'published' AND c.published_at <= ?
         AND EXISTS (
           SELECT 1 FROM json_each(c.frontmatter, '$.tags')
           WHERE json_each.value = ?
         )
       ORDER BY c.published_at DESC, c.id
       LIMIT ? OFFSET ?`,
    )
    .bind(locale, now, tag, limit + 1, offset)
    .all<ContentSummaryRow>();
  const items = rows.results.slice(0, limit);
  return { items, hasNext: rows.results.length > limit };
}

/** Every tag in use in one locale, with how many items carry it. */
export async function listTags(
  db: D1Database,
  locale: string,
  now: string,
): Promise<{ tag: string; count: number }[]> {
  const rows = await db
    .prepare(
      `SELECT json_each.value AS tag, COUNT(*) AS count
       FROM content c, json_each(c.frontmatter, '$.tags')
       WHERE c.locale = ? AND c.status = 'published' AND c.published_at <= ?
       GROUP BY json_each.value
       ORDER BY count DESC, tag
       LIMIT 200`,
    )
    .bind(locale, now)
    .all<{ tag: string; count: number }>();
  return rows.results;
}
