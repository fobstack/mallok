# Task 10 — Admin skeleton and the form generator

- Status: **complete**, all checks green locally
- Date: 2026-08-30
- Scope: the Preact app served from Static Assets, the router, the sign-in
  flow, the shell, the settings pages, the account page — and the
  schema-driven form generator every schema-backed surface shares.
- Contract: `docs/ADMIN.md §1–§4`, `§7`, `§11–§13`; `docs/TECH_STACK.md §6`.

## 1. Demonstrable loop

> Sign in → change a site setting → change a theme option → both go through
> the same generator, and both are stored without a rebuild.

Verified in a browser against `wrangler dev`: the theme's `accent` option was
edited in the generated form, the response echoed it, and the `site` row held
`{"accent":"#b91c1c",…}` immediately afterwards.

## 2. How it is served

The build writes to `dist/assets/_mallok/app/`, which Workers Static Assets
serves directly — `/_mallok/app/` and every hashed file never reach the
Worker and are not billed as invocations (`TECH_STACK §6`). What *does* reach
the Worker is a client-side route like `/_mallok/app/settings/appearance`: no
file matches, `not_found_handling: "none"` sends it through, and
`src/worker/admin-app.ts` answers with the shell. The shell is served
`no-cache` (it must never be stale after a deploy) and `noindex, nofollow`.

## 3. The form generator

One component (`src/admin/form/`) serves all four callers named in
`ADMIN.md §7`: content fields, theme options, plugin settings, plugin panel
filters. Every declarable type has a control; the three that are more than an
input behave as the contract requires — media fields write back a **relative
path**, references write back a **slug**, and secrets are write-only and
never echo a value.

Two things were worth designing rather than assuming:

1. **Theme options declare a narrower shape than content fields** — no
   `required`, `group` or `help` (`THEME_FORMAT §6`). Rather than give the
   generator two code paths, `optionSpecs()` widens them at the edge.
2. **Client-side validation mirrors the server's zod rules but is not the
   authority.** It exists so a user hears about a problem without a round
   trip; the server re-checks everything and its message is what gets shown.

## 4. One thing the UI was getting wrong

The first version said **"Saved — live now"** after every save. That is false
whenever no cache-purge token is configured: the row is written immediately,
but visitors keep the cached page until it expires. `ADMIN.md §5` already
required a standing notice for this state and it had not been built.

It is now: `liveDelay` reads `purgeConfigured` from `/health`, a standing
banner explains the state in the shell, and the confirmation reads
**"Saved — visitors see it within 1 hour"** instead. The page ledes were
reworded so they do not contradict the banner. This was found by checking the
public page after saving rather than trusting the green pill.

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass (14 pre-existing CSS warnings, no errors) |
| `pnpm typecheck` | pass (worker + core + admin projects) |
| `pnpm test` | 22 files / 234 tests pass |
| `pnpm build` | pass |
| `pnpm bundle:size` | 225.9 KiB gzip = 7.4 % of the Free limit — **unchanged by the admin**, which is the point |
| `pnpm admin:size` | **20.6 KiB gzip** first load, against a 150 KiB budget |

`scripts/admin-size.mjs` is new: it counts only what `index.html` references
and fails the check if the first load exceeds the budget, so the number in
`ADMIN.md §13` cannot quietly rot.

Tests: `test/admin/form.test.ts` covers spec building, grouping, label
derivation, the theme-option adapter, every validation rule and the route
matcher. `test/worker/admin-app.test.ts` covers which paths the Worker claims
and that it says plainly when the app has not been built.

Browser-verified against `wrangler dev`: sign-in, the shell, the generated
theme-options form (every label bound to its control), saving, and the
standing purge notice.

## 6. Not done / known limits

- **The workers-vitest pool wires the `ASSETS` binding but does not mount the
  asset directory**, so the shell's bytes are verified against `wrangler dev`
  rather than in the test suite. The test asserts the routing decision only.
- **`wrangler dev` snapshots the asset manifest at startup.** Rebuilding the
  admin while it runs yields a 503 from the shell handler until the dev server
  is restarted. Worth a line in the contributor docs when those are written.
- **No axe run yet.** Labels, focus outlines and keyboard operation were built
  to the contract and spot-checked; `@axe-core/playwright` (`ADMIN.md §13`)
  needs a browser test harness, which no task has set up.
- The setup wizard (`ADMIN.md §5`) belongs to Task 15 and is not here.
