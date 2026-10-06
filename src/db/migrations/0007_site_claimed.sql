-- When the site was claimed by its first administrator
-- (docs/ARCHITECTURE.md §6).
--
-- Until someone has claimed a site, what it serves is the placeholder a fresh
-- deployment starts with, and storing that in the edge cache means the owner
-- sets the site up and keeps seeing the placeholder. The render path decides
-- that from the site row it already reads, so the fact has to be on that row:
-- `setup_claim` and `admin_user` are not read when a page is rendered.
--
-- Existing sites are marked from what they already record: the claim, or for
-- a site claimed before `setup_claim` existed, its first administrator.
ALTER TABLE site ADD COLUMN claimed_at TEXT;
UPDATE site SET claimed_at = COALESCE(
  (SELECT claimed_at FROM setup_claim WHERE id = 1),
  (SELECT MIN(created_at) FROM admin_user)
);
