-- Whether the default locale is prefixed too (docs/ARCHITECTURE.md §9).
--
-- 0, the default, keeps every existing site as it was: the default locale at
-- the root, other locales under `/<locale>`. 1 puts every locale under its
-- prefix and makes the root a redirect to the default locale's home. It is
-- changed only through POST /_mallok/api/settings/locale-prefix, which moves
-- every stored path and records a redirect from each old one.
ALTER TABLE site ADD COLUMN prefix_default_locale INTEGER NOT NULL DEFAULT 0;
