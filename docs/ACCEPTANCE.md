# Mallok 0.1 acceptance criteria

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: the only test of "0.1 is done". **Every criterion is an observable
  behaviour, not an engineering milestone.** The evidence format and the
  status values are in `TESTING.md §6`.

## 1. The release gate

0.1 is accepted against exactly one thing: **a real foreign-trade B2B site
running on Mallok and receiving an inquiry** (`PRODUCT_VISION §2.1`).

The nine steps of `PRODUCT_VISION §8` are the release gate. **All nine must
pass**, and no single engineering milestone may declare a release on its own:

> Finishing only the render core, only the CLI, only running locally, or not
> receiving the inquiry, is not finishing 0.1.

## 2. Numbering

```
AC-<GROUP>-<NUMBER>
```

| Group | Covers |
| --- | --- |
| `AC-DEPLOY` | Deployment and the setup wizard |
| `AC-CONTENT` | Entering, editing and publishing content, and languages |
| `AC-MEDIA` | Media upload and image output |
| `AC-THEME` | Installing, switching and configuring a theme |
| `AC-PLUGIN` | The plugin switch and the inquiry path |
| `AC-SEO` | SEO output and the performance gates |
| `AC-EXPORT` | Import, export and no lock-in |
| `AC-CLI` | The command line |
| `AC-INV` | Cross-stage invariants, re-verified by every task |

Status values:

| Status | Meaning |
| --- | --- |
| `VERIFIED_LOCAL` | **An automated assertion at a nameable `file:line`.** Walking through it by hand does not count — `TESTING §1`, rule 3: a test that cannot be reproduced is not a test |
| `VERIFIED_HUMAN` | Verified by a person on a real Cloudflare account |
| `NOT_RUN` | Implemented, but with no reproducible evidence |
| `PENDING_DECISION` | The implementation is fine; **the criterion itself is wrong** and awaits the product owner. What blocks it is us, not the platform |
| `NOT_AVAILABLE` | Needs a real account or an external service; no evidence is obtainable locally |

**Each criterion's status and evidence live in its group's table below, and
the totals are counted from those tables rather than written above them.**
That is the structural change from the 2026-09-01 recount: previously only the
`AC-INV` group carried a status column and the other 57 criteria did not, so
the totals were maintained by hand and drifted into three mutually
contradictory figures (§14.0).

## 3. AC-DEPLOY

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-DEPLOY-01` | `npx mallok create` creates every resource on a clean Cloudflare account, deploys successfully, and prints a reachable `.workers.dev` address | `VERIFIED_HUMAN` | Run for real 2026-09-03/04 (`TASK-01.md §5`): D1 and R2 created, config written, deployed, `.workers.dev` address returned `200`. **Found and fixed a real bug on this run**: `buildSiteConfig` did not adjust `main`/`assets.directory` for the nested config path, so the deploy step failed until `src/cli/provision.ts` was corrected — see `test/cli/provision.test.ts` for the regression test |
| `AC-DEPLOY-02` | The Deploy to Cloudflare button completes once, creating the resources, with `MALLOK_SECRET` handled by one of the approaches in `CLOUDFLARE_RESOURCES.md §7` | `NOT_AVAILABLE` | Needs a public repository and a real account. The button has never been clicked |
| `AC-DEPLOY-03` | Every step of the setup wizard completes, and `/_mallok/setup` returns 404 afterwards. **The wizard is four steps** (`ARCHITECTURE §15`, `ADMIN.md §5`); media domain and email are configured afterward in Settings, not folded into it — settled 2026-09-02, see §14.2 item 2 | `VERIFIED_LOCAL` | `test/worker/setup.test.ts:53`, `:81`, `:181` |
| `AC-DEPLOY-04` | With a custom domain bound, the site serves normally and **the cache hits** (`x-mallok-cache: HIT`) | `VERIFIED_HUMAN` | Real custom domain (`spike.mallok.dev`) bound 2026-09-03: first request `MISS`, second `HIT`, identical to the `.workers.dev` behaviour. `TASK-01.md §5`, `ARCHITECTURE §18` item 1 |
| `AC-DEPLOY-05` | With no custom domain bound, the wizard says plainly that caching is not in effect, and `robots.txt` emits `Disallow: /` | `VERIFIED_LOCAL` | `test/worker/seo.test.ts:152`, `:161` |
| `AC-DEPLOY-06` | Without `CF_API_TOKEN` the site works normally, `cache_ttl` drops to 60 seconds, and the admin carries a standing notice | `VERIFIED_LOCAL` | `test/worker/setup.test.ts:81`, `test/worker/cache-admin.test.ts:94`, `test/worker/setup.test.ts:35` |
| `AC-DEPLOY-07a` | Concurrent first requests apply the migration exactly once in workerd, and the lock is released | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:42` |
| `AC-DEPLOY-07b` | The same holds on real infrastructure | `VERIFIED_HUMAN` | Two independent runs against fresh real D1 databases 2026-09-03, ten parallel first requests each: exactly one row per migration, lock released both times. `TASK-01.md §5`, `ARCHITECTURE §18` item 8 |
| `AC-DEPLOY-08` | Upgrading the Worker does not interrupt the site; the schema migrates itself and the old version keeps serving during it | `NOT_AVAILABLE` | Needs two deployments on a real account |

