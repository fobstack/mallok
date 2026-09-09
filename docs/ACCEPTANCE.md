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
| `AC-CONTENT-02b` | Publish a news item and see it on the public URL **within a minute** — settled 2026-09-06, correcting "within seconds", which a 20-second real purge round trip could not honestly claim; see §14.2 item 6 | `VERIFIED_HUMAN` | Measured 2026-09-03: real purge round trip is **≈ 20 seconds** (`TASK-01.md §5`, `ARCHITECTURE §18` item 3) — comfortable margin under a minute, and far better than an unpurged page's TTL |
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
| 6 | ~~Creating `FobStack/mallok` and verifying its ownership~~ **Done 2026-09-01**, currently private | Cleared |

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

**2026-09-02 addendum**: the count below moved from 67 to 66 active
criteria — not another counting bug, a product decision. `AC-EXPORT-05`
was removed; see §14.2 item 5.

### 14.1 Status by group (counted from the group tables)

After the splits, the 2026-09-02 removal of `AC-EXPORT-05`, that day's three
wording decisions (§14.2), the 2026-09-03/04 Gate A run against a real
account (`docs/tasks/TASK-01.md §5`), the 2026-09-05 length-based safety net
for `AC-CONTENT-10`, and the 2026-09-06 purge-latency wording for
`AC-CONTENT-02b`, there are **74 rows**: 66 active criteria, eight of which
became two halves each.

| Group | Rows | `VERIFIED_LOCAL` | `VERIFIED_HUMAN` | `NOT_RUN` | `PENDING_DECISION` | `NOT_AVAILABLE` |
| --- | --- | --- | --- | --- | --- | --- |
| `AC-DEPLOY` | 9 | 4 | 3 | 0 | 0 | 2 |
| `AC-CONTENT` | 13 | 11 | 1 | 0 | 0 | 1 |
| `AC-MEDIA` | 7 | 5 | 1 | 0 | 0 | 1 |
| `AC-THEME` | 8 | 8 | 0 | 0 | 0 | 0 |
| `AC-PLUGIN` | 10 | 7 | 0 | 0 | 0 | 3 |
| `AC-SEO` | 8 | 5 | 0 | 0 | 0 | 3 |
| `AC-EXPORT` | 4 | 4 | 0 | 0 | 0 | 0 |
| `AC-CLI` | 5 | 5 | 0 | 0 | 0 | 0 |
| `AC-INV` | 10 | 10 | 0 | 0 | 0 | 0 |
| **Total** | **74** | **59** | **5** | **0** | **0** | **10** |

**`VERIFIED_HUMAN` was 0 from 2026-08-28 until 2026-09-03/04.** Gate A
(`ARCHITECTURE §18`, `TASK-01.md §4`–`§5`) ran for real against a Cloudflare
account for the first time and gave four criteria genuine real-account
evidence: `AC-DEPLOY-01` (`mallok create` end to end — which also surfaced and
fixed a real deploy-breaking bug), `AC-DEPLOY-04` (cache on a custom domain),
`AC-DEPLOY-07b` (migration concurrency on real infrastructure) and
`AC-MEDIA-04` (R2 custom domain serving). Two criteria briefly moved from
`NOT_AVAILABLE` to `PENDING_DECISION` because the run produced real numbers
that called the wording itself into question rather than simply confirming
it: `AC-CONTENT-02b` (purge propagation measured at ≈ 20 seconds, not
obviously "seconds") and `AC-CONTENT-10` (stage-one CPU measured at 6×–73×
the budget, with no code path that caught an overrun and stored a draft).
`AC-CONTENT-10` was settled and implemented 2026-09-05, a length-based check
ahead of rendering (§14.2 item 7); `AC-CONTENT-02b` was settled 2026-09-06,
reworded to "within a minute" and promoted straight to `VERIFIED_HUMAN` on
the same Gate A measurement (§14.2 item 6) — no `PENDING_DECISION` rows
remain. The remaining ten `NOT_AVAILABLE` criteria still need a public
repository (`AC-DEPLOY-02`), a second real deployment (`AC-DEPLOY-08`),
elapsed real time or cron (`AC-CONTENT-06b`, `AC-MEDIA-06b`), a Resend
account (`AC-PLUGIN-02b`, `03b`), Turnstile (`AC-PLUGIN-05b`), or Lighthouse
against a warm cache (`AC-SEO-05/06/07`). Everything still marked
`VERIFIED_LOCAL` was verified in simulated workerd or under `wrangler dev`,
not on real infrastructure.

