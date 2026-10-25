-- The last cache purge Cloudflare did not carry out (docs/DATA_MODEL.md §2.2).
--
-- Most purges run in the background, after a save, a plugin switch or a
-- webhook, when no operator is watching. A purge that fails leaves the pages
-- it named stale for a whole cache lifetime, so the admin has to be able to
-- say that it happened: when, from where and what Cloudflare answered, as a
-- JSON object. NULL when nothing has failed since the last purge of the
-- whole site succeeded.
ALTER TABLE site ADD COLUMN last_purge_failure TEXT;