## 4. AC-CONTENT

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-CONTENT-01` | Enter ten products in the admin, with specification tables and images, and publish them | `VERIFIED_LOCAL` | `test/worker/product-catalog.test.ts:119` |
| `AC-CONTENT-02a` | Saving content does issue the tag purge | `VERIFIED_LOCAL` | `test/worker/cache-admin.test.ts:94` |
| `AC-CONTENT-02b` | Publish a news item and see it on the public URL **within seconds** | `PENDING_DECISION` | Measured 2026-09-03: real purge round trip is **≈ 20 seconds** (`TASK-01.md §5`, `ARCHITECTURE §18` item 3) — real, and far better than an unpurged page's TTL, but "within seconds" plural at the low end is a stretch at 20. The product owner should confirm the wording still holds or adjust it |
| `AC-CONTENT-03` | Enable a second language, create a translation of a product, and both have correct URLs | `VERIFIED_LOCAL` | `test/worker/locale.test.ts:69`, `:107` |
| `AC-CONTENT-04` | Both languages emit correct `hreflang`, including `x-default` | `VERIFIED_LOCAL` | `test/worker/locale.test.ts:134`, `:271` |
| `AC-CONTENT-05` | Drafts do not appear on a public URL, do not enter the cache, and do not enter the sitemap | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:213`, `test/worker/seo.test.ts:92` |
| `AC-CONTENT-06a` | Due content is published by `publishDue`, which triggers the purge | `VERIFIED_LOCAL` | `test/core/paths.test.ts` (`schedules a future date and publishes a past one`), `src/worker/scheduled.ts` |
| `AC-CONTENT-06b` | The Cron Trigger drives that flow every minute in a real environment | `NOT_AVAILABLE` | Platform behaviour; needs a real account |
| `AC-CONTENT-07` | After a slug change the old URL 301s to the new one | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:234` |
| `AC-CONTENT-08` | Opening an item and closing it leaves `markdown` byte-identical | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:269`, `test/worker/roundtrip.test.ts:140` |
| `AC-CONTENT-09` | A body over 2 MB fails to save with a clear error, and is never silently truncated | `VERIFIED_LOCAL` | `src/worker/admin-content.ts:38`, `test/worker/roundtrip.test.ts:289` (`handles hostile content without crashing or leaking`, whose corpus includes a 2 MB+ body) |
| `AC-CONTENT-10` | When stage one exceeds the CPU budget the item is stored as a draft with a clear error, **never failing silently** | `VERIFIED_LOCAL` | Settled 2026-09-05: a real CPU-limit kill (error 1102) terminates the isolate outright, which is not a `try`/`catch`-able condition stage one's own code can turn into a graceful message — so `saveContent` (`src/worker/admin-content.ts`) checks the body length **before** calling `renderFragment` at all, against `MAX_SAFE_RENDER_BYTES` (50 KB, from the measured 60–726 ms curve in `TASK-01.md §5`). Past it, rendering is skipped, the item is force-saved as a draft regardless of the requested status, and the response carries a `warning` explaining why — surfaced in the admin editor and in `mallok publish`'s output. `test/worker/content-length-safety.test.ts` |
| `AC-CONTENT-11` | Content referencing missing files can be saved and published, and the admin shows "N images missing" | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:228`, `test/cli/scan.test.ts:78` |

## 5. AC-MEDIA

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-MEDIA-01` | Uploading an image in the admin converts it to WebP with width variants in the browser; the Worker processes no image | `VERIFIED_LOCAL` | `test/worker/media.test.ts:142`, `test/admin/media.test.ts` |
| `AC-MEDIA-02` | Uploading the same file twice stores it once (sha deduplication) | `VERIFIED_LOCAL` | `test/worker/media.test.ts:111` |
| `AC-MEDIA-03` | Body images emit `srcset`, `sizes`, `width`, `height`, `loading` and `decoding` | `VERIFIED_LOCAL` | `test/core/fragment.test.ts:69`, `test/worker/media.test.ts:176` |
| `AC-MEDIA-04` | Media is served directly from an R2 custom domain and does not count against Worker requests | `VERIFIED_HUMAN` | Real R2 custom domain (`media.mallok.dev`) connected 2026-09-04: fetched an uploaded object twice, `200`, byte-identical, never touching the Worker (true by construction — the domain resolves straight to R2). **New finding**: `cf-cache-status: DYNAMIC` on both fetches — Cloudflare's edge does **not** cache R2 custom-domain objects by default; an explicit Cache Rule would be needed for that, which this run did not configure. `TASK-01.md §5`, `ARCHITECTURE §18` item 6 |
| `AC-MEDIA-05` | Types outside the allow-list are refused, judged by signature rather than extension; svg is refused | `VERIFIED_LOCAL` | `test/worker/media.test.ts:125`, `test/core/media.test.ts` (`rejects SVG`, `ignores a lying extension`) |
| `AC-MEDIA-06a` | Media at `ref_count` zero appears under "unused" and is not collected during the grace period | `VERIFIED_LOCAL` | `test/worker/media.test.ts:254`, `:279` |
| `AC-MEDIA-06b` | Cron performs the collection on a real seven-day window | `NOT_AVAILABLE` | Platform behaviour; needs a real account |