### 14.1.1 The `NOT_RUN` items, closed 2026-09-02

Each was implemented but had no reproducible assertion. None needed a real
account, so each was closed by writing a test rather than by any product
decision — except the last, which was closed and then removed the same day
once it turned out the product decision behind it had never actually been
made:

| Criterion | What was missing | Closed by |
| --- | --- | --- |
| `AC-CONTENT-01` | "Enter ten products in the admin" had only been walked through by hand | `test/worker/product-catalog.test.ts:119` |
| `AC-THEME-08`, `AC-PLUGIN-07`, `AC-INV-10` | An assertion on the interface copy: no upload control, and an honest statement that a redeploy is needed | `test/admin/redeploy-notice.test.ts` |
| `AC-SEO-01b` | Sitemap pagination past 5,000 entries | `test/worker/sitemap-pagination.test.ts` |
| ~~`AC-EXPORT-05`~~ | An exported directory read directly by Astro or Hugo, once, by hand | Closed with a structural regression test, then the criterion itself was **removed** the same day — see §14.2 item 5 |

### 14.2 Decisions and their history

One decision is open (item 6), raised by the 2026-09-03/04 Gate A run.
Everything else here — three wording questions settled 2026-09-02, the
`AC-EXPORT-05` removal, and item 7's CPU-overrun handling, settled and
implemented 2026-09-05 — is closed history, kept for the record.

**1. `AC-INV-05`'s wording did not match the measurement — settled: reword
to match reality.** The criterion asked for one D1 batch and at most 3
queries. Measured in `test/worker/budget.test.ts`, on a cold render bypassing
the cache:

| Page | D1 calls | Composition |
| --- | --- | --- |
| A plain article, no media, no relations | **2** | `batch(5)` + `batch(1)` |
| A product page with a category relation, siblings and image references | **2** | `batch(5)` + `batch(3)` |

A page with resolved media adds one (`loadMediaBySha`), and related items with
covers add one more, to a ceiling of four.

**Why one batch is impossible**: related content and media both depend on the
content row the first batch returns — its slug, kind, front matter and assets
— so they are necessarily a second round trip. This is a data dependency, not
a lazy implementation. The criterion now reads "**at most 4 D1 round trips,
each with a constant number of queries and bounded row reads**" — the wording
above, adopted as-is.

**2. `AC-DEPLOY-03` said the wizard has seven steps; the implementation has
four — settled: reword to four plus Settings.** The media domain and the
Resend/DNS steps need an account-scoped Cloudflare API token and belong to
what Task 16 did not do (`TASK-16.md §6`); writing that code now would not
make it verifiable before Gate A either, the same position `mallok create` and
`destroy` are already in. Both remain reachable in Settings after the wizard
closes, so nothing is unreachable — only not part of the guided first run.
`ARCHITECTURE §15` and `ADMIN.md §5` were corrected to describe four steps.

**3. `AC-CLI-03`'s "byte-identical" needed one qualification — settled:
adopt the qualified wording.** `mallok preview` runs the **same**
`renderFragment` and `renderPage` as production, so identical input produces
identical bytes. But the preview is offline with no media table, so images
stay relative paths (`images/hero.png`) where production has R2 URLs. **The
body and structure are byte-identical; the media URLs necessarily differ.**
The criterion now reads "the same Markdown produces the same body fragment in
both places", and `test/cli/preview.test.ts` asserts it directly — the claim
had rested on both call sites sharing code, with nothing pinning that they
actually agreed on one input.

**4. ~~`src/worker/spike.ts` is still there.~~ Done 2026-09-03.** Task 17
asked for its removal; it stayed as the instrument for the nine measurements
in `TASK-01 §4` until they were actually taken. They have been — `TASK-01.md
§5` — so the file, its route in `src/worker/index.ts`, and the test that
exercised it (`test/worker/flow.test.ts`) were all removed the same day.

