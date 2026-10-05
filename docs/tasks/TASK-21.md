# Task 21 — Site-level email settings

- Status: **done**.
- Date: 2026-10-05
- Scope: the Resend key and the sender address become settings of the site,
  used by every plugin through `ctx.sendEmail`; an existing site's key and
  sender move there from the `inquiry` plugin on upgrade.
- Source: the owner's task list of 2026-10-01, item M1 part 3
  (`docs/IMPLEMENTATION_PLAN.md`, phase six), with the owner's decisions of
  2026-10-01 (site-level; move on upgrade) and 2026-10-03 (the `inquiry`
  plugin drops its key field and keeps an optional sender).

## 1. Demonstrable loop

An operator opens **Settings → Email**, saves a sender and a Resend key, and
presses **Test**; the page reports what Resend says about the key and never
shows the key again. A buyer submits the inquiry form; the notification is
sent with the site key and the site sender, although the plugin holds neither.

A site set up on an earlier release is deployed with this one. On its first
request the key and sender it kept inside the `inquiry` plugin are in
Settings → Email, the plugin copies are gone, and inquiries keep arriving.

## 2. What changed

| File | Change |
| --- | --- |
| `src/db/migrations/0004_site_email.sql` | Adds `site.email_from` and `site.email_resend_key` |
| `src/db/migrate.ts` | `DataMigration`: a core migration whose statements are computed under the lock and applied in one batch with its own record |
| `src/worker/site-email.ts` | New. The settings endpoints, the key check, decrypting the site key, and the one-time move `0005_move_inquiry_email` |
| `src/worker/email.ts` | Key and sender are resolved per attempt: the plugin's own first, the site's otherwise; a missing sender fails the job with its own message |
| `src/worker/bootstrap.ts` | Runs the move after the core migrations |
| `src/worker/admin.ts`, `admin-settings.ts` | `PUT /settings/email`, `POST /settings/email/check`; `GET /settings` reports `email: { fromAddress, resendConfigured }` |
| `src/plugins/inquiry/` | `resend_api_key` secret and its check removed; `from_address` optional; version 0.2.0 |
| `src/admin/pages/settings-email.tsx`, `app.tsx`, `types.ts`, `settings-advanced.tsx` | The Email page, its tab, and a diagnostics row |
| `test/worker/site-email.test.ts` | New: the endpoints, sending, the move, a whole-database upgrade |
| `test/e2e/08-email-settings.spec.ts` | New: the page against the real Worker; the page joins the accessibility scan |
| `test/worker/inquiry.test.ts`, `plugins.test.ts`, `secret-check.test.ts`, `flow.test.ts` | Follow the key to its new place |
| `docs/` | `PLUGIN_API §4, §7.3, §7.6, §13.2`, `SECURITY §2.2`, `DATA_MODEL §2.1, §2.7`, `ADMIN §4.2`, `GETTING_STARTED` (both languages), `TECH_STACK`, `RELEASE_GATE §2, §13`, the plan |

## 3. Decisions and deviations

- **The site key is encrypted under the owner `@site`.** The format is the
  plugin-secret format unchanged (`SECURITY.md §2.2`). A plugin id must start
  with a letter, so no plugin id can equal `@site` and no plugin can derive
  the site's key. A plugin never sees the site key in `ctx.secrets`.
- **Two columns on `site`, not a table.** There is one site and two values.
  Nothing is added to the render path: a send attempt reads the site row
  once, and only when the plugin leaves the key or the sender out.
- **The move is a migration, not a boot step.** It needs `MALLOK_SECRET`, so
  it cannot be SQL; `DataMigration` lets it run under the same lock and be
  recorded in the same batch as its writes. A crash before the batch leaves
  everything as it was and the next cold start tries again; a crash after it
  cannot repeat the move.
- **An undecryptable key is left in the plugin and the move is still recorded
  as run.** Retrying on every cold start would take the migration lock on
  every cold start, for a key that only becomes readable if `MALLOK_SECRET` is
  restored — in which case the plugin's own copy works again by itself,
  because a plugin-stored key still wins.
- **When the site already has a key or sender, the plugin's copy is left
  alone** rather than deleted. The owner's rule is "never overwrite"; deleting
  the plugin's value without having moved it would change which key sends.
  This cannot occur on a real upgrade — the columns are created by the
  migration just before — and is covered so that it stays harmless.
- **A plugin key that cannot be decrypted falls back to the site key**
  instead of failing the job. The old behaviour was a failed job; with a site
  key present there is something better to do.
- **The plan's sentence "the plugin's own key field says the site setting is
  in use" was replaced by the owner's later decision** to remove the field.
  The plugin's remaining sender field carries that sentence in its label.
- The `inquiry` plugin's version goes to 0.2.0: its settings and secrets
  changed, and the version is what the admin shows.

## 4. Verification

- Red-green, each with the fix reverted and restored:
  - `src/worker/email.ts` at its previous content: "sends a plugin email with
    the site key and sender", "falls back to the site key…" and "…no sender is
    configured" fail.
  - the move returning no statements: "moves the key and the sender, and
    removes the plugin copies" fails.
  - the move ordered before the core migrations: boot fails and every test in
    the file fails.
- "upgrades a database left by the previous release on the next request"
  drops both columns and both migration records, puts the key and sender
  inside the plugin, resets the boot, and then checks the settings response,
  the plugin row and a real send through the stubbed Resend.
- `pnpm test:e2e`: the Email page saved a sender and a key against the real
  Worker, the response and the reloaded page did not contain the key, and the
  page passed the accessibility scan.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Notes for the next release

To carry into the changelog and upgrade notes:

- The Resend key and sender move from Plugins → Inquiry to Settings → Email on
  the first request after deploying. Nothing needs re-entering.
- **A script that wrote the key with
  `PUT /_mallok/api/plugins/inquiry/secrets {"resend_api_key": …}` now gets
  400 "Unknown secret".** Use `PUT /_mallok/api/settings/email
  {"resendApiKey": …, "fromAddress": …}`.
- `POST /_mallok/api/plugins/inquiry/secrets/resend_api_key` answers 404; the
  check is `POST /_mallok/api/settings/email/check`.
- The `inquiry` setting `from_address` is optional.
- Rolling back to an earlier release after the move leaves the `inquiry`
  plugin without its key: the earlier code does not read the site setting.
  Re-enter the key in the plugin after a rollback.

## 6. Not done / known limits

- **No email was sent through the real Resend.** Every test stubs
  `api.resend.com`; `AC-PLUGIN-02b`/`03b` stay `NOT_RUN`.
- **The move has not run on a deployed site.** It is exercised in workerd
  through the real migrator; the test site's key, if it has one, is the first
  real case.
- **The email settings are not part of a site export**, like plugin settings.
  A site restored into a new deployment has its sender and key entered again.
- The setup wizard still does not ask for email (`ADMIN.md §5`, unchanged).
- The Email page's **Test** button is not pressed in the browser test, because
  it would call Resend for real; its endpoint is covered by the worker tests.
- `DATA_MODEL.md §2.1`'s DDL listing already lacked `setup_key_used_at` before
  this task; it is not corrected here.
