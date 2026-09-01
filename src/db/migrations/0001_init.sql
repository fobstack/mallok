-- Mallok 0.1 initial schema. See docs/DATA_MODEL.md.
--
-- There are no theme tables: themes are compiled into the build, not
-- installed at runtime (docs/DATA_MODEL.md §2.5).
-- Statements are separated by semicolons and applied in one D1 batch by the
-- runtime migrator (src/db/migrate.ts). Keep every statement idempotent.

CREATE TABLE IF NOT EXISTS site (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  name               TEXT NOT NULL,
  tagline            TEXT,
  default_locale     TEXT NOT NULL,
  locales            TEXT NOT NULL,
  kinds              TEXT NOT NULL,
  theme_options      TEXT NOT NULL DEFAULT '{}',
  nav                TEXT NOT NULL DEFAULT '{}',
  seo                TEXT NOT NULL DEFAULT '{}',
  domain             TEXT,
  media_base_url     TEXT,
  cache_ttl          INTEGER NOT NULL DEFAULT 3600,
  max_image_edge     INTEGER DEFAULT 2560,
  content_rev        INTEGER NOT NULL DEFAULT 0,
  setup_completed_at TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  locale            TEXT NOT NULL,
  translation_group TEXT NOT NULL,
  slug              TEXT NOT NULL,
  path              TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  frontmatter       TEXT NOT NULL,
  markdown          TEXT NOT NULL,
  markdown_sha256   TEXT NOT NULL,
  assets            TEXT NOT NULL DEFAULT '{}',
  cover_sha256      TEXT,
  status            TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published')),
  published_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  rev               INTEGER NOT NULL DEFAULT 1,
  UNIQUE (path),
  UNIQUE (translation_group, locale),
  UNIQUE (kind, locale, slug)
);

CREATE INDEX IF NOT EXISTS content_list ON content (kind, locale, status, published_at DESC);

CREATE INDEX IF NOT EXISTS content_group ON content (translation_group);

CREATE TABLE IF NOT EXISTS render_cache (
  cache_key        TEXT PRIMARY KEY,
  content_id       TEXT NOT NULL,
  html             TEXT NOT NULL,
  meta             TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS render_cache_content ON render_cache (content_id);

CREATE TABLE IF NOT EXISTS media (
  sha256             TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('image', 'file')),
  mime               TEXT NOT NULL,
  ext                TEXT NOT NULL,
  bytes              INTEGER NOT NULL,
  width              INTEGER,
  height             INTEGER,
  variants           TEXT NOT NULL DEFAULT '[]',
  original_name      TEXT NOT NULL,
  alt                TEXT,
  ref_count          INTEGER NOT NULL DEFAULT 0,
  unreferenced_since TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redirect (
  from_path  TEXT PRIMARY KEY,
  to_path    TEXT NOT NULL,
  status     INTEGER NOT NULL DEFAULT 301,
  content_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_state (
  plugin_id  TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 0,
  version    TEXT NOT NULL,
  settings   TEXT NOT NULL DEFAULT '{}',
  secrets    TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_user (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  password_params TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES admin_user (id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_token (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  scopes       TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  run_at       TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS job_due ON job (status, run_at);