**5. `AC-EXPORT-05` (Astro/Hugo read compatibility) was removed, not
closed.** It was briefly closed 2026-09-02 with a structural regression test
in `test/worker/roundtrip.test.ts` — asserting the export uses `index.md`
(not `_index.md`), plain-YAML front matter and colocated images, which is
what Astro's page bundles and Hugo's leaf bundles require. Asked directly,
the product owner clarified the same day that this was never the intended
promise: **`CONVENTIONS.md`** already states Astro is "a reference point for
output quality, not something to be compatible with", and the bundle shape
(`index.md` plus `images/`) was chosen *because* it resembles that
convention, not to guarantee those specific tools can read it. The tested,
promised guarantee is narrower and already met: an export round-trips into a
fresh Mallok deployment byte-identically (`AC-EXPORT-01`/`02`). The test and
the criterion were both removed the same day — see `PRODUCT_VISION.md §5.2`
for the corrected wording.

**6. `AC-CONTENT-02b`'s "within seconds" — settled 2026-09-06: reword to
"within a minute".** Gate A measured the real purge round trip (save →
`purgeQueued: true` → the edit visible on a fresh request) at **≈ 20
seconds** (`TASK-01.md §5`). That is a huge improvement over an unpurged
page's TTL, and the purge mechanism itself works — but 20 seconds is a
stretch for what "seconds" plural usually implies, and treating it as an
optimisation target was not realistic: the 2-second debounce window in
`cache.ts` is a small fraction of the total, and the rest is Cloudflare's own
purge-API round trip and edge propagation, which Mallok does not control and
cannot promise to speed up. "Within a minute" is honest, carries real margin
against measurement variance across regions and load, and is still a
meaningfully differentiated promise against the static-generator
commit-build-redeploy cycle this product competes against. The existing Gate
A measurement already satisfies the reworded criterion, so it moves straight
to `VERIFIED_HUMAN` rather than needing a further run.

**7. `AC-CONTENT-10`'s CPU-overrun handling — settled 2026-09-05: a
pre-flight length check, option (a) below.** Real stage-one CPU measured at
60–726 ms across 2–128 KB of Markdown (`TASK-01.md §5`) — already past the
Free plan's 10 ms budget at every size tested, with no length that
guarantees a render fits (see the note below on what this measurement does
and does not prove). `src/worker/admin-content.ts` had no CPU-budget check at
all: nothing measured elapsed time or pre-estimated cost and stored a draft
with a clear message before rendering. A real overrun is Cloudflare's own
CPU-limit kill (error 1102), which terminates the isolate outright — not a
`try`/`catch`-able condition stage one's own code can turn into the promised
graceful draft, so the fix has to happen *before* rendering starts, not
around it. Two options were on the table: **(a) a pre-flight length check**
— reject or draft anything over a threshold before rendering, cheap to add,
adopted; **(b)** accept `markdown-it` or another faster engine
(`TASK-01.md §6`, `TECH_STACK.md §4`) so the budget is met in the first place
— a bigger change (plugin hook surface, sanitisation), left for a separate
decision.

**What was built**: `MAX_SAFE_RENDER_BYTES` (50 KB) in
`src/worker/admin-content.ts`. Past it, `renderFragment` is never called —
the item saves as a draft regardless of the requested status, nothing is
lost, and the response carries a `warning` field explaining why, surfaced in
the admin editor (`src/admin/pages/editor.tsx`) and in `mallok publish`'s
output (`src/cli/publish.ts`, `reportWarnings`).
`test/worker/content-length-safety.test.ts` covers both the oversized-draft
path and the normal-size regression case.

