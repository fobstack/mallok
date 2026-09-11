/**
 * D1 access for administrators, sessions and API tokens.
 *
 * Neither a session cookie nor an API token is ever stored in plaintext: the
 * primary key of both tables is the SHA-256 of the secret the client holds
 * (docs/DATA_MODEL.md §2.8).
 */

/** Row of the `admin_user` table. */
export interface AdminUserRow {
  readonly id: string;
  readonly email: string;
  /** Base64 of the PBKDF2 output. */
  readonly password_hash: string;
  /** JSON `{ iterations, salt }`. */
  readonly password_params: string;
  readonly created_at: string;
}

/** Row of the `session` table. */
export interface SessionRow {
  /** `sha256(cookie token)`. */
  readonly id: string;
  readonly user_id: string;
  readonly csrf: string;
  readonly expires_at: string;
  readonly created_at: string;
}

/** Row of the `api_token` table. */
export interface ApiTokenRow {
  /** `sha256(token)`. */
  readonly id: string;
  readonly name: string;
  /** JSON array of scope strings. */
  readonly scopes: string;
  readonly last_used_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
}

/** Number of administrators. Zero means the setup wizard may still run. */
export async function countAdminUsers(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM admin_user')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Input for {@link createAdminUser}. */
export interface NewAdminUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly passwordParams: string;
  readonly now: string;
}

/** Creates an administrator. Fails if the email already exists. */
export async function createAdminUser(
  db: D1Database,
  user: NewAdminUser,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_user (id, email, password_hash, password_params, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(user.id, user.email, user.passwordHash, user.passwordParams, user.now)
    .run();
}

/**
 * Claims the site: the first administrator and the spent setup key, at once.
 *
 * One D1 batch, which runs as a single implicit transaction. `setup_claim`
 * holds at most one row (`CHECK (id = 1)`), so a second concurrent caller
 * fails on the primary key and **its whole batch is rolled back** — no
 * administrator, no consumed key, nothing half-done.
 *
 * Returns false when the claim was lost, which is a 409 and not an error:
 * somebody else owns this site now.
 */
export async function claimSite(
  db: D1Database,
  user: NewAdminUser,
  keyUsed: boolean,
): Promise<boolean> {
  const statements = [
    db
      .prepare(
        'INSERT INTO setup_claim (id, admin_user_id, claimed_at) VALUES (1, ?, ?)',
      )
      .bind(user.id, user.now),
    db
      .prepare(
        `INSERT INTO admin_user (id, email, password_hash, password_params, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        user.email,
        user.passwordHash,
        user.passwordParams,
        user.now,
      ),
  ];
  if (keyUsed) {
    statements.push(
      db
        .prepare(
          'UPDATE site SET setup_key_used_at = ?, updated_at = ? WHERE setup_key_used_at IS NULL',
        )
        .bind(user.now, user.now),
    );
  }
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    // A primary-key conflict means somebody else claimed it first. Anything
    // else is a real failure and is not swallowed.
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(error))) {
      return false;
    }
    throw error;
  }
}

/** Looks up an administrator by email. */
export async function findAdminUserByEmail(
  db: D1Database,
  email: string,
): Promise<AdminUserRow | null> {
  return db
    .prepare('SELECT * FROM admin_user WHERE email = ?')
    .bind(email)
    .first<AdminUserRow>();
}

/** Looks up an administrator by id. */
export async function findAdminUserById(
  db: D1Database,
  id: string,
): Promise<AdminUserRow | null> {
  return db
    .prepare('SELECT * FROM admin_user WHERE id = ?')
    .bind(id)
    .first<AdminUserRow>();
}

/** Replaces a stored password hash, for changes and parameter upgrades. */
export async function updateAdminPassword(
  db: D1Database,
  id: string,
  passwordHash: string,
  passwordParams: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE admin_user SET password_hash = ?, password_params = ? WHERE id = ?',
    )
    .bind(passwordHash, passwordParams, id)
    .run();
}

/** Input for {@link createSession}. */
export interface NewSession {
  readonly id: string;
  readonly userId: string;
  readonly csrf: string;
  readonly expiresAt: string;
  readonly now: string;
}

/** Stores a session. */
export async function createSession(
  db: D1Database,
  session: NewSession,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO session (id, user_id, csrf, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      session.id,
      session.userId,
      session.csrf,
      session.expiresAt,
      session.now,
    )
    .run();
}

/** Loads a session that has not expired yet. */
export async function findLiveSession(
  db: D1Database,
  id: string,
  now: string,
): Promise<SessionRow | null> {
  return db
    .prepare('SELECT * FROM session WHERE id = ? AND expires_at > ?')
    .bind(id, now)
    .first<SessionRow>();
}

/** Deletes one session (logout). */
export async function deleteSession(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM session WHERE id = ?').bind(id).run();
}

/** Deletes every session of one user, e.g. after a password change. */
export async function deleteSessionsOfUser(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db.prepare('DELETE FROM session WHERE user_id = ?').bind(userId).run();
}

/** Removes expired sessions. Called from the cron tick. */
export async function deleteExpiredSessions(
  db: D1Database,
  now: string,
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM session WHERE expires_at <= ?')
    .bind(now)
    .run();
  return result.meta.changes;
}

/** Input for {@link createApiToken}. */
export interface NewApiToken {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly now: string;
}

/** Stores an API token. */
export async function createApiToken(
  db: D1Database,
  token: NewApiToken,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO api_token (id, name, scopes, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(token.id, token.name, JSON.stringify(token.scopes), token.now)
    .run();
}

/** Loads a token that has not been revoked. */
export async function findLiveApiToken(
  db: D1Database,
  id: string,
): Promise<ApiTokenRow | null> {
  return db
    .prepare('SELECT * FROM api_token WHERE id = ? AND revoked_at IS NULL')
    .bind(id)
    .first<ApiTokenRow>();
}

/** Lists tokens for the admin UI, newest first. Never returns secrets. */
export async function listApiTokens(db: D1Database): Promise<ApiTokenRow[]> {
  const rows = await db
    .prepare('SELECT * FROM api_token ORDER BY created_at DESC')
    .all<ApiTokenRow>();
  return rows.results;
}

/** Marks a token revoked. Returns false when it did not exist or was gone. */
export async function revokeApiToken(
  db: D1Database,
  id: string,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE api_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    )
    .bind(now, id)
    .run();
  return result.meta.changes === 1;
}

/** Records that a token was used. Best-effort; callers do not await failures. */
export async function touchApiToken(
  db: D1Database,
  id: string,
  now: string,
): Promise<void> {
  await db
    .prepare('UPDATE api_token SET last_used_at = ? WHERE id = ?')
    .bind(now, id)
    .run();
}
