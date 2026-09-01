# Task 04 — Themes as source

- Status: **complete**, all checks green locally
- Date: 2026-08-29
- Scope: field schemas in `theme.json`, build-time validation, themes compiled
  into the Worker, assets served by Static Assets, kind fallback, and the
  removal of the Task 01 shortcut that inlined the stylesheet.
- Contract: `docs/THEME_FORMAT.md`.

## 1. How this task changed shape

It was first built around runtime installation: upload a zip, store templates
in D1, switch with a settings field. The product owner replaced that model on
2026-08-29 with a simpler one:

> **Changing content needs no build. Changing the site's framework — themes,
> plugins, Mallok itself — needs a redeploy.**

Themes are therefore source code. That deleted more than it added: no archive
reading, no install transaction, no theme tables, no R2 objects for theme
files, no admin upload UI, and one fewer query on every cold render. The
design documents were rewritten first and reviewed before any code moved.

## 2. Demonstrable loop

> Put a theme directory in `src/themes/` → point `ACTIVE_THEME` at it → build
> and deploy → the site renders with it, and **every content id and URL is
> unchanged**.

Plus the case that makes it safe: a theme that does not know a content kind
renders that content with its `page` layout instead of failing.

## 3. What changed

| Area | Files | Notes |
| --- | --- | --- |
| Validation | `src/core/theme-package.ts` | Same rules as before, now applied to a directory at build time instead of an archive at upload time. |
| Build step | `scripts/build-themes.mjs` | Validates every theme, stages `assets/` under `theme/<id>/<version>/`, writes `_headers`. Runs before Wrangler in `pnpm build` and `pnpm dev`. |
| Registry | `src/themes/index.ts` | `ACTIVE_THEME` is the one line that "switching themes" means. |
| Runtime | `src/worker/theme-cache.ts`, `theme-assets.ts` | Compiles the bundled theme once per isolate; the asset helper is now a pure path builder. |
| Schema | `src/db/migrations/0001_init.sql` | `theme` and `theme_file` dropped, `site.theme_id` dropped. |
| Queries | `src/db/queries.ts` | Six theme functions and two joins removed; a cold render is one query lighter. |
| Admin API | `src/worker/admin-settings.ts` | `GET /_mallok/api/theme` returns the active theme for the admin's preview and forms. No POST, no activate, no delete. |

**Deleted**: `src/core/zip.ts`, `src/worker/admin-theme.ts`, the `/themes/*` R2
proxy, `test/fixtures/zip-builder.ts`, and the `fflate` dependency added
earlier the same day.

Because nothing is deployed yet (`docs/README.md` status is `NOT_AVAILABLE`),
`0001_init.sql` was edited rather than followed by a migration that drops
tables. That is the one deviation from the append-only rule in
`DATA_MODEL.md §2.10`, and it is only available before first release.

## 4. Decisions worth recording

1. **`ACTIVE_THEME` is a constant, not a column.** The owner decided switching
   also requires a deploy, so there is no `site.theme_id`, no switch endpoint
   and no admin control. What stays runtime is `site.theme_options` — the
   values for the knobs the theme exposes.
2. **Validation moved to the build.** A broken theme now fails in the author's
   terminal with the file named, rather than after a deploy.
3. **`index.ts` is skipped by the validator.** It is code, not theme data, and
   it is what makes the templates text modules in the bundle.
4. **Static Assets does not cache aggressively by default.** Measured in
   `wrangler dev`: `Cache-Control: public, max-age=0, must-revalidate`. The
   build writes a `_headers` file to get `immutable` and `nosniff`. This is
   recorded in `THEME_FORMAT.md §3.2` because the earlier draft asserted those
   headers without checking.

## 5. Evidence

Environment: Node 22.22.2, workerd via `@cloudflare/vitest-pool-workers`
0.22.0, macOS 24.6.0, vitest 4.1.11.

```
pnpm lint        → exit 0
pnpm typecheck   → exit 0
pnpm test        → exit 0   (11 files, 125 tests)
pnpm build       → exit 0   (theme validation: ✓ journal@0.1.0, 9 templates, 1 asset)
pnpm bundle:size → exit 0   (780.7 KiB raw, 207.0 KiB gzip, 6.7% of the Free limit)
```