**One honest caveat on the underlying measurement**: while building this,
CPU behaviour was probed directly on the same real account Gate A used, with
a throwaway Worker doing fixed, deliberate CPU-bound work (not the
`Date.now()`-based approach tried first — wall-clock time does not advance
during synchronous execution in a Worker, which made that attempt
meaningless). That probe found the account tolerating roughly 700 ms–2
seconds of CPU before error 1102, not 10 ms, on a plan the product owner
confirmed is Workers Free. Current Cloudflare documentation states the Free
plan's CPU limit as a fixed, non-configurable 10 ms with no exceptions, which
this specific account's behaviour contradicts for reasons this session did
not chase down further. `MAX_SAFE_RENDER_BYTES` is deliberately sized off the
**documented** 10 ms figure regardless — Mallok deploys onto other people's
Cloudflare accounts, and there is no basis for assuming a typical new Free
signup shares whatever this one account's headroom comes from. The
throwaway probe Worker was deleted after use and left no trace in this
codebase.

### 14.2.1 The move onto `@fobstack/runtime` (2026-09-07)

The public request path was rebuilt on the group's page engine
(`docs/ARCHITECTURE.md §4`). `src/worker/public.ts` is gone; `src/worker/pages/`
replaces it. What was checked, and what changed:

| Behaviour | Result |
| --- | --- |
| D1 round trips, cold content render | 2 (`batch(5)` + `batch(1)`) — unchanged |
| D1 round trips, product page with relations | 2 (`batch(5)` + `batch(3)`) — unchanged |
| `Cache-Tag`, `x-mallok-cache`, `x-mallok-fragment` | byte-identical; pinned by `test/worker/flow.test.ts` |
| `Cache-Control` | **changed on purpose**, see §14.2.2 |
| `x-robots-tag: noindex` off the bound domain | preserved, now decided in `pages/context.ts` |
| 301 redirects for moved slugs | preserved, absolute `Location` |
| Drafts and scheduled items | still 404; the visibility rule is unchanged |
| Worker bundle | 284.5 → 288.9 KiB gzip (9.4% of the Free 3 MB limit) |
| **404 for an unknown public path** | **changed**: the theme's own page at status 404 with `x-robots-tag: noindex` and `Cache-Control: no-store`, instead of `{"error":"Not found."}`. Requested; `/_mallok/*` still answers JSON. |

`AC-INV-05` is unaffected: the speculative batch runs once per request in
`buildLocals`. The adapter builds locals once and hands them to the locale
resolver, so no deduplication is needed on Mallok's side.

Full gate on 2026-09-07: `pnpm lint && pnpm typecheck && pnpm test && pnpm
build && pnpm bundle:size && pnpm admin:size`, all green, 359 tests.

### 14.2.2 Pre-release hardening (2026-09-07)

Four defects found while preparing the first Runtime release. All four are
fixed, and each has a test that fails without the fix.

**1. A credentialed request could be served from the shared cache.** The
adapter decided cache eligibility from the *normalised* cache key rather than
the request. Mallok's key rebuilds the request without headers in order to
drop the query string, which meant a request carrying `Cookie` or
`Authorization` arrived at the check with its credentials already gone, and
was cached like any anonymous page. Eligibility is now decided from the
request as it arrived. Test: `runtime/test/adapter-cache-safety.test.ts`,
"cannot be laundered by a cacheKey that drops the headers" — before the fix it
returned `MISS`, i.e. the response to a `Bearer` request was stored.

**2. A page's own `private` / `no-store` was overwritten before it was
read.** The adapter set `Cache-Control` from the declared policy and only then
asked whether the response was storable — so it inspected the header it had
just written, never the page's. A page that answered `private` was stored as
`public`. Storability is now judged on the page's own response, and a response
that will not be stored never leaves with `public` or a `Cache-Tag`.

**3. Browser cache lifetime (`AC-CONTENT-02b`, related).** Public pages sent
`public, max-age=<ttl>`, giving the browser the same one-hour lifetime as the
edge. Purging by tag empties the edge but cannot reach a visitor's browser, so
an edit could be live at the edge and invisible to a returning visitor for up
to an hour. Now `public, max-age=0, s-maxage=<ttl>`. **This is a deliberate
change, not a regression**: "byte-identical to the old headers" was the wrong
goal for this one header. Hashed static assets keep their long browser
lifetime, because a change to them produces a new URL.

**4. Island scripts landed outside the document.** Mallok's themes emit the
whole `<html>`, and the document renderer appended island markup to the end of
the string — after `</html>`. Scripts are now inserted before the document's
own `</body>`, and a page that used no island is still returned byte-for-byte
unchanged (`AC-INV-08`). Test: `test/worker/islands-placement.test.ts`.