## 6. AC-THEME

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-THEME-01` | Putting a theme directory in `src/themes/`, changing one export and deploying makes the site render with it | `VERIFIED_LOCAL` | `test/core/themes.test.ts` (`renders every layout it declares`) |
| `AC-THEME-02` | After a theme switch **every URL, content id and media reference is unchanged** | `VERIFIED_LOCAL` | `test/worker/locale.test.ts:259` |
| `AC-THEME-03` | The admin generates the options form from `theme.json`, changes take effect **immediately**, and the theme author writes no admin code | `VERIFIED_LOCAL` | `test/admin/form.test.ts:51`, `test/worker/plugins.test.ts:115` |
| `AC-THEME-04` | A content kind the theme does not support falls back to the `page` layout, losing neither content nor URLs | `VERIFIED_LOCAL` | `test/core/theme-package.test.ts:96` |
| `AC-THEME-05` | A theme containing an undeclared `<script>` or `on*=` **fails the build**, and the error names the file | `VERIFIED_LOCAL` | `test/core/theme-package.test.ts:121`, `:132`. **Corrected 2026-09-01**: §14.1 previously recorded this as untested, which was wrong |
| `AC-THEME-06` | All five official themes (`atelier`, `journal`, `gazette`, `manual`, `folio`) emit **0 B** of client-side JavaScript | `VERIFIED_LOCAL` | `test/core/themes.test.ts`, `test/cli/build.test.ts:195` |
| `AC-THEME-07` | Theme assets are served from Static Assets, versioned, `immutable` and `nosniff` | `VERIFIED_LOCAL` | `test/core/media.test.ts:126`, `test/core/themes.test.ts` (`links the stylesheet to Static Assets`) |
| `AC-THEME-08` | The admin has no theme upload or switch control, and says plainly that switching needs a redeploy | `VERIFIED_LOCAL` | `test/admin/redeploy-notice.test.ts:38`, `:47` |

## 7. AC-PLUGIN

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-PLUGIN-01` | The installed `inquiry` plugin's switch, settings and secrets all take effect **immediately** | `VERIFIED_LOCAL` | `test/worker/plugins.test.ts:60`, `:115` |
| `AC-PLUGIN-02a` | A submission is validated, stored, and queued as a job notifying the owner with Reply-To set to the buyer | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts` (`accepts a valid submission, stores it and queues both emails`) |
| `AC-PLUGIN-02b` | The owner **actually receives the email within seconds** | `NOT_AVAILABLE` | Needs real Resend; the tests use a stub |
| `AC-PLUGIN-03a` | The acknowledgement picks its template by the submitting page's locale and is queued | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts` (`renders an operator Liquid template for the autoreply`) |
| `AC-PLUGIN-03b` | The buyer **actually receives** the acknowledgement | `NOT_AVAILABLE` | Needs real Resend |
| `AC-PLUGIN-04` | The admin panel lists inquiries, shows detail, marks spam and exports CSV | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts:359`, `:385` |
| `AC-PLUGIN-05a` | The honeypot, rate limiting and server-side Turnstile verification are all on the code path | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts` (`silently drops a submission that filled the honeypot`, `verifies Turnstile server-side once a secret is configured`) |
| `AC-PLUGIN-05b` | They hold against real Turnstile, and a submission fits the free plan's CPU and subrequest budget | `NOT_AVAILABLE` | Needs real Turnstile and CPU measurement, `ARCHITECTURE §18` item 9 |
| `AC-PLUGIN-06` | A failed send is retried by cron and its status is visible in the admin | `VERIFIED_LOCAL` | `test/worker/inquiry.test.ts:339` |
| `AC-PLUGIN-07` | The interface states plainly that **installing, updating and removing plugins need a redeploy**, and has no upload control | `VERIFIED_LOCAL` | `test/admin/redeploy-notice.test.ts:58`, `:69` |