Bundle size across the day: 210.9 KiB (hand-written zip reader) → 213.1 KiB
(with `fflate`) → **207.0 KiB** (no archive handling at all).

| Requirement | Test | Status |
| --- | --- | --- |
| Directory splits into bundled text and staged assets | `test/core/theme-package.test.ts` | `VERIFIED_LOCAL` |
| Directory name must match the manifest id | same | `VERIFIED_LOCAL` |
| Disallowed paths, unsafe paths and asset extensions refused, svg included | same | `VERIFIED_LOCAL` |
| Missing layout, missing `page` kind, missing or malformed locale bundle refused | same | `VERIFIED_LOCAL` |
| Undeclared `<script>` and `on*=` refused; declared allowed | same | `VERIFIED_LOCAL` |
| Newer `themeApi` refused | same | `VERIFIED_LOCAL` |
| Field schemas accepted; `select` without choices refused | same | `VERIFIED_LOCAL` |
| `index.ts` is not treated as theme data | same | `VERIFIED_LOCAL` |
| Page links the stylesheet instead of inlining it | `test/worker/flow.test.ts` | `VERIFIED_LOCAL` |
| Boot no longer installs a theme; one `migration` row, no theme tables | `test/worker/flow.test.ts` | `VERIFIED_LOCAL` |
| Health reports the build-time theme and version | `test/worker/flow.test.ts` | `VERIFIED_LOCAL` |
| Build fails on an invalid theme | `pnpm build:themes` exit code | `VERIFIED_LOCAL` |

### Verified against `wrangler dev`, not the test pool

The Workers Vitest pool wires up only the `ASSETS` **binding**, not the asset
directory, so asset serving cannot be asserted there. It was checked against
`wrangler dev` instead:

```
GET /theme/journal/0.1.0/style.css
  200, Content-Type: text/css; charset=utf-8, Content-Length: 2420
  Cache-Control: public, max-age=31536000, immutable
  x-content-type-options: nosniff
GET /theme/journal/9.9.9/style.css   → 404 (falls through to the Worker)
GET /                                → links /theme/journal/0.1.0/style.css, no inline <style>
```

Full loop on the same server: bootstrap → login → token → publish → the public
page renders with the bundled theme; `GET /_mallok/api/theme` returns
`{id: journal, version: 0.1.0, assetBase: /theme/journal/0.1.0,
switchRequiresDeploy: true, clientScripts: []}`; `GET /_mallok/api/diagnostics`
reports `migrations: ["0001_init"]`.

### Cross-stage invariants (`ACCEPTANCE.md §11`)

`AC-INV-01`, `-02`, `-03`, `-04` (207.0 KiB gzip), `-07`, `-09`:
`VERIFIED_LOCAL`.

## 6. Not done, and why

- **Only one theme exists.** `trade` is Task 09, and it is what will first
  exercise switching between two bundled themes.
- **`fields` are declared but not enforced on save.** Validating content
  against them happens where the form is generated (Task 11) and where imports
  are read (Task 14).
- **No admin UI**, so the "appearance" page described in `ADMIN.md §4.1` is
  API-only for now. `GET /_mallok/api/theme` is what it will consume.
- **Kind fallback is not surfaced to the operator** (`THEME_FORMAT.md §5.3`
  asks the content list to flag it); there is no content list yet.
- **`_headers` covers only `/theme/*`.** The admin SPA will need its own rules
  in the same file when Task 10 adds it.

## 7. Known risks

1. **Editing `0001_init.sql` in place** is safe only until the first real
   deployment. After that, schema changes must be append-only migrations.
2. **The theme version is now load-bearing for cache correctness.** Change an
   asset without bumping `version` in `theme.json` and visitors keep the old
   file for a year. Nothing enforces this yet; a build-time check comparing
   asset hashes against the last build would.
3. **Asset serving is verified only in `wrangler dev`.** Behaviour on a real
   account — particularly whether `_headers` is applied the same way — belongs
   with the Task 01 measurements.