D1 round trips are now asserted exactly rather than merely counted
(`test/worker/budget.test.ts`): `['batch(5)', 'batch(1)']` for a cold content
page, `['batch(5)', 'batch(3)']` with relations, and `[]` on a page-cache hit.

### 14.2.3 Release-blocking cache and island fixes (2026-09-08)

Found while hardening the Runtime for its first release. Each has a test that
fails without the fix.

**1. `Cache-Control` was matched case-sensitively.** `Private`, `NO-STORE` and
`max-age=60, No-Store` all passed the "may this be shared?" check and were
stored. HTTP field values are case-insensitive; the check now is too.

**2. A bypassed response kept its `public` permission.** When a page declared
`public, max-age=3600` and was bypassed for some *other* reason — the request
carried credentials, the response set a cookie — the adapter simply left the
page's header alone. Nothing was written to our cache, so a `put()` count
looked clean, and the response still told the visitor's browser and every
intermediary that they could keep it. Such responses now leave with
`private, no-store` and no `Cache-Tag`.

**3. `HEAD` was treated as uncacheable.** It returned `private, no-store`,
never hit the cache, and sent a body. It now returns the `GET` headers with no
body, and reads the entry a `GET` stored.

**4. Island scripts pointed at the wrong file.** A page with islands linked the
island's own component chunk, which downloads the component and never mounts
it, and in a Worker build the URL was the *source* path. Pages now load one
hashed bootstrap that calls `mountIslands`; the Worker build gets the hashed
names through the plugin's `islandManifest` option. Mallok's own themes ship no
islands, so this never affected the live site.

**5. Island ids were cross-request state.** The `{% island %}` tag numbered
placeholders from a counter on the renderer instance, which is shared across
requests in a Worker isolate — so the same template and data rendered
different bytes each time. Props are now nested inside their own placeholder
and no id is minted at all.

Mallok's own consequences: the themed 404 now returns
`Cache-Control: private, no-store` (was `no-store`), and a request carrying a
cookie is served fresh rather than from the shared cache. Both are pinned in
`test/worker/flow.test.ts`.

### 14.2.4 What the Runtime migration did and did not re-verify (2026-09-09)

The public site moved onto `@fobstack/runtime` (§14.2.1–14.2.3). Every status
in the tables above was earned **before** that move, so this is the honest
account of which of them still stand on their original evidence.

**Unchanged, and re-verified locally.** `AC-INV-05`'s D1 round trips are still
`batch(5)` + `batch(1)` cold and `[]` on a cache hit; `Cache-Tag`,
`x-mallok-cache` and `x-mallok-fragment` are byte-identical; redirects, draft
and scheduled visibility, and the SEO endpoints are untouched. These are
`VERIFIED_LOCAL` and were `VERIFIED_LOCAL` before.

**Deliberately changed, and re-verified locally.** `Cache-Control` on a public
page is now `public, max-age=0, s-maxage=<ttl>` rather than
`public, max-age=<ttl>`, and an unknown path renders the theme's own 404. Both
are recorded in §14.2.1 and §14.2.2.

**Standing on pre-migration evidence, and not re-run.** Two `VERIFIED_HUMAN`
rows were measured against the previous handler and have **not** been measured
against the runtime path:

| Row | Original evidence | Status after the migration |
| --- | --- | --- |
| `AC-CONTENT-02b` | ≈ 20 s real purge round trip, 2026-09-03 | The `Cache-Tag` the runtime writes is byte-identical, so the purge path is unchanged *by construction* — but no real-account run has confirmed it. Treat the row's evidence as pre-migration |
| `ARCHITECTURE §18` CPU figures | 60–726 ms stage one, real workerd | Stage one is unchanged (it runs on save, not on the public path). The **public request path** is new and its CPU has been measured only in local workerd |

