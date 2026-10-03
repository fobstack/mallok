# Task 37 — `recent.<kind>` on the home page for every listed kind

- Status: **done**.
- Date: 2026-10-03
- Scope: the Worker's home page supplies `recent.<kind>` for every kind the
  theme lists, by the same rule and bound as `mallok build`.
- Source: the owner's task list, item M13 (found building Nundar on
  0.1.0-rc.7); `docs/IMPLEMENTATION_PLAN.md`, phase six.

## 1. Demonstrable loop

Publish a product on a site running Atelier and open the home page: the
product appears in the product section. Before, that section never appeared
on a served site, although `mallok build` showed it for the same content.

## 2. What was wrong

`src/worker/pages/home.page.ts` loaded published `article` items only and
passed `{ article: … }`, while `THEME_FORMAT.md §7.4` documents `recent.<kind>`
by kind and Atelier's home reads `recent.product`. `mallok build` supplied
every enabled kind, twelve items each, list layout or not. So the two paths
rendered different home pages from the same content, and differed from each
other in which kinds and how many.

## 3. What changed

| File | Change |
| --- | --- |
| `src/core/view.ts` | `homeKinds` — the kinds the site enables and the theme gives a `listLayout`, in site order — and `HOME_RECENT` (10) |
| `src/db/queries.ts` | `listRecentByKind`: one bounded statement per kind, in one batch |
| `src/worker/pages/home.page.ts` | Loads every home kind in that batch; covers resolved once for all of them |
| `src/cli/build.ts` | Uses the same rule and bound (was every enabled kind, 12 each) |
| `docs/THEME_FORMAT.md §7.4`, `docs/DATA_MODEL.md §3` | The rule and the bound |

## 4. Decisions and deviations

- **One rule for both paths**, in `src/core`: enabled on the site and listed by
  the theme. The owner's list said "every kind the theme declares with a
  `listLayout`"; `mallok build` used every enabled kind. A kind the site has
  not enabled has no content, and a kind without a list layout has no list to
  be recent in, so the intersection is what both mean.
- **Ten per kind, not twelve.** The Worker already used 10 (`HOME_RECENT`);
  the static build used 12, and `DATA_MODEL.md §3` caps a home page at 50 rows.
  Atelier lists five kinds: 5 × 10 = 50. The table row now states the bound as
  10 per listed kind rather than relying on a theme keeping to five.
- **Purging needed no change.** The owner's list asked for the home page to be
  tagged so a change to any of those kinds purges it; it already is. Every
  content change carries `home:<locale>` (`tagsForContent`), which is the home
  page's own tag. A regression test now says so.
- **A visible change for static builds.** A group holds ten items rather than
  twelve, so a theme that loops a whole group — Gazette, Journal and Folio do,
  for `recent.article` or `recent.project` — shows ten on a `mallok build` home
  page where it showed twelve. That is what the same theme has always shown
  when served by the Worker. A kind without a list layout no longer gets a
  group; every group the five official themes read (`article`, `product`,
  `project`) belongs to a listed kind, so none of them loses one.

## 5. Verification

- `test/worker/home-recent.test.ts`: a published product is on the home page;
  each group holds at most ten, newest first, and a kind with no content is an
  empty group; every kind's change carries the home tag.
- `test/worker/budget.test.ts` gains a home-page case, which it did not have:
  a cold home render is `batch(5)` then `batch(3)` — two round trips with
  three listed kinds. A listed item with a cover adds one media query, three
  in all, inside `AC-INV-05`'s four.
- `test/cli/build.test.ts`: with a probe theme, twelve articles give ten on the
  home page, and `page` gets no group.
- `test/core/view.test.ts`: `homeKinds` — order, unknown and disabled kinds,
  and a kind named like an `Object` member.
- Red-green: with the two call sites reverted and the shared rule kept, the
  product is missing from the home page, the budget case does not match, and
  the static build gives twelve articles and lists `page`.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 6. Not done / known limits

- Ties in `published_at` are ordered by `id` on the Worker and left in scan
  order by the static build, which has no ids; two items published at the
  same instant can appear in a different order on the two paths.
- Not run against a real Cloudflare account. The round-trip count is measured
  in workerd; the CPU cost of the extra statements is part of Task 35's
  re-measurement.
