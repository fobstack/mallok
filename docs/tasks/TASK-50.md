# Task 50 — Slugs of several segments within a kind

- Status: **done**, merged to `main`, not released.
- Date: 2026-10-25; review fixes 2026-11-01.
- Scope: slugs of up to four segments, how they are checked, served,
  exported, imported and built.
- Source: the owner's item M3 (`docs/IMPLEMENTATION_PLAN.md`, phase seven).

## 1. Demonstrable loop

An article in a kind with the base `rest-api`, saved with
`slug: crypto/crypto-quote`, is served at `/rest-api/crypto/crypto-quote`
(`/en/…` on a prefixed site), listed in the sitemap, exported in a folder
named `crypto-crypto-quote` with the slug in `mallok.json`, and imported back
at the same address.

## 2. What was built

- `slugProblem` and `slugPlacementProblem` (`src/core/paths.ts`): one to four
  segments, each as `slugify` makes it; not `page/<n>` at the start; in a kind
  with no base, a slug of several segments may not start with `tags`, `media`,
  `theme`, a kind's base or an enabled language. Each refusal names the value
  that would be accepted when there is one.
- An intermediate address answers 404; changing a slug records a 301.
- The admin's slug field normalises each segment; `mallok publish`, `mallok
  import` and starters take the slug from front matter or `mallok.json`.

## 3. Review fixes, 2026-11-01

- **`mallok build` checked no slug.** `../../x` wrote outside the output,
  `page/2` over a list's second page, `Products` to an address the Worker
  never serves. The build now runs the Worker's checks on every published
  item before writing anything and stops with the list. As a second line, no
  output path may contain a `.` or `..` segment — a tag named `..` would have
  overwritten the home page.
- **A settings change could strand a saved slug.** Enabling `de` or giving a
  kind the base `guides` after `de/handbook` or `guides/getting-started` was
  saved made two things share an address. `PATCH /settings` now answers 409
  with a `stranded` list (id, path, reason).
- **The admin dropped a segment it could not spell** (`产品/x` became `x`,
  another address) and let `page/2` through to the server. Both are caught in
  the field now, keeping what was typed.
- **A rename by slug alone was not saved.** A save by id with the same
  Markdown, status and date was answered "unchanged" whatever its slug, kind
  or language. Found while writing Task 49's tests; it is in every release
  before this one.

## 4. Verification

`test/core/paths.test.ts`, `test/worker/nested-slugs.test.ts`,
`test/cli/build-nested-slugs.test.ts`, `test/admin/slug.test.ts`; each fix in
§3 red-green checked by reverting it.

## 5. Open

- Not checked on a deployed site.
