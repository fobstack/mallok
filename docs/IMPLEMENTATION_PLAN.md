# The Mallok 0.1 implementation plan

- Status: 0.1 baseline
- Date: 2026-08-29
- Standing: breaks `PRODUCT_VISION §6`'s delivery list into tasks with a
  dependency order. Each task is one demonstrable user path plus test evidence
  (`docs/CONVENTIONS.md`, working rules). **This is a contract about order,
  not a schedule — no time estimates appear here.**

## 1. Where things stand

| | Status |
| --- | --- |
| Task 01 walking skeleton | Code complete, green locally |
| Task 02 authentication and the management API | **Done**, green locally |
| Task 03 media | **Server side done**; browser-side conversion deferred to Task 11 |
| Task 04 theme format | **Done**, rebuilt around the build-time model |
| Task 06 multiple languages | **Done** |
| Task 05 SEO endpoints | **Done**, except writing the purge measurement back |
| Task 07 plugin runtime | **Done** |
| Task 08 the `inquiry` plugin | **Done**; three deviations from `ARCHITECTURE §13` await approval (`tasks/TASK-08.md §4`) |
| Task 09 the trade theme | **Done**, delivered as `atelier` 2.1 with six content kinds |
| Tasks 10–12 the admin | **Done**: the shell and form generator, the three-column editor and media library, plugin panels and diagnostics |
| Task 13 import and export | **Done**; all seven round-trip assertions in `CONTENT_FORMAT §9` pass |
| Task 14 the CLI | **Content commands done** (publish / import / export / media push); `create`, `destroy` and `preview` belong to Task 16 |
| Task 15 the starter and setup wizard | **Done**; `ACTIVE_THEME` is `atelier`, and the wizard is four steps (media domain and email await Task 16) |
| Task 16 deployment entry points | **Code complete, unverified against a real account**; `create` and `destroy` are implemented with unit tests but have never run on a real Cloudflare account |
| Task 17 acceptance close-out | **Done**: evidence recorded for all 67 acceptance criteria, recounted 2026-09-01 into 75 rows. 2026-09-02: `NOT_RUN` rows closed by writing tests, `AC-EXPORT-05` removed by product decision, three `PENDING_DECISION` items settled. 2026-09-03/04: **Gate A run for real** against a Cloudflare account — 2 criteria newly `PENDING_DECISION` from real numbers (`AC-CONTENT-02b/10`). 2026-09-05: `AC-CONTENT-10` settled and implemented (a content-length safety net). 2026-09-06: `AC-CONTENT-02b` settled (reworded to "within a minute", promoted to `VERIFIED_HUMAN` on the existing Gate A measurement). Now: 66 criteria in 74 rows: 59 verified locally, **5 verified on a real account** (`AC-DEPLOY-01/04/07b`, `AC-CONTENT-02b`, `AC-MEDIA-04`), 0 `PENDING_DECISION`, 10 still needing a real account for other reasons. See `ACCEPTANCE.md §14` |
| Five themes | **Done**: the approved designs implemented one to one (atelier, gazette, manual, folio, journal) |
| The nine measurements in `ARCHITECTURE §18` | **Run 2026-09-03/04** — `TASK-01.md §5`. Seven of nine measured against a real account; item 9 (Turnstile/Resend) needs those accounts, and item 7 (Deploy button) is `NOT_AVAILABLE` rather than pending — see `docs/RELEASE_GATE.md §15.1` |
| Design documents | All in place |
| Implemented | The render core, the schema and self-migration, the public path and edge cache, the full authentication and management API, media storage and responsive image output, the SEO endpoints, multiple languages, the plugin runtime and the `inquiry` plugin, five official themes, the complete admin app |
| Not started | Nothing in phases one to five. Every task has been advanced; what remains is gate A's measurements, the product owner's decisions, and translating the remaining documents |
| Phase six, plugin API 2 (Tasks 18–41) | **In progress.** Planned 2026-10-01 from the owner's task list for the Nundar shop plugin, extended 2026-10-03 with the owner's items of 2026-10-02 found building Nundar on rc.7: three defects (Tasks 36, 37, 38 with 40) and one gap (Task 39); baseline `0.1.0-rc.7` (`0af520b`). Done: Task 18 (documentation), Task 19 (panel read scope, released as `0.1.0-rc.8`), Task 20 (public plugin helpers), Task 21 (site-level email settings), Task 22 (the `renderData` hook; the build's plugin API version is 2 from here), Task 23 (plugin cache tags), Task 24 (plugin routes with parameters, a locale segment and JSON bodies), Task 25 (rate-limit tiers), Task 26 (plugin pages through theme layouts, and the cross-site check on plugin routes), Task 27 (`onContentSave` called at last, and `onContentDelete`), Task 28 (editable records panels, sorting and search), Task 29 (records panels attached to the content editor), Task 30 (theme script validation with declared scripts — **P0 complete**), Task 36 (one translation group per published bundle), Task 37 (`recent.<kind>` on the home page), Task 38 (a generated site type-checks and is claimed locally), Task 40 (`mallok publish` from a project root). Task 41 (structured data from `renderData`, added 2026-10-05) is done too. Everything through Task 30 and Task 41 is released as `0.1.0-rc.10`. Done since, unreleased: Task 31 (raw-body routes), Task 32 (action parameters and related rows), Task 33 (isolated scheduled hooks and plugin jobs — **P1 complete** with Task 39, lists of references), Task 34 (starters a site brings — **P2 complete**). **Open: Task 35**, the close-out — the re-measurement on a real account, the version decision and the release are the owner's; the report to Nundar is drafted (`tasks/TASK-35.md`). Records in `tasks/TASK-18.md` onward |

## 2. The two gates

**No task after Task 02 may begin until these are cleared:**

| Gate | What | Who clears it |
| --- | --- | --- |
| **Gate A** | The nine measurements in `ARCHITECTURE §18`, taken and written back | **Mostly cleared 2026-09-03/04** — 7 of 9 run against a real account (`TASK-01.md §4`–`§5`) by Claude Code under the product owner's authorization, with the product owner completing the dashboard-only steps. Items 7 and 9 remain: a public repository, and Turnstile/Resend accounts |
| ~~**Gate B**~~ | ~~The Markdown engine decision~~ **Settled 2026-08-29: stay with unified.** The reasoning and its cost are in `TASK-01 §6` | Cleared |
| ~~**Gate B'**~~ | ~~Whether to keep inline HTML~~ **Settled 2026-09-02: keep it, sanitised.** `rehype-raw` added (`+53.2 KiB` gzip); reasoning in `SECURITY.md §4`, `TECH_STACK.md §11.1` | Cleared |

Gate A blocked: the PBKDF2 iteration count (Task 02) — real data exists now
(`TASK-01.md §5`), the current 50,000 default costs ≈ 10 ms on real hardware
and 100,000 is a hard platform ceiling, not just a CPU-budget one; the purge
plan A or B (Task 05) — **plan A confirmed workable** for real, no need for
plan B; whether a custom domain is a hard precondition (Task 14) — **it is
not**, the Cache API works on `.workers.dev` too. The content-length ceiling
(Task 03) is settled: real stage-one CPU (60–726 ms across 2–128 KB) fed
directly into `AC-CONTENT-10`, closed 2026-09-05 with a pre-flight length
check (`MAX_SAFE_RENDER_BYTES`, `src/worker/admin-content.ts`,
`ACCEPTANCE.md §14.2` item 7).

Gate B is cleared: `beforeRender`'s public signature is fixed against mdast
(`PLUGIN_API.md §5.2`).

Gate B' is cleared: `rehype-raw` parses inline HTML into the tree instead of
letting it drop, `rehype-sanitize` then runs over the whole tree as before, and
`CONTENT_FORMAT §3.4`'s wording is now true rather than aspirational. The
plugin runtime was orthogonal to it throughout, so Tasks 07 and 08 needed no
changes now that it is settled.

> What could proceed with gate A open: Tasks 02, 03, 04 and 06 — **all done**.
> The only remaining work unaffected by gate A is the admin shell and editor
> in Tasks 10 and 11.

## 3. The task sequence

### Phase one: foundations

**Task 02 — authentication and the management API, properly** ✅ **Done (2026-08-29, `tasks/TASK-02.md`)**
Replaces Task 01's spike shortcut (`Bearer MALLOK_SECRET`).
- Full `admin_user`, `session` and `api_token`; PBKDF2 derivation with the
  iteration count from gate A and automatic upgrade on login; session cookies
  and CSRF; scoped Bearer tokens.
- The management API grows from two endpoints to full CRUD: content list,
  detail, save and delete; settings read and write; health and usage.
- The path: sign in → create a token → publish from the command line with it →
  revoke it and see it stop working.
- Depends on: nothing (the PBKDF2 parameters depend on gate A; 50,000 is used
  for now and upgrades on login). Contract: `SECURITY.md §3`.

**Task 03 — media** ✅ **Server side done (2026-08-29, `tasks/TASK-03.md`)**
- Full read and write of the `media` table, content-addressed R2, variants,
  `ref_count` and GC.
- The browser upload pipeline — Canvas to WebP, width variants, sha
  deduplication. **Deferred to Task 11**, because it belongs to `src/admin/`,
  which does not exist before Task 10. The rules both sides share already live
  in `src/core/media.ts` with tests.
- Image output attributes (`srcset`, `sizes`, `width`, `height`, `loading`,
  `decoding`), with the above-the-fold image `eager`.
- Upload validation against the sniffed type; svg refused.
- The path: upload an image → reference it in content → the public page emits
  correct responsive markup.
- Depends on: Task 02. Contracts: `ARCHITECTURE §8`, `SEO_PERFORMANCE.md §9`,
  `SECURITY.md §6`.

**Task 04 — the theme format** ✅ **Done (2026-08-29, `tasks/TASK-04.md`)**
- The full field-type set of `theme.json`'s `kinds[].fields`, and the
  `themeApi` version check.
- Validation runs **at build time** (`scripts/build-themes.mjs`); a failure
  fails the build.
- Theme templates are bundled as text modules; `assets/` is copied to Static
  Assets under `theme/<id>/<version>/` with a `_headers` file setting
  `immutable` and `nosniff`.
- Removed: the `theme` and `theme_file` tables, `site.theme_id`, the zip
  reader, the upload/switch/uninstall endpoints, the `/themes/*` proxy, and
  the `fflate` dependency.
- `GET /_mallok/api/theme` serves the admin's preview and form generation,
  read-only.
- The path: change `ACTIVE_THEME` in `src/themes/index.ts` → build and deploy
  → the site has a new theme with not one URL or item touched.

### Phase two: public output

**Task 05 — SEO endpoints and closing out caching** ✅ **Done (2026-08-29, `tasks/TASK-05.md`, except writing gate A's measurement back)**
- `/sitemap.xml` with pagination and hreflang, `/feed.xml`, `/robots.txt`.
- canonical, OG, Twitter Card, and the four JSON-LD types.
- Full read and write of the `redirect` table, written automatically on a slug
  change.
- **Implements whichever purge plan gate A selects** (A or B in
  `ARCHITECTURE §6.2`).
- The path: publish content → the sitemap and feed include it at once → change
  the slug → the old URL 301s.
- Depends on: gate A, Task 04. Contract: `SEO_PERFORMANCE.md`.

**Task 06 — multiple languages, complete** ✅ **Done (2026-08-29, `tasks/TASK-06.md`)**
- Enabling languages, full `translation_group` management, the language
  switcher context.
- Recomputing every path and writing redirects when `default_locale` changes —
  an operation requiring explicit confirmation.
- List pages, home pages and feeds cached per language.
- The path: create a second language of an item → both URLs are correct →
  hreflang points each at the other → switching the default locale redirects
  the old URLs.
- Depends on: nothing. Contract: `ARCHITECTURE §9`.

### Phase three: product capability

**Task 07 — the plugin runtime** ✅ **Done (2026-08-29, `tasks/TASK-07.md`)**
- Dispatch for the five hooks, `plugin.json` validation at build time, the
  plugin migrator, route dispatch.
- The six capabilities: tables, routes (with zod, Turnstile and rate
  limiting), settings and encrypted secrets, `scheduled`, the API side of
  declarative panels, and `sendEmail`.
- `affectsFragmentCache` validation and its entry into the cache key.
- The path: a minimal example plugin creates a table, registers a route,
  stores settings, is controlled by the switch, and takes effect immediately.
  **Installing it requires a redeploy, and the interface says so.**
- Depends on: **gate B**, Task 02. Contract: `PLUGIN_API.md`.

**Task 08 — the `inquiry` plugin** ✅ **Done (2026-08-29, `tasks/TASK-08.md`; three deviations from `ARCHITECTURE §13` await approval, see its §4)**
- The full path per `ARCHITECTURE §13`: injecting the form markup, the
  submission route, honeypot and timing checks, Turnstile, rate limiting,
  storage, the two jobs, Resend delivery with retries, the thank-you page.
- The admin panel declaration: list, detail, marking, CSV export.
- Email templates per locale, through the restricted Liquid engine.
- The path: **submit one inquiry from a product page; the owner receives the
  email, the buyer receives the acknowledgement, and the admin shows it and
  can export it.** This is 0.1's central acceptance.
- Depends on: Tasks 07 and 06. Contract: `PLUGIN_API.md §11`.

**Task 09 — the trade theme** (delivered as `atelier`; see `THEME_FORMAT §14` on the naming) ✅ **Done (2026-08-29, `tasks/TASK-09.md`)**
- Layouts and field schemas for six content kinds: `page`, `article`,
  `product`, `category`, `case`, `faq`.
- Zero client-side JavaScript, with pure-CSS mobile navigation and gallery.
- `en` and `zh` language packs, and a place in the design for the inquiry
  form.
- The path: render a complete trade site through the theme, passing the gates
  in `SEO_PERFORMANCE.md §7`.
- Depends on: Task 04, Task 08 (for the inquiry call to action). Contract:
  `THEME_FORMAT.md §14`.

### Phase four: the interface

**Task 10 — the admin shell and the form generator** ✅ **Done (2026-08-30, `tasks/TASK-10.md`)**
- Preact, signals, routing, served from Static Assets at `_mallok/app/`.
- **The schema-driven form generator** (`ADMIN.md §7`) — shared by four
  places, and the one admin component worth designing on its own.
- Sign-in, the shells of the top-level sections, the settings pages.
- The path: sign in → change a site setting → change a theme option → both go
  through the same generator.
- Depends on: Tasks 02 and 04. Contract: `ADMIN.md`.

**Task 11 — the content editor and media library** ✅ **Done (2026-08-30, `tasks/TASK-11.md`)**
- The three-column editor: field form, CodeMirror, live preview.
- The preview reuses `src/core/` and is byte-identical to production.
- The media library, the upload interface, the media picker, missing-image
  reporting.
- Language switching and translation-group management.
- The path: **without touching a terminal, enter a product with images from
  scratch, publish it, and see it on the public URL seconds later.**
- Depends on: Tasks 10, 03 and 06. Contracts: `ADMIN.md §6` and `§8`.

**Task 12 — plugin panels and the appearance page** ✅ **Done (2026-08-30, `tasks/TASK-12.md`)**
- Table panels, filters, detail views and actions rendered from
  `plugin.json`'s `panels`.
- The appearance page: the current theme's details, its options form, an
  honest display of `clientScripts`, and the statement that switching themes
  needs a redeploy (`ADMIN.md §4.1`). **No upload and no switch control.**
- The usage and diagnostics pages, including the "needs a deployment / does
  not" table.
- The path: see the inquiry list in the admin, mark items, export CSV; change
  a theme option and see it take effect immediately.
- Depends on: Tasks 10, 08 and 09. Contracts: `ADMIN.md §9`, `§10`, `§11`.

### Phase five: moving content in and out, and deploying

**Task 13 — import and export** ✅ **Done (2026-08-30, `tasks/TASK-13.md`)**
- Export: the complete directory from `CONTENT_FORMAT §5`, plus
  `mallok.json`, `site.json`, `redirects.csv` and `inquiries.csv`.
- Import: detecting the three layouts, normalising aliases, identity and
  conflicts, idempotence, batching.
- **All seven round-trip assertions in `CONTENT_FORMAT §9` pass** — a
  mandatory item.
- The path: export → import into an empty site → export again → byte-identical.
- Depends on: Tasks 03 and 06. Contracts: `CONTENT_FORMAT §7`, `§8`, `§9`.

**Task 14 — the CLI** ✅ **Content commands done (2026-08-30, `tasks/TASK-14.md`); `create` and `destroy` belong to Task 16**
- `publish`, `import`, `export`, `preview`, `media push`.
- The `sharp` image pipeline, to the same specification as the browser's.
- Exit codes, `--json`, missing-image reporting, `image-slots.json`.
- The path: `mallok publish ./articles` publishes a directory with images;
  running it again is a no-op.
- Depends on: Task 13. Contract: `CLI.md`.

**Task 15 — the starter and the setup wizard** ✅ **Done (2026-08-30, `tasks/TASK-15.md`); the wizard is four steps, with media domain and email awaiting Task 16**
- The `trade-b2b` starter: theme, example content, settings preset,
  pre-enabled plugin.
- The wizard, closing permanently once complete.
- Applying a starter decomposes back into the four objects.
- The path: a fresh deployment → complete the wizard → a working trade site
  with a home page, products, an about page and a contact page.
- Depends on: Tasks 12 and 09. Contracts: `ARCHITECTURE §11`, `§15`,
  `ADMIN.md §5`.

**Task 16 — deployment entry points** ⚠️ **Code complete, unverified against a real account (2026-08-30, `tasks/TASK-16.md`)**
- `mallok create` (the ten steps in `CLOUDFLARE_RESOURCES.md §6`) and
  `mallok destroy` (the nine steps in §10).
- The Deploy to Cloudflare path and its `MALLOK_SECRET` approach — **deferred
  past 0.1.0-rc.4 and marked `NOT_AVAILABLE`**: the button deploys the
  repository it points at, and this one is now the framework rather than a
  site. It needs a public starter-site repository that does not exist yet, and
  which is not Nundar (`docs/RELEASE_GATE.md §15.1`).
- The portfolio registry, `.mallok/sites.json`.
- The path: `npx mallok create` on a clean account, through to the wizard.
- Depends on: gate A, Task 15. Contract: `CLOUDFLARE_RESOURCES.md`.

**Task 17 — acceptance close-out** ⚠️ **Partly done (2026-08-30, `tasks/TASK-17.md`): evidence recorded for all 67 criteria, recounted 2026-09-01; Lighthouse and axe, removing the spike, and the English documentation all await their preconditions**
- Evidence for every criterion in `ACCEPTANCE.md`.
- Lighthouse, axe, the size budgets.
- Removing `src/worker/spike.ts` and its routes — **deliberately not done
  yet**: it is the instrument for gate A's measurements, and removing the
  instrument before measuring is backwards.
- English versions of the documentation (`CONTRIBUTING.md` requires English
  throughout).
- Depends on: everything.

### Phase six: plugin API 2

Generic extension points for site-level plugins, driven by the Nundar shop
plugin and commerce theme (`docs/PRODUCT_CONTRACT.md §2`). **No commerce logic
enters Mallok**: prices, orders and stock live only in that plugin, and every
extension point here must make sense for any plugin, such as an inquiry cart
or a booking plugin. The source is the owner's task list of 2026-10-01; its
identifiers are kept in brackets for traceability.

Rules for the whole phase:

- `pluginApi` goes from `1` to `2` and stays backward compatible: the official
  `inquiry` plugin works unchanged. Theme additions are optional: the five
  official themes pass unchanged. Where a security check is added for every
  plugin (Task 26), the change is stated in the upgrade notes.
- The owner's scope decisions of 2026-10-01 hold: English stays unprefixed and
  other locales are prefixed (no "always prefix" mode); one administrator, no
  roles and no translation-completeness view; the shop plugin and theme are
  copied into a site as source.
- Every "current state" was verified at `0af520b` and is re-checked before its
  task starts. **[OWNER]** marks a decision the owner makes before that part
  is built; **[VERIFY]** marks a Cloudflare fact checked against the current
  official documentation, with the source and date recorded.
- Order: the P0 bug fixes (36, 37, 38, 40) first; then the remaining P0 tasks in
  the order below (21–30); then P1 (31–33, 39); then P2 (34); then the
  close-out (35). Tasks 18–20 are done. One task per branch. Task numbers
  follow the order tasks were added, not the order they are built in.
- Done means §5 plus `pnpm admin:size`, with a `docs/tasks/TASK-NN.md` record.

Where the owner's list grouped parts of one item, the parts that are separate
demonstrable paths are split into separate tasks (§6: one task, one path).
The order differs from the list in two places, both by owner decision on
2026-10-01: the panel-read scope fix comes first and ships on its own as
`0.1.0-rc.8`, and rate-limit tiers move from P1 into P0 because the phase-one
cart cannot live within the shared 10-per-minute budget.

#### P0, bugs first — defects found building Nundar on rc.7

Added 2026-10-03 from the owner's updated list (items M12, M13, M15, dated
2026-10-02). Each was hit for real on `0.1.0-rc.7`, stands alone, and can ship
before the rest of the phase. Every "current state" below was re-checked at
`441a5cc` and audited against the source; the earlier tasks' baseline is
`0af520b`.

**Task 36 — one translation group per published bundle** [M12]
- Current: for a bundle without `mallok.json`, `mallok publish` posts each
  language without `translationGroup` (`src/cli/publish.ts`), and the server
  gives each a fresh group (`src/worker/admin-content.ts`,
  `existing?.translation_group ?? input.translationGroup ?? …`). A bundle
  with `index.md`, `index.de.md`, `index.fr.md` and `index.es.md` landed as
  four rows in four groups, with no hreflang and no language switcher.
  `mallok build` groups the same bundle correctly, so the two paths disagree,
  and `CONTENT_FORMAT.md §2` rule 1 says one bundle is one group.
- Within one bundle, carry the group the first saved language received into
  the saves of the others. The save response does **not** return it today
  (`POST /content` answers with `id`, `path`, `status` and the like,
  `src/worker/admin-content.ts`; the CLI's `SaveResponse` matches), so the
  task adds `translationGroup` to that response and documents it.
- When the site already holds a language of the bundle (same kind, locale and
  slug), use that item's group. `findExisting` in `src/cli/publish.ts` lists
  and fetches items one by one and suits `--dry-run` only, so the task adds a
  `slug` filter to `GET /content` (the server already has
  `findContentByKey`) rather than reusing it.
- Republishing stays idempotent (`CONTENT_FORMAT.md §7.2`), and a bundle with
  `mallok.json` behaves exactly as before.
- Bundles already split by rc.7 are **not** merged by republishing: the
  existing row's group wins (`existing?.translation_group ?? …`). The task
  documents the repair (delete the extra languages and publish again) rather
  than rewriting stored groups.
- The path: a four-language bundle with no `mallok.json`, published to an
  empty site, lands as four rows in one group, each page with hreflang to the
  others; publishing it again is a no-op.
- Depends on: nothing. Contracts: `CONTENT_FORMAT.md §2`, `§7`; `CLI.md`;
  `ADMIN.md` (the management API's save response and list filter).

**Task 37 — `recent.<kind>` on the home page for every listed kind** [M13]
- Current: `src/worker/pages/home.page.ts` loads published `article` items
  only and passes `{ article: … }`, while `THEME_FORMAT.md §7.4` documents
  `recent.<kind>` grouped by kind and Atelier's home reads `recent.product`.
  `mallok build` supplies every kind, so the Worker and the static build
  render different home pages from the same content.
- One rule for both paths, so they render the same home page: the kinds are
  those the site enables and the theme declares with a `listLayout`, and each
  list holds the newest `HOME_RECENT` (10) items. Today the Worker uses 10 for
  `article` only (`src/worker/pages/context.ts`) while `mallok build` uses 12
  for every enabled kind, list layout or not (`src/cli/build.ts`); both change.
- Load those lists in **one** D1 batch and resolve covers in the existing
  single query, within `AC-INV-05`'s four round trips. `DATA_MODEL.md §3`
  bounds a home page at 50 rows; Atelier lists five kinds, 5 × 10 = 50. The
  task states that the bound is 10 per listed kind and updates the table row,
  rather than relying on a theme keeping to five.
- Purging needs no change: every content change already carries
  `home:<locale>` (`tagsForContent` in `src/worker/cache.ts`), which is the
  home page's own tag (`src/worker/pages/home.page.ts`). The task adds a
  regression test for it.
- `test/worker/budget.test.ts` has no home-page case today; the task adds one,
  measuring the cold home render's round trips.
- The path: a theme's home template receives `recent.<kind>` for each listed
  kind; the new home-page budget case passes; the Worker and the static build
  render the same home page for the same content; publishing a product purges
  the home page.
- Depends on: nothing. Task 22 builds its home-page `items` on this task's
  multi-kind loader. Contracts: `THEME_FORMAT.md §7.4`, `DATA_MODEL.md §3`,
  `ARCHITECTURE.md §6`.

**Task 38 — a generated site type-checks and can be claimed locally** [M15, parts 1–2]
- Current, at `441a5cc`: the template has no declarations for text modules.
  The framework's own `text-modules.d.ts` declares `*.liquid`, `*.css`,
  `*.sql` and `*.md`, and the template's `wrangler.jsonc` has the matching Text
  rule, but nothing is copied into a generated site, so `npm run typecheck`
  fails as soon as a site adds its own theme or a plugin migration. And
  `template/.dev.vars.example` has no `MALLOK_SETUP_KEY`, though the framework
  README shows how to generate one.
- Ship text-module declarations with generated sites (in the template or in
  the package's types).
- `.dev.vars.example` documents both ways to claim a local site: a
  `MALLOK_SETUP_KEY`, generated as the framework README shows, and the
  existing `MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY=true` switch that the template's
  `wrangler.jsonc` already describes, with the key as the recommended one.
- The path: a generated project with its own theme and a plugin migration
  passes `npm run typecheck` unchanged, and a fresh local site is claimed
  through the wizard with the documented key.
- Depends on: nothing. Contract: the site template
  (`CLOUDFLARE_RESOURCES.md §5`).

**Task 40 — `mallok publish` from a project root** [M15, parts 3–4]
- Split from Task 38 because it is a separate demonstrable path.
- Current, at `441a5cc`: a project root holds `site.json` and `content/`, so
  `detectLayout` already recognises it as the export layout
  (`CONTENT_FORMAT.md §7.1` item 1, `src/core/bundle.ts`). But `scanDirectory`
  then collects every `index*.md` under the root whatever the layout
  (`src/cli/scan.ts`), which is how `node_modules/mallok/template/content/…`
  becomes a bundle. And `--with-settings` reads the site's kinds before it
  applies `site.json` (`src/cli/index.ts`), so bundles of a kind that file
  enables are dropped.
- In the export layout, scan only under `content/`; in every layout, skip
  `node_modules`, `dist`, `.wrangler`, `.mallok` and dot-directories. With
  `--with-settings`, apply the settings first and resolve kinds from the
  result.
- **Owner decision, 2026-10-03:** a project root is a supported input.
  `mallok publish . --with-settings` from a project made by `mallok create`
  is a documented use.
- The path: from a generated project's root,
  `mallok publish . --with-settings` publishes exactly the bundles under
  `content/`, including kinds only the applied `site.json` enables.
- Depends on: nothing. Contracts: `CLI.md`, `CONTENT_FORMAT.md §7.1`.

#### P0 — Nundar phase 1: catalogue with variants, cart, inquiry cart

**Task 18 — documentation corrections** [M0]
- `PRODUCT_VISION.md §9` names the extension points this phase adds instead of
  "the six plugin capabilities … no new concept".
- `RELEASE_GATE.md §15.1` and `ARCHITECTURE.md §15` align with
  `PRODUCT_CONTRACT.md §2` ("Nundar is a Mallok starter, theme and plugin
  set") while keeping their point: the Deploy-button starter repository is not
  Nundar.
- `PRODUCT_CONTRACT.md §5` adds that Mallok's core still does no carts or
  payments; commerce comes from the Nundar plugin through generic extension
  points.
- **Owner decision, 2026-10-01: `CLAUDE.md`'s product boundary ("0.1 does not
  do … carts or payments") gains the same one-line clarification**, so that
  generic extension points a cart needs are not read as crossing it.
- `PLUGIN_API.md` gains a `pluginApi: 2` section (what is new, the
  compatibility rule), filled in as tasks land.
- The path: the contradictions are gone, and every later extension point has a
  place to be documented.
- Depends on: nothing. Docs only, on a `docs/` branch.

**Task 19 — scope check on plugin panel reads** [M6, part F]
- Reading a panel's rows checks the token's scope; writes keep the existing
  `x-mallok-csrf` check. This closes a gap present in `0.1.0-rc.7`: the panel
  read route in `src/worker/admin-plugins.ts` is the one plugin admin route
  without `withScope`, so any authenticated token can read every panel.
- **Owner decision, 2026-10-01: released on its own as `0.1.0-rc.8`** through
  `docs/RELEASE_GATE.md`, ahead of the rest of the phase.
- The path: a token without the scope is refused; the inquiry panel behaves as
  before.
- Depends on: nothing. Contract: `PLUGIN_API.md §7.5`, `SECURITY.md`.

**Task 20 — public helpers for plugins** [M1]
- Export `escapeHtml` and `renderTextTemplate` from `mallok/worker`, with types
  and docs (today the official plugin imports them from `src/core`).
- The path: a third-party plugin importing only public exports compiles,
  renders an email template and escapes HTML
  (`test/cli/strict-consumer.test.ts`).
- Depends on: Task 18.

**Task 21 — site-level email settings** [M1, part 3]
- **Owner decision, 2026-10-01: the Resend key and sender address become a
  site setting**, so every plugin that sends email uses one configuration
  instead of each holding its own. Today `ctx.sendEmail` reads the calling
  plugin's own `resend_api_key` secret and `from_address` setting
  (`src/worker/email.ts`).
- The key is stored encrypted with `MALLOK_SECRET`, like plugin secrets
  (`SECURITY.md`), in a new site-level column or table with its own migration
  (`DATA_MODEL.md`), and edited in the admin's site settings; it never appears
  in a response or a log.
- A plugin's own key and address, where set, still take precedence, so the
  `inquiry` plugin keeps working unchanged on existing sites.
- **Owner decision, 2026-10-01: upgrading moves an existing `inquiry` key and
  sender address into the site setting.** Moving means the plugin's copy is
  removed once the site copy is written, so rotating the site key later
  reaches every plugin. A site setting that already exists is never
  overwritten. The key is encrypted per plugin, so the move decrypts and
  re-encrypts with `MALLOK_SECRET` inside the Worker; a SQL migration cannot
  do it. It is idempotent and safe to interrupt. Afterwards the plugin's own
  key field says the site setting is in use rather than looking unset.
- **Owner decision, 2026-10-03: the `inquiry` plugin drops its
  `resend_api_key` field and keeps an optional `from_address`** whose label
  says an empty value uses the site sender. The core still honours a
  `resend_api_key` a plugin stores, for plugins written before this task.
- **Done 2026-10-05** — `tasks/TASK-21.md`.
- Resend stays the one implementation, called with `fetch`; this is a setting,
  not a provider layer (`ARCHITECTURE.md §17`).
- `PLUGIN_API.md §7.6` documents the lookup order.
- The path: set the key once in site settings, and two plugins without their
  own key both send; a plugin with its own key keeps using it; an upgraded
  site's inquiry key now lives in the site setting.
- Depends on: Task 20. Contracts: `PLUGIN_API.md §7.6`, `SECURITY.md`,
  `ADMIN.md`, `DATA_MODEL.md`.

**Task 22 — the `renderData` hook** [M2]
- A render-path hook with read access to D1, run on a cache miss only, after
  the content is loaded, all plugins concurrently. Content pages pass the
  item; list and home pages pass the items on that page, so one `IN` query
  covers them. A home page's items are the multi-kind lists Task 37 loads. The JSON-serialisable result reaches templates as
  `plugins.<plugin-id>` in `snake_case`; plugins return display-ready values.
- At most one D1 call per plugin per render (one query or one `batch`),
  enforced by a wrapped `db` that counts calls. `test/worker/budget.test.ts`
  counts every statement as a round trip and concurrency does not reduce the
  count; a cold content render makes two today, so within `AC-INV-05`'s four
  **at most two plugins on a page may use `renderData`**, and the docs say so.
- A second call is refused in production as well as in tests and
  development, and handled as a failed hook; a guard that only exists in tests
  leaves the production budget unguarded.
- Deterministic: output depends only on database state and the hook's inputs.
- **Owner decision, 2026-10-05: read-only is enforced.** The wrapped `db`
  rejects writes; the rejection is by statement keyword, which the docs state.
- **Owner decision, 2026-10-05: a throwing hook** (a second call and a write
  included) drops that plugin's data, the page renders, a structured event is
  logged, and that degraded page is not stored in the edge cache.
- The path: a test theme shows `plugins.<id>` data on a content page and a
  list page; a cache hit does not call the hook; identical database state
  gives byte-identical HTML; a second query is refused; a throwing hook still
  renders the page and logs.
- Depends on: Task 18. Contracts: `PLUGIN_API.md §5`, `§6`;
  `THEME_FORMAT.md §7`; `ARCHITECTURE.md` (render path).
- **Done 2026-10-05** — `tasks/TASK-22.md`.

**Task 41 — `renderData` adds to the page's structured data** [M16, planned
with Task 22; added 2026-10-05]
- Why: a price a plugin puts on the page through Task 22 cannot reach the
  page's JSON-LD. `contentJsonLd` (`src/core/view.ts`) builds the `Product`
  node from the content alone, with no `offers`; a theme has no sound way to
  emit JSON-LD itself — `assertNoUndeclaredScripts`
  (`src/core/theme-package.ts`) refuses any `<script` in a theme that declares
  no `clientScripts`, and a theme that does declare them would still be
  building JSON with HTML escaping and adding a second node; and
  `SEO_PERFORMANCE.md §5` allows structured data to describe only what the
  page shows. Read against the code at `8bd24e1`; the task list's "rejects
  any `<script`" holds only for a theme with no declared client scripts.
  (Since Task 30 it holds for every theme: inline script, a JSON-LD block
  included, is refused whether or not scripts are declared.)
- A `renderData` result may carry a reserved key, `structuredData`, holding
  properties for the node the core already builds for that page. The core
  merges them into that node and emits it through the existing path in
  `buildHeadTags` — the same `JSON.stringify`, the same escaping of `<`.
  **One node, not a second `<script>`.** The reserved key is not exposed to
  templates as `plugins.<id>.structured_data`.
- The core's own keys (`@context`, `@type`, `name`, `url` and whatever else
  `contentJsonLd` sets for that node) cannot be overwritten.
- **Owner decision, 2026-10-05: an allow-list per node type**, starting with
  `offers` on `Product` and nothing else; a key outside it is dropped and a
  structured event is logged. Arbitrary properties would let a plugin make a
  page claim what it does not show.
- Only on a content page whose kind already has a node; list and home pages
  have none and this task adds none. When two plugins supply the same key the
  rule is fixed and documented (first in the compiled plugin order wins, the
  other is dropped and logged).
- A throwing hook leaves the core's node unchanged (Task 22's rule).
  Deterministic like the rest of `renderData`.
- The path: a test plugin returning `structuredData.offers` on a product page
  yields exactly one JSON-LD `Product` node containing `offers`,
  byte-identical across renders of the same database state; `@type`, `name`
  and `url` cannot be changed; a key outside the allow-list is dropped and
  logged; a kind with no node, and a plugin returning nothing, give HTML
  byte-identical to today; the five official themes pass unchanged.
- Depends on: Task 22. Contracts: `PLUGIN_API.md §5`, `SEO_PERFORMANCE.md §5`.
- **Done 2026-10-05** — `tasks/TASK-41.md`.

**Task 23 — plugin-declared cache tags** [M3]
- `renderData` may return `cacheTags`; the core namespaces them as
  `p:<plugin-id>:<tag>` and appends them to the page's `Cache-Tag`.
  `ctx.purgeTags` accepts the same namespaced tags.
- **Owner decision, 2026-10-05: a plugin may purge only its own namespace,
  plus `site`.**
- **Verified 2026-10-05** against Cloudflare's purge documentation: Free plan
  5 calls a minute, burst 25, 100 tags a call; tags are printable ASCII with
  no spaces, case-insensitive, 16 KB for the header, 1,024 characters for a
  tag in a purge call. Over-limit tags are dropped with a logged event.
- The path: pages carry the declared tags; purging one affects only the
  matching pages; a plugin cannot purge another's tags.
- Depends on: Task 22. Contracts: `PLUGIN_API.md §9`, `ARCHITECTURE.md §6`.
- **Done 2026-10-05** — `tasks/TASK-23.md`.

**Task 24 — route enhancements** [M4, parts 1–3]
- Multi-segment paths with parameters (`orders/:orderNo`) as `input.params`.
- A locale segment after the plugin prefix (`/_mallok/p/<id>/<locale>/…`)
  sets `ctx.locale`; any other first segment leaves the default. Locales are
  site settings that can change after a build, so the rule for a route whose
  first segment equals a locale code is fixed here: build-time validation
  refuses route segments shaped like a locale code, and at request time the
  locale reading wins.
- Non-string JSON values are kept (`input.json`); form fields stay in
  `input.fields`.
- The path: parameters parse; a locale segment is recognised and a non-locale
  segment is not; numbers and booleans survive.
- Depends on: Task 18. Contracts: `PLUGIN_API.md §4`, `§7.2`.
- **Done 2026-10-05** — `tasks/TASK-24.md`.

**Task 25 — rate-limit tiers** [M4, part 4]
- **Owner decision, 2026-10-01: moved into P0**, since the cart cannot share
  one 10-per-minute budget with the rest of the plugin.
- **Owner decision, 2026-10-05: both** — a second binding with
  `rateLimit: "strict" | "relaxed"`, and the key by route,
  `<plugin-id>:<route>:<ip>`. A `relaxed` route on a site that has not added
  the second binding falls back to the strict one and logs it.
- **Verified 2026-10-05** against Cloudflare's rate-limit binding
  documentation: `period` is 10 or 60 seconds only, so Nundar's reference
  "checkout about 10 per 10 minutes" cannot be configured; the strict tier
  is 10 a minute. The cart's 120 a minute is the relaxed tier's default.
- The path: routes with different tiers no longer share a budget.
- Depends on: Task 24. Contracts: `PLUGIN_API.md §7.2`,
  `CLOUDFLARE_RESOURCES.md §4`.
- **Done 2026-10-05** — `tasks/TASK-25.md`.

**Task 26 — plugin pages rendered through the theme** [M5]
- A route may declare `"render": "page"` and a `layout`; its handler returns a
  view, and the core renders the theme's plugin layout with the full
  `PageView` plus `plugin_page`, a language switcher over Task 24's locale
  segment, `private, no-store` and `noindex`.
- Themes declare `pluginLayouts` in `theme.json`, validated at build; a missing
  layout falls back to a minimal built-in one, and the admin says so.
- A cross-site check on page routes and state-changing POSTs, for every plugin
  (owner decision, 2026-10-01): a request a browser marks as cross-site
  (`Sec-Fetch-Site`, else `Origin` against the site host) is refused; a
  request carrying neither header, which no current browser sends for a form
  POST, is allowed. The `inquiry` plugin's own same-site form passes; the
  change is in the upgrade notes.
- The path: a plugin page renders through a test theme's layout with strings;
  the locale segment and switcher work; a missing layout falls back; a
  cross-site POST is refused; the inquiry form still submits.
- Depends on: Task 24. Contracts: `PLUGIN_API.md §7.2`; a new "plugin page
  layouts" section in `THEME_FORMAT.md` with §15 reworded; `ARCHITECTURE.md`.
- **Done 2026-10-05** — `tasks/TASK-26.md`.

**Task 27 — content save and delete hooks** [M7]
- Call the documented but never-called `onContentSave` on the save path; it
  may change the Markdown or reject the save, and `mallok publish` takes the
  same path.
- Ordering on the save path: the hook runs first, then the
  `MAX_SAFE_RENDER_BYTES` check on the hook's result (a hook can make the
  content longer), then the "unchanged" comparison against the stored item.
  Comparing the hook's result keeps a second `mallok publish` of the same
  file a no-op, provided the hook is idempotent, which the docs require.
- Add `onContentDelete(ref, ctx)` after a delete, with `lastInGroup` true when
  the last language of a `translation_group` goes.
- Hook time counts toward the save request's budget.
- The path: saving calls the hook, which can modify or reject; republishing the
  same file is reported unchanged; deleting passes the right reference and
  `lastInGroup`; CLI publishing triggers the same hooks.
- Depends on: Task 18. Contract: `PLUGIN_API.md §5.4` plus a new delete-hook
  section.
- **Done 2026-10-05** — `tasks/TASK-27.md`.

**Task 28 — editable `records` panels, with sorting and search** [M6, parts A and E]
- A list with create and edit forms, using the theme field vocabulary plus
  `money` (integer minor units and a currency) and `rows` (a repeatable group).
  Every write goes through a handler the plugin declares; the admin never runs
  generic SQL.
- Sortable columns and text search over declared fields.
- New form components load on demand, inside the 150 KB first-load budget.
- The path: a declared records panel creates and edits records and shows
  validation errors; a `rows` field adds and removes rows; sorting and search
  work; the inquiry table panel is unchanged.
- Depends on: Task 19. Contracts: `PLUGIN_API.md §7.5`, `ADMIN.md`.
- **Done 2026-10-05** — `tasks/TASK-28.md`.

**Task 29 — panels attached to the content editor** [M6, part B]
- `"attachTo": { "kind": "product" }` shows a records panel beside the editor
  for the open item, keyed by its `translation_group`.
- The path: an attached panel shows only the open item's records, and deleting
  the item cleans them up through Task 27's hook.
- Depends on: Tasks 27 and 28. Contracts: `PLUGIN_API.md §7.5`, `ADMIN.md`.
- **Done 2026-10-05** — `tasks/TASK-29.md`.

**Task 30 — theme script validation with declared scripts** [M10]
- Templates are still scanned when a theme declares `clientScripts`: only
  `<script src>` tags naming a declared path pass; inline scripts and `on*=`
  attributes are rejected. A declared path written through the asset prefix,
  `{{ theme.asset_base }}/<path>`, counts as naming it — that is how Atelier's
  home layout loads its carousel.
- `THEME_FORMAT.md §3` and `theme-package.ts` agree on `.js` assets.
- The path: a declared-path reference passes; inline script, undeclared path
  and `onclick=` are each rejected; all five official themes pass, including
  Atelier's carousel.
- Depends on: Task 18. Contract: `THEME_FORMAT.md §3`, `§9`.
- **Done 2026-10-06** — `tasks/TASK-30.md`. This completes P0 of phase six.

#### P1 — Nundar phase 2: payment and orders

**Task 31 — raw-body routes** [M8]
- `"body": "raw"`: the core does not parse the body and the handler reads
  `ctx.request`. No Turnstile; exempt from Task 26's cross-site check; may
  disable rate limiting; a body-size cap (**[VERIFY]** Stripe's event size).
- The path: the handler receives the exact bytes sent, and an HMAC over them
  verifies; an oversized body is refused.
- What the first consumer needs, stated 2026-10-05: the body as received,
  readable once as text; the request headers (a signature header); one plugin
  secret in `ctx.secrets`; **the handler's status code passed through
  unchanged** (a payment provider retries on 500 and not on 400);
  `ctx.waitUntil`; no rate limit. A single-segment path is enough, so Task
  24's multi-segment paths are not a prerequisite.
- **Owner decision, 2026-10-05: the order stays** — after Task 26, in P1.
  Nundar's first phase needs no payment.
- Depends on: Task 26. Contract: `PLUGIN_API.md §7.2`.
- **Done 2026-10-06** — `tasks/TASK-31.md`.

**Task 32 — action parameters and related rows** [M6, parts C and D]
- Actions declare `params`, the admin prompts for them, and the handler
  receives `(ids, params, ctx)`.
- A detail view shows related rows from a declared child table.
- The path: parameters reach the handler; related rows are shown.
- Depends on: Task 28. Contracts: `PLUGIN_API.md §7.5`, `ADMIN.md`.
- **Done 2026-10-06** — `tasks/TASK-32.md`.

**Task 33 — isolated scheduled hooks and a job API** [M9]
- A `try/catch` per plugin in the cron tick, logging the plugin id.
- `ctx.enqueue(name, payload, { runAt? })` writes a `job` row; plugins declare
  `jobs`; each tick runs a bounded number, with retries and backoff, and marks
  exhausted jobs failed in the admin. At-least-once: handlers are idempotent.
- **Owner decision, 2026-10-06: the email jobs' existing rule** — five
  attempts, waiting 2, 4, 8 and 16 minutes between them (`src/db/queries.ts`,
  `failJob`). One rule for every job in the system.
- **Owner decision, 2026-10-06: `ctx.enqueueStatement` is offered** as well as
  `ctx.enqueue` (the task list's note of 2026-10-05). It returns a prepared
  statement the plugin puts in its own `db.batch`, so that a change and the
  work it owes commit together or not at all. The core builds the statement;
  a plugin still cannot write the `job` table freely.
- The path: one throwing plugin no longer stops the others; jobs run, retry
  and fail at the limit; a tick stays within its bound.
- Depends on: Task 18. Contracts: `PLUGIN_API.md §5.5`, `§7.4`;
  `DATA_MODEL.md §2.9`.
- **Done 2026-10-06** — `tasks/TASK-33.md`.

**Task 39 — resolve `reference[]` fields** [M14]
- Added 2026-10-03 (owner's item M14). Current: `loadRelations` in
  `src/worker/render.ts` resolves `decl.type === 'reference'` only, for both
  `content.refs` and `content.backrefs`, so a `reference[]` field reaches a
  template as bare slugs, while `THEME_FORMAT.md §5.2` lists it as supported
  without saying it is unresolved.
- Forward: `content.refs.<field>` becomes an array of summaries, in
  declaration order, bounded. Backward: items whose `reference[]` contains
  this item's slug appear in `content.backrefs.<kind>`. Both stay inside the
  existing relations batch and `RELATION_STATEMENTS_MAX`; the back-reference
  query needs an index strategy for a JSON array (`DATA_MODEL.md §3`). The
  tag archive's `EXISTS (SELECT 1 FROM json_each(frontmatter, '$.tags') …)`
  over the `content_list` index (`src/db/queries.ts`) is the precedent.
- `test/worker/budget.test.ts` has no `reference[]` case today; the task adds
  a worst case.
- The path: a product naming two collections appears on both collection
  pages, and the product page lists both; the new budget case passes.
- Depends on: nothing. Contracts: `THEME_FORMAT.md §5.2`, `§7.5`;
  `DATA_MODEL.md §3`.
- **Done 2026-10-06** — `tasks/TASK-39.md`.

#### P2 — Nundar phase 3

**Task 34 — site-provided starter content** [M11]
- **Owner decision, 2026-10-06: `createMallok({ theme, plugins, starters })`.**
  A site registers its own starter and the first-run wizard offers it.
- The path: a fresh deployment ends up as a shop with sample products and
  variants.
- Depends on: Task 18; sample plugin data (variants) is written through
  Task 28's declared write handlers.
- **Done 2026-10-06** — `tasks/TASK-34.md`.

#### Received 2026-10-06 — Nundar's items M17–M21

Added to the owner's task list on 2026-10-06, after P0–P2 above were fixed.
None is part of plugin API 2; each is a gap Nundar met building on rc.9 and
rc.10.

**Task 42 — inquiry form labels in the page's language** [M17]
- Current: `src/plugins/inquiry/form.ts` holds labels for `en` and `zh` and
  falls back to English, so a German page carries an English form.
- The form reads `t.inquiry_name`, `t.inquiry_email`, `t.inquiry_company`,
  `t.inquiry_phone`, `t.inquiry_message`, `t.inquiry_submit` from the active
  theme's language pack and falls back to its own table per missing key.
- The path: a page in a language the theme has a pack for shows the labels in
  that language; a missing key falls back without an error.
- Contracts: `PLUGIN_API.md §9`, `THEME_FORMAT.md` (language packs).

**Task 43 — a tagline, and a home page description, per language** [M18]
- `tagline` is accepted as a string or as a map of locale to string, the way
  `nav` is keyed; `site.tagline` and the home page's `page.description`
  resolve for the page's locale, falling back to the default locale's.
- The path: a site with a tagline per language serves each home page with its
  own description; a plain string behaves as now.
- Touches the `site` row's `tagline` column, the settings API, the admin's
  site settings, `site.json` and `mallok build`. Contracts: `DATA_MODEL.md
  §2.2`, `THEME_FORMAT.md §7`, `ADMIN.md`.

**Task 44 — a kind with an address and no list layout answers 404** [M19]
- Current: a theme kind with a `base` and no `listLayout` renders its items,
  and `GET /<base>` answers 500 ("Theme has no list layout for kind …").
- The path: that request answers 404 through the theme's not-found page, in
  the page's language.
- Contracts: `THEME_FORMAT.md §7.4`.

**Task 45 — let a template link to a kind's list page** [M20]
- **[OWNER]** `content.list_path` on a content page, or `site.kinds.<kind>`
  with `path` and `label` on every page.
- The path: a template renders a link to the list page of the current
  content's kind, in the page's language, and it follows a change of `base`.
- Contracts: `THEME_FORMAT.md §7`.

**Task 46 — switching a plugin, changing settings, and a first run should not
leave stale pages** [M21]
- **[VERIFY]** first, on a deployed site with a purge token: whether enabling
  or disabling a plugin, and `PATCH /settings`, purge what they change. Nundar
  observed the stale pages locally, with no token bound.
- Then, as the finding requires: purge on a plugin's switch; and for a first
  run, a home page requested before setup completes must not be stored — or
  the docs and the CLI say what to clear.
- Contracts: `PLUGIN_API.md`, `ARCHITECTURE.md §6`, `GETTING_STARTED.md`.

#### Close-out

**Task 35 — re-measure, release and report back to Nundar**
- Re-run the budget-related release gates on a real account with
  `renderData` active: product-page cold-render CPU and D1 round trips
  (`TASK-01.md §5`'s method). The rc.5 sample already had 16 of 30 cold
  renders over the 10 ms target, so this is measured, not assumed.
- Release through `docs/RELEASE_GATE.md`. **[OWNER]** The version: another
  `0.1.0-rc` or `0.2.0`, given the plugin contract change.
- Report to Nundar: the published version (Nundar pins it exactly), each
  task's final interface wherever it differs from the owner's drafts, the
  measured numbers, and every owner decision and deviation.
- Depends on: every task Nundar's current phase needs (P0 for phase 1).

## 4. The dependency graph

```
Gate A ─┬────────────────────────────► Task 05 ──► Task 06 ──┐
        └───────────────────────────► Task 16               │
Gate B ─────────────► Task 07 ──► Task 08 ──┐                │
                                            ▼                ▼
Task 02 ──► Task 03 ──► Task 04 ────────► Task 09       Task 13 ──► Task 14
   │           │           │                 │                │
   └───────────┴───────────┴──► Task 10 ──► Task 11 ──► Task 12 ──► Task 15 ──► Task 16 ──► Task 17
```

Phase six builds on `0.1.0-rc.7`, after Task 17. The arrows below are the
hard dependencies. Done: 18, 19 (released as `0.1.0-rc.8`) and 20. The build
order from here is the bug fixes 36 → 37 → 38 → 40, then 21 → 22 → 23 → 24 → 25 →
26 → 27 → 28 → 29 → 30 for the rest of P0, with Task 41 directly after 22;
P1 is 31 → 32 → 33 → 39. Task 35
closes each Nundar phase.

```
Task 36 [M12]   Task 37 [M13]   Task 38 [M15 1–2]   Task 40 [M15 3–4]   Task 39 [M14] (P1)
   (each stands alone; Task 22 later builds on Task 37's home-page loader)
```

```
Task 19 [M6 F] ──► rc.8 ──► Task 28 [M6 A, E] ──┬──► Task 29 [M6 B]
                                                ├──► Task 32 [M6 C, D]  (P1)
                                                └──► Task 34 [M11]      (P2)

                ┌──► Task 20 [M1] ──► Task 21 [M1 site email]
                ├──► Task 22 [M2] ──┬──► Task 23 [M3]
                │                   └──► Task 41 [M16]
                ├──► Task 24 [M4 1–3] ──┬──► Task 25 [M4 tiers]
Task 18 [M0] ───┤                       └──► Task 26 [M5] ──► Task 31 [M8]  (P1)
                ├──► Task 27 [M7]
                ├──► Task 30 [M10]
                └──► Task 33 [M9]                                         (P1)

Task 27 ──► Task 29   (an attached panel's records are cleaned up by the delete hook)
all of a phase ──► Task 35
```

## 5. What "done" means for a task

The general definition of done, plus this project's additions:

1. The full scope described is implemented, and anything cut is stated
   explicitly.
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size`
   is green.
3. New logic has tests, meeting the coverage gate in `TESTING.md §5`.
4. `AC-INV-01..09` are re-verified (`ACCEPTANCE.md §11`).
5. The criteria this task covers carry evidence in `TESTING.md §6`'s format.
6. No `TODO` placeholders, no commented-out dead code, no debug printing.
7. The report states: files changed, how it was verified, what is unfinished,
   and the known risks.

## 6. What is not done here

- No abstraction built ahead of a need (`ARCHITECTURE §17`).
- No "improving things while I am here" inside a task
  (`docs/CONVENTIONS.md`, working rules).
- No skipping gate A or gate B to make progress.
- No merging tasks. One task, one demonstrable path is deliberate: it keeps
  every step acceptable rather than delivering a pile of unverifiable code at
  the end.
