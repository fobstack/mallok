# Task 05 — SEO endpoints

- Status: **complete except the gate-A write-back**, all checks green locally
- Date: 2026-08-29
- Scope: sitemap with hreflang and pagination, RSS per locale, robots.txt,
  host-based noindex, Product JSON-LD, render-cache garbage collection.
- Contract: `docs/SEO_PERFORMANCE.md §2–§5, §10`.

## 1. What changed

| Area | Files | Notes |
| --- | --- | --- |
| XML builders | `src/core/seo.ts` | Pure functions over plain data: sitemap, sitemap index, RSS 2.0, robots. Deterministic — the feed's `lastBuildDate` is the newest item's date, never "now". |
| Routes | `src/worker/seo-routes.ts` | `/sitemap.xml` (+ `/sitemap-N.xml` beyond 5000 URLs), `/feed.xml`, `/<locale>/feed.xml`, `/robots.txt`. Edge-cached under `sitemap` / `feed:<locale>` / `site` tags. |
| noindex | `src/worker/pages/context.ts` | Any host other than the bound domain gets `X-Robots-Tag: noindex`; with no domain bound, every host does. Robots on such hosts disallows everything. |
| JSON-LD | `src/core/view.ts` | `Product` (name, description, `sku` falling back to `grade`, url) joins the existing `Article` and `WebSite`. |
| GC | `src/db/queries.ts`, `src/worker/scheduled.ts` | The cron now drops `render_cache` rows from older pipeline versions and rows whose content is gone (`DATA_MODEL §4`). |

## 2. Decisions worth recording

1. **The sitemap query orders by `translation_group`**, so siblings arrive
   adjacent and hreflang grouping needs no second query. Row reads stay
   bounded at 5001 per request.
2. **Feeds carry `article` content only.** Products in RSS are noise for a
   trade site; a feed is a stream of writing.
3. **Feed items carry no full content**, only title/link/description/date —
   including bodies would cost a `render_cache` read per item.
4. **robots.txt is honest per host.** The open file with the Sitemap line is
   served only when the request host equals the bound domain; `.workers.dev`
   and unbound sites get `Disallow: /`. The cache key includes the origin, so
   the two variants can never leak into each other — there is a test for it.
5. **`FAQPage` and `Organization` JSON-LD wait.** No bundled theme declares a
   `faq` kind yet, and `site.seo`'s organization fields are wizard work
   (Task 15). Emitting empty structured data would be worse than none.

## 3. Evidence

Environment: Node 22.22.2, workerd via `@cloudflare/vitest-pool-workers`
0.22.0, macOS 24.6.0, vitest 4.1.11.

```
pnpm lint / typecheck / test / build / bundle:size → all exit 0
13 files, 150 tests
```

All in `test/worker/seo.test.ts`:

| Requirement | Status |
| --- | --- |
| Sitemap lists published content only; drafts absent | `VERIFIED_LOCAL` |
| Sitemap carries hreflang alternates plus `x-default` | `VERIFIED_LOCAL` |
| Sitemap cached under the `sitemap` tag | `VERIFIED_LOCAL` |
| RSS per locale, each listing only its own language | `VERIFIED_LOCAL` |
| Unknown-locale feed 404s | `VERIFIED_LOCAL` |
| robots disallows all while no domain is bound | `VERIFIED_LOCAL` |
| Pages carry `noindex` while no domain is bound | `VERIFIED_LOCAL` |
| Canonical host gets open robots and loses `noindex` | `VERIFIED_LOCAL` |
| A non-canonical host stays noindexed after binding | `VERIFIED_LOCAL` |
| Product pages emit Product JSON-LD | `VERIFIED_LOCAL` |

Cross-stage invariants `AC-INV-01..04, -07, -09`: `VERIFIED_LOCAL`
(212.7 KiB gzip).

## 4. Not done, and why

- **Gate A write-back**: purge-by-tag is implemented and defaulted (plan A),
  but its real-account behaviour (latency, the 5/min limit) still comes from
  `TASK-01 §4.5`, and `ARCHITECTURE §6.2`'s conclusion line stays open until
  then.
- **Sitemap pagination beyond 50 files** (250k URLs) walks no further; the
  index loop is capped. A site that size is far past 0.1.
- **`FAQPage` / `Organization` JSON-LD**: see §2.5.
