# Mallok 0.1 data model (draft)

- Status: 0.1 draft. The tables and columns are a contract; DDL details — type
  choices, index names — may be adjusted after the Task 01 spike, but this
  document is corrected before the code is.
- Date: 2026-08-28
- Conventions: every time is ISO 8601 UTC text; every JSON column is validated
  with zod at the read and write boundary; all SQL is hand-written and
  parameterised, kept in `src/db/`; no ORM.

## 1. The tables

| Table | Order of rows | Written by | Read by |
| --- | --- | --- | --- |
| `site` | 1 | The admin, the wizard | Every cold render |
| `content` | 10² – 10⁴ | The admin, the CLI, cron | Every cold render, and lists |
| `render_cache` | ≈ `content` | The save path, and a cold render filling a gap | Every cold render |
| `media` | 10² – 10⁵ | Uploads, GC | Rendering (through `assets`), the media library |
| `redirect` | 10¹ – 10³ | Slug changes, imports | On a 404 |
| `plugin_state` | Single digits | The admin | Cold renders, plugin routes |
| `admin_user`, `session`, `api_token` | Single digits / 10¹ | Authentication | The management API |
| `job` | 10¹ – 10³ | The save path, plugins | cron |
| `migration`, `migration_lock` | 10¹ / 1 | Cold start | Cold start |
| `p_<plugin>_*` | Up to the plugin | The plugin | The plugin |

## 2. DDL

### 2.1 `site`

