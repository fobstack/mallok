# Task 12 — Plugin panels, appearance and diagnostics

- Status: **complete**, all checks green locally
- Date: 2026-08-30
- Scope: the plugins page with declarative panels, the appearance page, and
  the advanced/diagnostics page with the deploy/no-deploy table.
- Contract: `docs/ADMIN.md §4.1`, `§9`, `§10`, `§11`;
  `docs/PLUGIN_API.md §7.5`.

## 1. Demonstrable loop

> See the inquiry list in the admin, mark a row replied, export CSV; change a
> theme option and have it take effect without a deploy.

Verified in a browser against `wrangler dev`: two inquiries submitted through
the public form appeared in the panel, "Mark replied" changed one row's
status, the detail dialog showed every declared field, and the theme-option
save was confirmed against the stored `site` row.

## 2. A plugin ships no UI code

`PluginPanelView` reads `panels[]` out of `plugin.json` and builds the table,
the filters, the row detail and the actions from it. The `inquiry` plugin
contributes zero admin code, and its panel still renders columns with the
right types — `email` becomes a mailto link, `badge` becomes a status pill,
`datetime` is formatted — because the manifest says what each column is.

This is the boundary from `ADMIN.md §7`: the moment plugin authors write
admin code, the admin's size budget and its security boundary are both gone.

## 3. What these pages deliberately lack

Neither the appearance page nor the plugins page has an install, upload or
switch control, and both say why in plain words with the actual steps. From
`PRODUCT_VISION §4`: content and settings belong to the operator, themes and
plugins belong to the deployment. A button that appeared to switch a theme
would be a lie, because nothing can make it take effect without a new build.

What the pages *do* show is the cost of what is installed: the theme's
`clientScripts` verbatim (official themes: none), each plugin's hooks,
whether it injects client JavaScript, whether it affects cached pages, and a
prominent line for any plugin with an `onRequest` hook — which runs on every
visitor request, cache hits included (`PLUGIN_API §5.1`).

## 4. The deploy/no-deploy table

`ARCHITECTURE §15` asks for this to be stated once, plainly. It is on the
advanced page as two columns: instant (content, settings, theme options,
plugin switches and settings) against needs-a-deploy (switching themes,
installing plugins, upgrading Mallok). The same page reports whether a custom
domain is bound, whether the edge cache is therefore active, whether a purge
token is configured, and which migrations have been applied.

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 22 files / 234 tests pass |
| `pnpm build` | pass |
| `pnpm admin:size` | 20.6 KiB gzip first load (the plugins page is a lazy chunk) |

Browser-verified: the settings form and both secret controls generated from
`plugin.json`; the panel's columns, filters, mailto and badge rendering; the
`mark_replied` action changing a row; the detail dialog listing every declared
field. The CSV export path was verified through the API in Task 08 and shares
this component's request.

## 6. Not done / known limits

- **Usage quotas are not shown.** `ADMIN.md §11` asks for D1 row reads and
  writes against the daily limit, which matters because the Free plan cuts off
  for the rest of the day when exceeded. No Worker binding reports it — the
  numbers live in the Cloudflare dashboard — so the page says that instead of
  inventing a figure. Reading it would mean calling the Cloudflare GraphQL
  analytics API with an account-scoped token, which is a bigger decision than
  this task.
- ~~"Clear all caches" and "clear the fragment cache" are not built.**~~ **Closed in a later pass.** Originally:
  `ADMIN.md §11` lists both; the endpoints do not exist yet.
- ~~**Backup export is not here** — that is Task 13.~~ **Closed in a later pass:** Settings → Advanced now builds the zip in the browser.
- **Secrets have no "test this key" action.** Saving a wrong Resend key is
  only discovered when an email job fails.