Neither is a regression anyone has observed; both are claims whose evidence
predates the code now serving them. They are listed in the release-gate
runbook (`docs/RELEASE_GATE.md`) as re-measurements, not as new work.

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
| A full product catalogue: specification tables and gallery images, entered and published (`AC-CONTENT-01`) | `test/worker/product-catalog.test.ts` |
| Sitemap pagination past 5,000 entries (`AC-SEO-01b`) | `test/worker/sitemap-pagination.test.ts` |
| No theme-switch or plugin-install control, and the honest copy saying so (`AC-THEME-08`, `AC-PLUGIN-07`, `AC-INV-10`) | `test/admin/redeploy-notice.test.ts` |
| Inline HTML sanitised and kept, not dropped (`SECURITY.md §4`, Gate B') | `test/core/fragment.test.ts` |
| `mallok preview` and production agreeing on one input (`AC-CLI-03`) | `test/cli/preview.test.ts` |
| Walked through by hand under `wrangler dev` (steps in each TASK document's §5) — **not evidence under the current status vocabulary**, see §14.1.1 | The three-column editor, plugin panels, the CLI publish/export/import round trip, installing the starter |
| `mallok create` end to end on a real account, including the bug it found (`AC-DEPLOY-01`) | `docs/tasks/TASK-01.md §5`, `src/cli/provision.ts`, `test/cli/provision.test.ts` |
| The Cache API on a real custom domain (`AC-DEPLOY-04`) | `docs/tasks/TASK-01.md §5` |
| Migration concurrency on real infrastructure, two independent runs (`AC-DEPLOY-07b`) | `docs/tasks/TASK-01.md §5` |
| An R2 custom domain serving real objects (`AC-MEDIA-04`) | `docs/tasks/TASK-01.md §5` |
| Oversized content saved as a draft without rendering, and a normal-size regression case (`AC-CONTENT-10`) | `test/worker/content-length-safety.test.ts` |

### 14.4 What still needs a real account (§12, blocker 1, itemised)

**Regenerated 2026-09-04, after Gate A.** Gate A ran for real 2026-09-03/04
(`docs/tasks/TASK-01.md §5`) and closed six of the sixteen criteria this
section used to list: four became `VERIFIED_HUMAN`
(`AC-DEPLOY-01`/`04`/`07b`, `AC-MEDIA-04`) and two became `PENDING_DECISION`
because the real numbers raised a wording or implementation question rather
than settling one (`AC-CONTENT-02b`, `AC-CONTENT-10` — see §14.2 items 6–7).
`AC-CONTENT-10` was settled and implemented the next day, 2026-09-05, and
`AC-CONTENT-02b` was settled 2026-09-06 (§14.2 item 6). They landed on
different statuses, and the difference matters: `AC-CONTENT-02b` is
`VERIFIED_HUMAN` because the 20-second purge round trip was measured on a real
account, while `AC-CONTENT-10` is `VERIFIED_LOCAL` — the length check that
settled it is covered by `test/worker/content-length-safety.test.ts`, and no
real-account run has exercised it. That is why the group table above totals
**5** `VERIFIED_HUMAN`, not 6. No `PENDING_DECISION` rows remain. This list is
exactly the criteria whose status in the group tables is still
`NOT_AVAILABLE`, all **10** of them — unaffected by either change, since
neither criterion was ever `NOT_AVAILABLE`:

| Group | Criteria | What still blocks them |
| --- | --- | --- |
| `AC-DEPLOY` | `02`, `08` | The Deploy to Cloudflare button needs a public repository; a rolling upgrade needs two real deployments |
| `AC-CONTENT` | `06b` | Cron firing for real (needs elapsed real time, not just a mocked clock) |
| `AC-MEDIA` | `06b` | Cron collection on a real seven-day window |
| `AC-PLUGIN` | `02b`, `03b`, `05b` | Real Resend delivery, real Turnstile, and the inquiry path's CPU/subrequest budget |
| `AC-SEO` | `05`, `06`, `07` | The three Lighthouse criteria, which need a custom domain with the cache warm |

`AC-THEME`, `AC-EXPORT`, `AC-CLI` and `AC-INV` have **no** criteria needing a
real account and none `PENDING_DECISION` either — every row in those four
groups is closed. `AC-DEPLOY-02` is the only one of the ten that Gate A's own
measurements could never have closed regardless — it needs a public
repository, which is a separate decision (§12, blocker 6 territory).