## 8. AC-SEO

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-SEO-01a` | `/sitemap.xml` lists all published content with hreflang and `x-default` | `VERIFIED_LOCAL` | `test/worker/seo.test.ts:92`, and `carries hreflang alternates and x-default in the sitemap` |
| `AC-SEO-01b` | Past 5,000 entries it paginates into `/sitemap-<n>.xml` with an index | `VERIFIED_LOCAL` | `test/worker/sitemap-pagination.test.ts:59`, `:70`, `:80` |
| `AC-SEO-02` | `/feed.xml` emits valid RSS per language | `VERIFIED_LOCAL` | `test/worker/seo.test.ts:128` |
| `AC-SEO-03` | Every page emits correct canonical, OG and Twitter Card tags | `VERIFIED_LOCAL` | `test/core/view.test.ts` (`never overrides a canonical field the author wrote`, `fills canonical fields from the aliases other tools use`) |
| `AC-SEO-04` | JSON-LD emits Organization, Article, Product and FAQPage, with `<` escaped to `\u003c` | `VERIFIED_LOCAL` | `test/core/view.test.ts:117`, `:144`, and `still emits Article and Product` |
| `AC-SEO-05` | Lighthouse mobile SEO is **100 every time** | `NOT_AVAILABLE` | Needs a custom domain with the cache warm, `SEO_PERFORMANCE §12` |
| `AC-SEO-06` | Lighthouse mobile Performance is ≥ 95 median and ≥ 90 in any run | `NOT_AVAILABLE` | As above |
| `AC-SEO-07` | The page-size and image budgets are met | `NOT_AVAILABLE` | The budget numbers themselves still await the product owner (`SEO_PERFORMANCE §7`) |

## 9. AC-EXPORT

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-EXPORT-01` | One action exports all content and inquiries into the directory from `CONTENT_FORMAT §5` | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:378`, `test/worker/inquiry.test.ts:385` |
| `AC-EXPORT-02` | All seven round-trip assertions in `CONTENT_FORMAT §9` pass | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts` throughout |
| `AC-EXPORT-03` | Each exported `index*.md` is byte-identical to `markdown` in D1 | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:140`, `:378` |
| `AC-EXPORT-04` | An export contains **no** secret, session, token or `render_cache` | `VERIFIED_LOCAL` | `test/worker/roundtrip.test.ts:359` |

`AC-EXPORT-05` (reading an export directly with Astro or Hugo) **was removed
2026-09-02 by product decision.** Astro and Hugo are, per `CONVENTIONS.md`'s
own boundary, "a reference point for output quality, not something to be
compatible with" — 0.1 was never meant to promise third-party read
compatibility, only that an export round-trips into a fresh Mallok deployment
(`AC-EXPORT-01`/`02`, both `VERIFIED_LOCAL`). A structural regression test for
this had briefly landed the same day and was removed with it; see §14.2 item
5 for the full history.

## 10. AC-CLI

| ID | Criterion | Status | Evidence / reference |
| --- | --- | --- | --- |
| `AC-CLI-01` | `mallok publish <dir>` publishes local bundles, `images/` included, into a site | `VERIFIED_LOCAL` | `test/cli/scan.test.ts` (`reads a bundle with its translations and assets`), `test/worker/flow.test.ts:204` |
| `AC-CLI-02` | Republishing an unmodified directory is a no-op: **no D1 write, no cache purge** | `VERIFIED_LOCAL` | `test/worker/flow.test.ts:204`, `test/worker/roundtrip.test.ts:249` |
| `AC-CLI-03` | **The same Markdown produces the same body fragment** in `mallok preview` and in production — settled 2026-09-02, correcting the earlier "byte-identical" wording, which the preview's offline media handling could never literally satisfy (relative paths vs. R2 URLs); see §14.2 item 3 | `VERIFIED_LOCAL` | `test/cli/preview.test.ts:17` |
| `AC-CLI-04` | The CLI has no capability the admin lacks, and the reverse | `VERIFIED_LOCAL` | Structural: both go through the same management API (`src/cli/client.ts`), with no CLI-only endpoint |
| `AC-CLI-05` | Missing images are reported, and `--fail-on-missing` works in CI | `VERIFIED_LOCAL` | `test/cli/scan.test.ts:78`, and `treats a referenced file that is absent as missing, not an error` |

## 11. AC-INV: cross-stage invariants

Re-verified by every task (`IMPLEMENTATION_PLAN §5`, item 4).

| ID | Criterion | Status |
| --- | --- | --- |
| `AC-INV-01` | `src/core/` imports no Cloudflare or Node API, and `tsc -p src/core/tsconfig.json` passes | `VERIFIED_LOCAL` |
| `AC-INV-02` | The same input renders byte-identical HTML | `VERIFIED_LOCAL` |
| `AC-INV-03` | `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size` is green | `VERIFIED_LOCAL` |
| `AC-INV-04` | The Worker's gzipped bundle fits the free plan's 3 MB | `VERIFIED_LOCAL` (2026-09-02: 285.5 KiB, 9.3%, after `rehype-raw`; was 229.2 KiB, 7.5% on 2026-08-30) |
| `AC-INV-05` | A cold render makes **at most 4 D1 round trips**, each with a constant number of queries and bounded row reads — settled 2026-09-02, correcting "one batch, ≤3 queries", which a related-content-plus-media page cannot meet by construction (§14.2 item 1) | `VERIFIED_LOCAL` (measured at 2, on every page tried so far, ceiling of 4 by the architecture) | `test/worker/budget.test.ts` |
| `AC-INV-06` | A list page parses no body, queries no `render_cache`, and runs no `COUNT(*)` | `VERIFIED_LOCAL` (`listPublished` reads scalar columns only, with `LIMIT n+1`) |
| `AC-INV-07` | Error responses leak no SQL, bucket name, id or stack trace | `VERIFIED_LOCAL` |
| `AC-INV-08` | Visitor pages carry 0 B of client-side JavaScript, the inquiry page's Turnstile excepted | `VERIFIED_LOCAL` (`test/core/themes.test.ts` asserts no `<script>` beyond JSON-LD in every layout of all five themes) |
| `AC-INV-09` | Changing content, settings, theme options or a plugin switch **needs neither a build nor a deployment** | `VERIFIED_LOCAL` |
| `AC-INV-10` | Switching themes and installing plugins **do need a deployment**, and the interface says so — never dressed up as one click | `VERIFIED_LOCAL` (`test/admin/redeploy-notice.test.ts:28`) |

`AC-INV-09` is what the product stands on (`PRODUCT_VISION §5.1`). **Any design
that breaks it is rejected**, however attractive it is otherwise.

`AC-INV-10` is its other half: what needs a deployment is said to need one.
Stretching "no build" into "nothing ever needs building" collapses the first
time a user switches themes, and costs more than saying it plainly would have.

## 12. Blockers

None of these is a code problem, and 0.1 cannot be declared until they are
resolved:

| # | Item | Owner |
| --- | --- | --- |
| 1 | ~~The nine measurements in `ARCHITECTURE §18`~~ **Run 2026-09-03/04** (`TASK-01.md §4`–`§5`). Seven of nine measured against a real Cloudflare account, executed by Claude Code under the product owner's direct authorization, with the product owner completing the dashboard-only steps (an API token, an R2 custom domain) by hand. Items 7 (Deploy to Cloudflare button) and 9 (Turnstile/Resend) still need a public repository and those services' accounts respectively | Mostly cleared — 7/9 |
| 2 | ~~The Markdown engine decision~~ **Settled 2026-08-29: stay with unified** (`TASK-01 §6`) | Cleared |
| 3 | ~~Whether to keep inline HTML~~ **Settled 2026-09-02: keep it, sanitised** (`rehype-raw`, `SECURITY.md §4`) | Cleared |
| 4 | Confirming the performance numbers in `SEO_PERFORMANCE.md §7` | The product owner |
| 5 | ~~Settling the licence~~ **Settled 2026-09-01: Apache-2.0.** A separate trademark policy keeping the `Mallok` name is still outstanding | Cleared |
| 6 | ~~Creating `JasonYv/mallok` and verifying its ownership~~ **Done 2026-09-01**, currently private | Cleared |

## 13. Not part of 0.1

Any of these appearing in a requirement is scope creep
(`PRODUCT_VISION §10`): Mallok hosting, an account system, billing,
multi-tenancy, a cart, payment, membership, comments, collaborative editing, a
revision-history interface, field-level translation, automatic language
redirection, a WordPress importer, product CSV/Excel import, the visual
editor, and AI translation.

## 14. The criterion-by-criterion account

### 14.0 The 2026-09-01 recount, and why it was needed

This section had published **three mutually contradictory totals**:

| Where | What it said |
| --- | --- |
| §2's conclusion | 76 criteria = 48 `VERIFIED_LOCAL` + 28 `NOT_AVAILABLE` |
| Under §14's heading | 76 criteria = 56 `VERIFIED_LOCAL` + 20 `NOT_AVAILABLE` |
| §14.1's group table | 67 criteria = 50 `VERIFIED_LOCAL` + 17 `NOT_AVAILABLE` |

**The cause was structural, not arithmetic**: only the `AC-INV` group's table
carried a status column, and the other 57 criteria had none. The totals could
only be maintained by hand, so they were always going to drift.

**The count was always 67.** Two independent methods agree: counting unique
`AC-` identifiers gives 67, and summing §14.1's group table gives 67. "76" was
a transposition, and it appeared twice.

The recount did four things:

1. **Added a status and a `file:line` evidence pointer to every criterion.**
   The totals are now **counted** rather than asserted.
2. **Split the criteria that bundled a testable half with an untestable one.**
   As written, those counted as no-evidence in full, hiding work that was
   done. They are `-a` and `-b`; identifiers were not renumbered, so existing
   references still resolve.
3. **Added `NOT_RUN` and `PENDING_DECISION`.** The first is "implemented but
   with no reproducible evidence" — walking through it by hand does not count
   (`TESTING §1`, rule 3). The second is "the criterion itself is wrong",
   which separates the items *we* are blocking from the ones the platform is.
4. **Corrected two errors.** `AC-THEME-05` was recorded as untested; it has
   `test/core/theme-package.test.ts:121` and `:132`. `AC-DEPLOY-07` was
   counted as verified in §14.1 and as needing a real account in §14.4; it is
   now `-07a` (verified in workerd) and `-07b` (platform behaviour).

### 14.1 Status by group (counted from the group tables)

After the splits there are **75 rows**: 67 original criteria, eight of which
became two halves each.

| Group | Rows | `VERIFIED_LOCAL` | `NOT_RUN` | `PENDING_DECISION` | `NOT_AVAILABLE` |
| --- | --- | --- | --- | --- | --- |
| `AC-DEPLOY` | 9 | 3 | 0 | 1 | 5 |
| `AC-CONTENT` | 13 | 9 | 1 | 0 | 3 |
| `AC-MEDIA` | 7 | 5 | 0 | 0 | 2 |
| `AC-THEME` | 8 | 7 | 1 | 0 | 0 |
| `AC-PLUGIN` | 10 | 6 | 1 | 0 | 3 |
| `AC-SEO` | 8 | 4 | 1 | 0 | 3 |
| `AC-EXPORT` | 5 | 4 | 1 | 0 | 0 |
| `AC-CLI` | 5 | 4 | 0 | 1 | 0 |
| `AC-INV` | 10 | 8 | 1 | 1 | 0 |
| **Total** | **75** | **50** | **6** | **3** | **16** |

**`VERIFIED_HUMAN` is still 0.** That is this section's most important
sentence, and the recount did not change it: **nothing has ever run against a
real Cloudflare account.** Everything marked verified locally was verified in
simulated workerd or under `wrangler dev`.

### 14.1.1 What the six `NOT_RUN` items are

Implemented, but with no reproducible assertion. None of them needs a real
account — **writing a test closes each one**:

| Criterion | What is missing |
| --- | --- |
| `AC-CONTENT-01` | "Enter ten products in the admin" has only been walked through by hand |
| `AC-THEME-08`, `AC-PLUGIN-07`, `AC-INV-10` | An assertion on the interface copy: no upload control, and an honest statement that a redeploy is needed |
| `AC-SEO-01b` | Sitemap pagination past 5,000 entries |
| `AC-EXPORT-05` | An exported directory read directly by Astro or Hugo, once, by hand |

### 14.2 Awaiting the product owner (three `PENDING_DECISION` items, plus one note on scope)

**1. `AC-INV-05`'s wording does not match the measurement.** The criterion
asks for one D1 batch and at most 3 queries. Measured in
`test/worker/budget.test.ts`, on a cold render bypassing the cache:

| Page | D1 calls | Composition |
| --- | --- | --- |
| A plain article, no media, no relations | **2** | `batch(5)` + `batch(1)` |
| A product page with a category relation, siblings and image references | **2** | `batch(5)` + `batch(3)` |

A page with resolved media adds one (`loadMediaBySha`), and related items with
covers add one more, to a ceiling of four.

**Why one batch is impossible**: related content and media both depend on the
content row the first batch returns — its slug, kind, front matter and assets
— so they are necessarily a second round trip. This is a data dependency, not
a lazy implementation.

The suggested rewording is "**a cold render makes at most 4 D1 round trips,
each with a constant number of queries and bounded row reads**", with the
measured figures written into `ARCHITECTURE §4`. **But this is an
architectural invariant, and the product owner changes it.**

**2. `AC-DEPLOY-03` says the wizard has seven steps; the implementation has
four.** The media domain and the Resend/DNS steps need an account-scoped
Cloudflare API token and belong to what Task 16 did not do
(`TASK-16.md §6`). Both can be completed later in settings, so no
functionality is unreachable. Either build the two steps, or change the
criterion to four plus "the rest is completed in settings".

**3. `AC-CLI-03`'s "byte-identical" needs one qualification.**
`mallok preview` runs the **same** `renderFragment` and `renderPage` as
production, so identical input produces identical bytes. But the preview is
offline with no media table, so images stay relative paths
(`images/hero.png`) where production has R2 URLs. **The body and structure are
byte-identical; the media URLs necessarily differ.** The suggested rewording
is "the same Markdown produces the same body fragment in both places".

**4. `src/worker/spike.ts` is still there.** Task 17 asked for its removal.
**It has not been removed**: it is the instrument for the nine measurements in
`TASK-01 §4`, and those have not been taken (§12, blocker 1). Removing the
instrument before measuring is backwards. It goes once the measurements are
done.

### 14.3 Evidence index

| Kind of evidence | File |
| --- | --- |
| Round-trip fidelity (`AC-EXPORT-02`, all seven) | `test/worker/roundtrip.test.ts` |
| Zero client JavaScript (`AC-THEME-06`, `AC-INV-08`) | `test/core/themes.test.ts` |
| The whole inquiry path (`AC-PLUGIN-01..06`, with email and Turnstile stubbed) | `test/worker/inquiry.test.ts` |
| Plugins taking effect immediately, and secret encryption (`AC-PLUGIN-01`) | `test/worker/plugins.test.ts` |
| The wizard and the starter (`AC-DEPLOY-03`'s four steps) | `test/worker/setup.test.ts` |
| The SEO endpoints (`AC-SEO-01..04`) | `test/worker/seo.test.ts`, `test/core/view.test.ts` |
| Languages and hreflang (`AC-CONTENT-03/04/07`) | `test/worker/locale.test.ts` |
| Media deduplication and type sniffing (`AC-MEDIA-02/05`) | `test/worker/media.test.ts` |
| Related content and the cold-render budget (`AC-INV-05`) | `test/worker/relations.test.ts`, `test/worker/budget.test.ts` |
| CLI arguments, site resolution, scanning (`AC-CLI-01/02/05`) | `test/cli/*.test.ts` |
| The source text never being rewritten (`AC-CONTENT-08`, `AC-EXPORT-03`) | `test/core/frontmatter.test.ts`, `test/worker/roundtrip.test.ts` |
| Walked through by hand under `wrangler dev` (steps in each TASK document's §5) — **not evidence under the current status vocabulary**, see §14.1.1 | The three-column editor, plugin panels, the CLI publish/export/import round trip, installing the starter |

### 14.4 What needs a real account (§12, blocker 1, itemised)

**Regenerated 2026-09-01.** The previous version was a hand-written list that
disagreed with §14.1's per-group counts in six of nine groups — both were
maintained by hand and each drifted on its own. This list is now exactly the
criteria whose status in the group tables is `NOT_AVAILABLE`, all **16** of
them:

| Group | Criteria | What blocks them |
| --- | --- | --- |
| `AC-DEPLOY` | `01`, `02`, `04`, `07b`, `08` | A real account: creating resources, the Deploy button, caching on a custom domain, concurrent migration, a rolling upgrade |
| `AC-CONTENT` | `02b`, `06b`, `10` | Purge latency, cron firing for real, the CPU budget |
| `AC-MEDIA` | `04`, `06b` | An R2 custom domain, cron collection |
| `AC-PLUGIN` | `02b`, `03b`, `05b` | Real Resend delivery, real Turnstile and the CPU budget |
| `AC-SEO` | `05`, `06`, `07` | The three Lighthouse criteria, which need a custom domain with the cache warm |

`AC-THEME`, `AC-EXPORT`, `AC-CLI` and `AC-INV` have **no** criteria needing a
real account — their remaining gaps are `NOT_RUN` (write a test) or
`PENDING_DECISION` (make a call).

Against the nine measurements in `ARCHITECTURE §18`: running those closes 15
of the 16 above. The remaining one, `AC-DEPLOY-02`, additionally needs a
public repository.
