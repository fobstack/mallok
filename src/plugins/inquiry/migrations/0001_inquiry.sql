-- Inquiry plugin: the inquiry table (docs/DATA_MODEL.md §2.11).

CREATE TABLE IF NOT EXISTS p_inquiry_inquiry (
  id               TEXT PRIMARY KEY,
  content_id       TEXT,
  locale           TEXT NOT NULL,
  source_path      TEXT NOT NULL,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  company          TEXT,
  phone            TEXT,
  country          TEXT,
  message          TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('new','replied','spam')),
  notify_job_id    TEXT,
  autoreply_job_id TEXT,
  user_agent       TEXT,
  ip_hash          TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS p_inquiry_inquiry_list
  ON p_inquiry_inquiry (status, created_at DESC);
