-- Site-level email settings (docs/PLUGIN_API.md §7.6).
--
-- The Resend key and the sender address used to be settings of the inquiry
-- plugin, so every further plugin that sends email needed its own copy of the
-- same key. They belong to the site: one key, one verified sender, shared by
-- every plugin through `ctx.sendEmail`.
--
-- `email_resend_key` holds the key encrypted with `MALLOK_SECRET`, in the same
-- form as a plugin secret (docs/SECURITY.md §2.2). It is never returned by any
-- endpoint and never leaves the Worker except in the request to Resend.
ALTER TABLE site ADD COLUMN email_from TEXT;
ALTER TABLE site ADD COLUMN email_resend_key TEXT;
