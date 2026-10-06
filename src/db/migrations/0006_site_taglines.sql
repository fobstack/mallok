-- A tagline per language (docs/DATA_MODEL.md §2.2).
--
-- `tagline` stays what it was: the site's tagline, in its default language,
-- and the one used wherever a language has none of its own. `taglines` holds
-- the others, a JSON map of locale to text, the way `nav` is keyed. A site
-- that never sets one keeps `{}` and behaves exactly as before.
ALTER TABLE site ADD COLUMN taglines TEXT NOT NULL DEFAULT '{}';