```sql
CREATE TABLE site (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  name             TEXT NOT NULL,
  tagline          TEXT,
  default_locale   TEXT NOT NULL,                 -- 'en'
  locales          TEXT NOT NULL,                 -- JSON: ["en","de","zh"]
  kinds            TEXT NOT NULL,                 -- JSON: {"product":{"base":"products"},"article":{"base":"news"},...}
  theme_options    TEXT NOT NULL DEFAULT '{}',    -- JSON, validated against the options schema of the theme in this build
  nav              TEXT NOT NULL DEFAULT '{}',    -- JSON: {"en":[{"label":"Products","to":"/products"}],...}
  seo              TEXT NOT NULL DEFAULT '{}',    -- JSON: default title template, OG image, Organization JSON-LD fields
  domain           TEXT,                          -- the bound custom domain; NULL when none
  media_base_url   TEXT,                          -- 'https://media.example.com'; NULL falls back to the /media/ proxy
  cache_ttl        INTEGER NOT NULL DEFAULT 3600, -- seconds
  max_image_edge   INTEGER DEFAULT 2560,          -- NULL keeps true originals
  content_rev      INTEGER NOT NULL DEFAULT 0,    -- only used by the fallback in ARCHITECTURE §6.3
  setup_completed_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

### 2.2 `content`

```sql
CREATE TABLE content (
  id                TEXT PRIMARY KEY,             -- UUID v4, never changes
  kind              TEXT NOT NULL,                -- 'page' | 'article' | a kind the theme declares
  locale            TEXT NOT NULL,
  translation_group TEXT NOT NULL,                -- UUID shared by every language of one item
  slug              TEXT NOT NULL,
  path              TEXT NOT NULL,                -- the full public path, locale prefix included: '/de/products/gr5-bar'
  title             TEXT NOT NULL,
  description       TEXT,                         -- derived or from front matter; list pages use only this and never touch the body
  frontmatter       TEXT NOT NULL,                -- JSON with import aliases normalised (CONTENT_FORMAT §3.3)
  markdown          TEXT NOT NULL,                -- the complete index.md source, front-matter block included
  markdown_sha256   TEXT NOT NULL,
  assets            TEXT NOT NULL DEFAULT '{}',   -- JSON: {"images/hero.jpg":"<sha256>", "files/x.pdf":"<sha256>"}
  cover_sha256      TEXT,                         -- the cover's sha, so a list page need not parse assets
  status            TEXT NOT NULL CHECK (status IN ('draft','scheduled','published')),
  published_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  rev               INTEGER NOT NULL DEFAULT 1,
  UNIQUE (path),
  UNIQUE (translation_group, locale),
  UNIQUE (kind, locale, slug)
);
CREATE INDEX content_list  ON content (kind, locale, status, published_at DESC);
CREATE INDEX content_group ON content (translation_group);
```

Constraints and notes:

- `markdown` is checked on save against D1's 2 MB row limit, returning a clear
  error when it does not fit.
- `path` is computed from `site.kinds[kind].base`, the locale prefix and the
  slug; the `page` kind has no base. A changed `path` writes a `redirect`.
- Changing `site.default_locale` recomputes every `path` and writes the
  redirects. It is an explicit bulk operation requiring confirmation.
- `cover_sha256` is a redundant copy of `assets[frontmatter.cover]`, kept in
  sync on save so a list page reads a cover from the same row.

### 2.3 `render_cache`

```sql
CREATE TABLE render_cache (
  cache_key        TEXT PRIMARY KEY,              -- sha256(markdown_sha256 || pipeline_version || plugin_hash)
  content_id       TEXT NOT NULL,
  html             TEXT NOT NULL,                 -- the sanitised body fragment, relative paths not yet substituted
  meta             TEXT NOT NULL,                 -- JSON: {headings, excerpt, reading_time, refs:["images/hero.jpg",...]}
  pipeline_version TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX render_cache_content ON render_cache (content_id);
```

- The save path writes `content` and `render_cache` in one D1 batch.
- A cold render reads one row by `cache_key`; on a miss it generates the
  fragment and writes it back.
- A changed `pipeline_version` or plugin set stops old rows matching, and cron
  removes them by `created_at`. The admin may also empty the table outright.

### 2.4 `media`

```sql
CREATE TABLE media (
  sha256             TEXT PRIMARY KEY,            -- the sha256 of the original (or already-resized original); also the body of the R2 key
  kind               TEXT NOT NULL CHECK (kind IN ('image','file')),
  mime               TEXT NOT NULL,               -- the sniffed real type
  ext                TEXT NOT NULL,
  bytes              INTEGER NOT NULL,
  width              INTEGER,
  height             INTEGER,
  variants           TEXT NOT NULL DEFAULT '[]',  -- JSON: [480,960,1440,1920], the WebP widths generated
  original_name      TEXT NOT NULL,               -- the filename at first upload; used by the media library and by export's media/
  alt                TEXT,                        -- default alt text, overridable by the alt in the body
  ref_count          INTEGER NOT NULL DEFAULT 0,  -- how many content.assets reference it
  unreferenced_since TEXT,                        -- when ref_count reached zero; what GC works from
  created_at         TEXT NOT NULL
);
```

R2 keys: originals at `media/<sha256>.<ext>`, variants at
`media/<sha256>_<width>.webp`. Theme assets do not go into R2; see §2.5.

The reference count is updated in the same batch that saves content: the old
and new `assets` sha sets are compared, additions get `+1` and removals `-1`,
and reaching zero writes `unreferenced_since`. Cron deletes media whose
`unreferenced_since` is more than seven days old, removing the D1 row and the
R2 objects together. The admin's "unused media" list is simply
`ref_count = 0`.

### 2.5 Themes occupy no table

A theme's templates, language packs and manifest are bundled into the artifact
and its static assets go to Static Assets (`ARCHITECTURE §10`), so **there is
no theme table**. The only theme-related persisted data is
`site.theme_options` — the values the user set for the options the theme
exposes.

This is a simplification made in 0.1. An earlier draft had themes uploaded as
zips, templates stored in D1 and `site.theme_id` naming the current one.
Moving to build time removes a query from every cold render, an install
transaction from the runtime, and any need to unpack an archive in the Worker.

### 2.6 `redirect`

```sql
CREATE TABLE redirect (
  from_path  TEXT PRIMARY KEY,
  to_path    TEXT NOT NULL,
  status     INTEGER NOT NULL DEFAULT 301,
  content_id TEXT,                                -- points at the content when generated by a slug change; cleaned up with it
  created_at TEXT NOT NULL
);
```

Queried once, only when the main lookup missed and before returning a 404. A
hit returns a redirect, which is cached.

### 2.7 `plugin_state`

```sql
CREATE TABLE plugin_state (
  plugin_id  TEXT PRIMARY KEY,                    -- 'inquiry'
  enabled    INTEGER NOT NULL DEFAULT 0,
  version    TEXT NOT NULL,
  settings   TEXT NOT NULL DEFAULT '{}',          -- JSON, validated against plugin.json's settings schema
  secrets    TEXT NOT NULL DEFAULT '{}',          -- JSON: {"resend_api_key":"<base64(iv||ciphertext||tag)>"}
  updated_at TEXT NOT NULL
);
```

Each value in `secrets` is AES-GCM encrypted with a key derived from
`MALLOK_SECRET` through HKDF, with a fresh random IV on every write. The
management API returns only "set" or "not set" and never echoes a value. A
cold render reads the whole table once — its row count is the number of
plugins — to learn the enabled set and the settings hash that enters the
`render_cache` key.

### 2.8 `admin_user`, `session`, `api_token`

```sql
CREATE TABLE admin_user (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,                  -- the PBKDF2-SHA256 output, base64
  password_params TEXT NOT NULL,                  -- JSON: {iterations, salt}; the count comes from the spike
  created_at      TEXT NOT NULL
);
CREATE TABLE session (
  id         TEXT PRIMARY KEY,                    -- sha256(cookie token); the cookie itself is never stored
  user_id    TEXT NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE api_token (
  id           TEXT PRIMARY KEY,                  -- sha256(token)
  name         TEXT NOT NULL,                     -- 'ci-publisher'
  scopes       TEXT NOT NULL,                     -- JSON: ["content:write","media:write","export"]
  last_used_at TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);
```

0.1 has one administrator, but the schema makes no single-row assumption.

### 2.9 `job`

```sql
CREATE TABLE job (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,                     -- 'publish' | 'email' | 'purge' | 'gc' | 'plugin:<id>:<name>'
  payload      TEXT NOT NULL,                     -- JSON
  run_at       TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX job_due ON job (status, run_at);
```

Each minute, cron takes the first N rows with `status = 'pending' AND run_at
<= now` — N decided by the 10 ms budget, to be measured in the spike — and
runs them one at a time. A failure rewrites `run_at` with exponential backoff;
past `max_attempts` the row becomes `failed` and is shown in the admin. `done`
rows are cleaned up after seven days.

### 2.10 `migration` and `migration_lock`

```sql
CREATE TABLE migration (
  id         TEXT PRIMARY KEY,                    -- '0001_init' | 'plugin:inquiry:0001_inquiry'
  applied_at TEXT NOT NULL
);
CREATE TABLE migration_lock (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  locked_by TEXT,
  locked_at TEXT
);
```

The cold-start flow: read `migration` for the applied set; if anything is
missing, run
`UPDATE migration_lock SET locked_by = ?, locked_at = ? WHERE locked_by IS NULL OR locked_at < now - 60s`.
Whoever affects one row holds the lock; the others wait and re-read.
Migrations may only be **additive** — new tables, new columns with defaults,
new indexes — and may not drop a column or change its meaning within one
version, so the old Worker version keeps serving throughout.

### 2.11 A plugin table, by example: `p_inquiry_inquiry`

```sql
CREATE TABLE p_inquiry_inquiry (
  id               TEXT PRIMARY KEY,
  content_id       TEXT,                          -- the source product or page; NULL from a contact page
  locale           TEXT NOT NULL,
  source_path      TEXT NOT NULL,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  company          TEXT,
  phone            TEXT,                          -- phone or WhatsApp
  country          TEXT,                          -- request.cf.country
  message          TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('new','replied','spam')),
  notify_job_id    TEXT,                          -- the job notifying the owner
  autoreply_job_id TEXT,                          -- the job acknowledging the buyer
  user_agent       TEXT,
  ip_hash          TEXT,                          -- sha256(ip || MALLOK_SECRET); only for deduplication and rate limiting
  created_at       TEXT NOT NULL
);
CREATE INDEX p_inquiry_inquiry_list ON p_inquiry_inquiry (status, created_at DESC);
```

A plugin's tables must be prefixed `p_<plugin_id>_` and its migration ids
`plugin:<plugin_id>:`, all executed by the core's migrator.

## 3. The read and write budget

D1's free tier bills rows read and written, and exceeding it makes the
database unavailable for the day, so every class of request must read a
bounded number of rows:

| Request | Queries | Row-read ceiling |
| --- | --- | --- |
| A single-page cold render | `site`, `content` by path, `render_cache` by key, all of `plugin_state` | ≈ 1 + 1 + 1 + the number of plugins |
| Related content (any content page) | one row per `reference` field, `LIMIT 24` per back-reference, `LIMIT 6` for siblings; one batch, at most 8 + 1 statements | Bounded; a product page is 1 + 6 in practice |
| Resolving covers | `media` by `sha256 IN (…)`, one query | ≤ the number of items on the page |
| A list page | `content` through the `content_list` index, `LIMIT n+1` | n+1 (21 by default) |
| A home page | Several bounded lists declared by the theme, each `LIMIT ≤ 12` | ≤ 50 |
| A sitemap | Published `content` rows, paginated `LIMIT 5000` | Bounded, cached for a long time |
| A 404 | One `redirect` row | 1 |
| Saving content | Read the old row (1), write `content` (1), write `render_cache` (1), update `media.ref_count` (≤ the reference count), write `job` (≤ 3) | A small constant |
| One cron pass | N `job` rows plus each one's work | N × a small constant |

Back-references (`json_extract(frontmatter, '$.<field>') = ?`) use the
`kind + locale + status` prefix of the `content_list` index, so **the scan
covers the published items of that kind in that language**, not the whole
table, and the returned rows are bounded by `LIMIT`. For a trade catalogue of
tens to hundreds of items that is acceptable, and it only happens on a cold
render. **If one kind on a site ever exceeded roughly two thousand items, this
would need an expression index on that field** — which 0.1 does not build,
because the index would have to be generated from a field name the theme
declares, making it a runtime index creation, which contradicts themes being a
build-time concern.

Two hard rules: **pagination never does `COUNT(*)`** — `LIMIT n+1` decides
whether there is a next page, so row reads do not grow with the amount of
content; and **list and home pages read only `content`'s scalar columns and
`cover_sha256`, never `markdown`, and never touch `render_cache`.**

## 4. Garbage collection

| Object | Condition | Who |
| --- | --- | --- |
| `media` and its R2 objects | `ref_count = 0` and `unreferenced_since` older than seven days | cron |
| `render_cache` | `pipeline_version` is not current, or `content_id` no longer exists | cron; the admin may also empty the table |
| `session` | Past `expires_at` | cron |
| `job` | `done` for more than seven days | cron |
| `redirect` | Its `content_id` was deleted more than ninety days ago | cron |

## 5. To confirm in the spike

- Whether D1 enables foreign-key constraints by default. The `REFERENCES`
  above depends on it; if not, the relationship is maintained in the
  application.
- The measured N — how many `job` rows one pass can handle within 10 ms.
- The typical size of `render_cache.html` against D1's row limit and read
  bandwidth.
