/**
 * Runtime schema migrations.
 *
 * The Worker applies pending migrations itself on cold start, so none of the
 * three deployment paths (CLI, deploy button, hosted assistant) depends on CI
 * running `wrangler d1 migrations`. A lock row in `migration_lock` keeps
 * concurrent cold starts from applying the same migration twice.
 * See docs/ARCHITECTURE.md §15 and docs/DATA_MODEL.md §2.10.
 */

import initSql from './migrations/0001_init.sql';

/** One migration: a stable id and the SQL text to apply. */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

/** Core migrations in apply order. Plugin migrations are appended at runtime. */
export const CORE_MIGRATIONS: readonly Migration[] = [
  { id: '0001_init', sql: initSql },
];

const LOCK_TTL_MS = 60_000;
const LOCK_POLL_MS = 100;
const LOCK_POLL_ATTEMPTS = 100;

const BOOTSTRAP_SQL = [
  `CREATE TABLE IF NOT EXISTS migration (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS migration_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    locked_by TEXT,
    locked_at TEXT
  )`,
  'INSERT OR IGNORE INTO migration_lock (id, locked_by, locked_at) VALUES (1, NULL, NULL)',
];

/**
 * Splits a migration file into individual statements. Comments are dropped;
 * statements may span lines.
 */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

/**
 * Applies every migration in `migrations` that is not yet recorded.
 * Safe to call from concurrent isolates; returns the ids that this call
 * applied.
 */
export async function ensureMigrated(
  db: D1Database,
  migrations: readonly Migration[],
  now: () => Date = () => new Date(),
): Promise<string[]> {
  await db.batch(BOOTSTRAP_SQL.map((statement) => db.prepare(statement)));

  let pending = await pendingMigrations(db, migrations);
  if (pending.length === 0) {
    return [];
  }

  const owner = crypto.randomUUID();
  const acquired = await acquireLock(db, owner, now);
  if (!acquired) {
    // Another isolate is migrating; wait for it and re-check.
    await waitForUnlock(db);
    pending = await pendingMigrations(db, migrations);
    if (pending.length !== 0) {
      throw new Error('Schema migration is still pending after waiting.');
    }
    return [];
  }

  const applied: string[] = [];
  try {
    // Re-read under the lock so we never re-apply a migration another isolate
    // finished between our first check and acquiring the lock.
    pending = await pendingMigrations(db, migrations);
    for (const migration of pending) {
      const statements = splitStatements(migration.sql).map((statement) =>
        db.prepare(statement),
      );
      statements.push(
        db
          .prepare('INSERT INTO migration (id, applied_at) VALUES (?, ?)')
          .bind(migration.id, now().toISOString()),
      );
      await db.batch(statements);
      applied.push(migration.id);
    }
  } finally {
    await db
      .prepare(
        'UPDATE migration_lock SET locked_by = NULL, locked_at = NULL WHERE id = 1 AND locked_by = ?',
      )
      .bind(owner)
      .run();
  }
  return applied;
}

async function pendingMigrations(
  db: D1Database,
  migrations: readonly Migration[],
): Promise<Migration[]> {
  const rows = await db
    .prepare('SELECT id FROM migration')
    .all<{ id: string }>();
  const applied = new Set(rows.results.map((row) => row.id));
  return migrations.filter((migration) => !applied.has(migration.id));
}

async function acquireLock(
  db: D1Database,
  owner: string,
  now: () => Date,
): Promise<boolean> {
  const current = now();
  const stale = new Date(current.getTime() - LOCK_TTL_MS).toISOString();
  const result = await db
    .prepare(
      `UPDATE migration_lock
       SET locked_by = ?, locked_at = ?
       WHERE id = 1 AND (locked_by IS NULL OR locked_at < ?)`,
    )
    .bind(owner, current.toISOString(), stale)
    .run();
  return result.meta.changes === 1;
}

async function waitForUnlock(db: D1Database): Promise<void> {
  for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt++) {
    const row = await db
      .prepare('SELECT locked_by FROM migration_lock WHERE id = 1')
      .first<{ locked_by: string | null }>();
    if (row === null || row.locked_by === null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  throw new Error('Timed out waiting for the schema migration lock.');
}
