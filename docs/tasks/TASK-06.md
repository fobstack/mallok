# Task 06 — Multiple locales

- Status: **complete**, all checks green locally
- Date: 2026-08-29
- Scope: enabling locales, translation groups, per-locale home and list pages,
  hreflang everywhere it belongs, and changing which locale lives at the root.
- Contract: `docs/ARCHITECTURE.md §9`, `docs/SEO_PERFORMANCE.md §4`.

## 1. Demonstrable loop

> Enable a second locale → publish a translation → each version has its own
> URL and they point at each other with `hreflang` → change the default locale
> → **every URL swaps and every old URL 301s to its new home**.

## 2. What was already there

Task 01 shipped more of this than the plan assumed. `buildPublicPath` and
`parsePublicPath` already handled the prefix rule, `content` already carried
`locale` and `translation_group`, cache tags were already per-locale, and
content pages already emitted `hreflang` with `x-default`. This task filled
the three gaps that were left.

## 3. What changed

| Gap | Fix |
| --- | --- |
| List pages emitted no `hreflang` | `renderListPage` now builds alternates for every enabled locale, since each one shows the same list under its own prefix. |
| Changing the default locale returned `501` | `POST /_mallok/api/settings/default-locale` recomputes every path, records a 301 for each, and then moves the setting. |
| The editor could not tell which translations exist | `GET /_mallok/api/content/<id>` returns one entry per enabled locale, each marked `exists: true/false`. |

New queries in `src/db/queries.ts`: `listContentLocations`, `movePaths`,
`setDefaultLocale`, `listTranslationsOf`.

## 4. The ordering problem, and why it has no cycle

`content.path` is unique, so changing the default locale cannot simply update
every row: German's new path `/news/x` is English's current path.

The fix is ordering, not temporary paths. Only rows in the **old** default
locale gain a prefix, and only rows in the **new** default locale lose one —
two sets that are disjoint by locale. Moving the gaining rows first vacates
every bare path before anything claims it, so:

- no cycle is possible, unlike a general rename graph;
- each phase can be chunked freely (20 rows per D1 batch, 2 statements each),
  which matters because the Free plan allows 50 queries per batch call;
- a failure between phases leaves the site reachable — some URLs have moved
  and their redirects exist, the rest are untouched.

A temporary-path pass would have been the obvious alternative and is worse: it
makes every page unreachable in the window between the two phases.

## 5. Decisions worth recording

1. **Changing the default locale is its own endpoint and needs
   `"confirm": true`.** Sending `defaultLocale` to `PATCH /settings` now
   returns `409` naming the right endpoint, rather than silently rewriting a
   site's entire URL structure inside an ordinary settings save.
2. **Old URLs keep working.** Every move writes a 301, so an external link
   made before the switch still resolves. This is the same mechanism that
   already covers slug changes.
3. **List pages are alternates of each other.** The base segment is shared
   across locales (`ARCHITECTURE §9`), so `/news` and `/de/news` are the same
   page in two languages and must say so.
4. **`x-default` follows the default locale** automatically, because it is
   derived from `settings.defaultLocale` at render time rather than stored.

## 6. Evidence

Environment: Node 22.22.2, workerd via `@cloudflare/vitest-pool-workers`
0.22.0, macOS 24.6.0, vitest 4.1.11.

```
pnpm lint        → exit 0
pnpm typecheck   → exit 0
pnpm test        → exit 0   (12 files, 140 tests)
pnpm build       → exit 0
pnpm bundle:size → exit 0   (783.1 KiB raw, 207.6 KiB gzip, 6.8% of the Free limit)
```

All of the following are in `test/worker/locale.test.ts`:

| Requirement | Status |
| --- | --- |
| A second locale can be enabled | `VERIFIED_LOCAL` |
| Dropping the current default locale is refused | `VERIFIED_LOCAL` |
| Default locale has no prefix; others do | `VERIFIED_LOCAL` |
| A locale the site has not enabled is refused | `VERIFIED_LOCAL` |
| Content pages carry `hreflang` both ways plus `x-default` | `VERIFIED_LOCAL` |
| Each locale has its own home page and cache tag | `VERIFIED_LOCAL` |
| Each locale has its own list page, with `hreflang` and only its own content | `VERIFIED_LOCAL` |
| The editor sees which locales exist and which would be new | `VERIFIED_LOCAL` |
| Changing the default locale requires explicit confirmation | `VERIFIED_LOCAL` |
| An unenabled target locale is refused | `VERIFIED_LOCAL` |
| **Every URL swaps and every old URL 301s** | `VERIFIED_LOCAL` |
| Content ids and translation groups survive the swap | `VERIFIED_LOCAL` |
| `x-default` moves with the default locale | `VERIFIED_LOCAL` |
| Setting the current default again is a no-op | `VERIFIED_LOCAL` |

### Cross-stage invariants (`ACCEPTANCE.md §11`)

`AC-INV-01`, `-02`, `-03`, `-04` (207.6 KiB gzip), `-07`, `-09`:
`VERIFIED_LOCAL`.

## 7. Not done, and why

- **Per-locale feeds** are part of the SEO endpoints (Task 05), which waits on
  the purge-strategy measurement in gate A.
- **The sitemap's `hreflang`** is likewise Task 05; the `<head>` half is done.
- **No language switcher in the bundled theme.** `journal` is a single-language
  theme by design; `content.translations` is in the view contract and `trade`
  (Task 09) is what will render a switcher.
- **No admin UI** for any of this (Task 11).
- **Automatic translation** is 0.2, as an `onContentSave` plugin
  (`PRODUCT_VISION §9`).

## 8. Known risks

1. **The default-locale swap is not atomic across chunks.** Interrupting it
   leaves some URLs moved and some not; both remain reachable because each
   moved row has its redirect, but the site is briefly inconsistent. Re-running
   the endpoint finishes the job, since already-correct rows produce no move.
2. **It reads the whole `content` table.** That is the one place in the code
   that does, and it is bounded only by how much content a site has. For a
   site with tens of thousands of rows this needs paging before it is safe;
   nothing warns about that yet.
3. **Redirect rows accumulate.** Each swap adds one per content item, and the
   cron only collects redirects whose content was deleted
   (`DATA_MODEL.md §4`). Swapping back and forth would leave stale rows.
