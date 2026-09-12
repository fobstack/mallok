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
| Not started | Nothing. Every task has been advanced; what remains is gate A's measurements, the product owner's decisions, and translating the remaining documents |

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
