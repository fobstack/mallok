-- The administrator's interface language (docs/ADMIN_I18N_AND_UI.md, D2).
--
-- A BCP 47 tag such as `zh-CN`, or NULL for "not chosen": the admin then
-- keeps whatever the browser chose. It is the language the admin speaks to
-- this person, not a content language; nothing on the public site reads it.
ALTER TABLE admin_user ADD COLUMN ui_locale TEXT;
