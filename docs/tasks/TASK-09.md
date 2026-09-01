# Task 09 — The foreign-trade theme

- Status: **complete**, all checks green locally
- Date: 2026-08-29
- Scope: the six content kinds a B2B trade site needs, their field schemas and
  layouts; a CSS-only mobile nav and gallery; `en`/`zh` locale packs; the
  inquiry form's styling slot.
- Contract: `docs/THEME_FORMAT.md §7.5–§7.7`, `§14`;
  `docs/SEO_PERFORMANCE.md §5`, `§9`; `docs/DATA_MODEL.md §3`.
- Delivered as **`atelier` 2.1.0**, not a new theme called `trade` — see §1.

## 1. Naming: `atelier` is the theme the plan called `trade`

The plan and `THEME_FORMAT §14` were written before the design review. On
2026-08-29 the product owner approved four designed themes by name, and the
foreign-trade one is called `atelier`. It occupies exactly the slot `trade`
described — same vertical, same acceptance role — so this task extended it to
the full six kinds rather than creating a second B2B theme with a different
name. `THEME_FORMAT §14` now records the real roster and says so explicitly.

**Nothing else was renamed.** `starters/trade-b2b` keeps its name: the starter
is the repository a user forks, which is a different thing from the theme.

## 2. What the theme gained

| Kind | Layout | Field schema |
| --- | --- | --- |
| `category` | `category.liquid` | `summary`, `applications`, `cover`; lists its products |
| `case` | `case.liquid` | `client`, `industry`, `country`, `year`, `product` (reference), `outcomes`, `gallery` |
| `faq` | `faq.liquid` | `faq` question list, rendered as a `<details>` accordion |
| `product` (extended) | `product.liquid` | gained `category` (reference), `gallery`, `datasheet` |

Plus: breadcrumbs, a specification table from `specs`, a datasheet download,
related products, and two new options (`case_cta_label`, `inquiry_note`).
Locale packs went from 27 to 49 keys, `en` and `zh` in step.

## 3. What the core gained, and why it had to

Three gaps only became visible once a theme declared the field types the
contract already allowed. None of them are theme-specific.

1. **Front-matter media did not resolve.** Stage one rewrites relative paths
   in the *body*; a `gallery` or `cover` in front matter stayed a relative
   path and rendered broken. Core now exposes `content.images[path]` →
   `{url, srcset, width, height, alt}` and `content.files[path]` → URL, built
   from the same asset map and the same variant choice the body renderer uses,
   so an image looks identical whether it is in the body or in front matter.
   `width`/`height` travel with it because `SEO_PERFORMANCE §9` requires the
   box to be reserved. Cost: **zero extra queries** on a content page (the
   fragment already resolved the map); **one** batched query for list and home
   covers, independent of item count.
2. **There was no way to relate content.** `reference` was a declarable field
   type that nothing read. `loadRelations` now reads the rules off the
   manifest — forward for this kind's `reference` fields, backward for other
   kinds pointing at this one, plus same-kind siblings — in one D1 batch. The
   core still knows nothing about "category" or "product"
   (`ARCHITECTURE §11`): the product page's *"family"* and the family page's
   *"products in this family"* are the two directions of one declaration.
3. **`FAQPage` structured data was missing**, though `SEO_PERFORMANCE §5`
   lists it as one of the four. Core now emits it from a normalized `faq`
   front-matter value — and exposes the same normalized pairs as
   `content.faq`, so a template cannot show one set of questions while the
   structured data claims another. With no questions it emits **nothing**
   rather than an empty `FAQPage`.

## 4. Two decisions worth recording

1. **The mobile nav is a checkbox, not `<details>`.** `<details>` was the
   first implementation and it broke the desktop nav: a closed `<details>`
   hides its content through user-agent behaviour that a CSS `display` rule
   does not override, so at wide viewports the nav disappeared. Verified in
   the browser, not reasoned about. The checkbox disclosure is the one
   zero-JS pattern CSS can force open at a breakpoint, and it keeps **one**
   copy of the nav in the markup — a duplicated mobile/desktop pair would
   double the links for crawlers and screen readers. The FAQ accordion stays
   on `<details>`, where no breakpoint override is needed.
2. **The inquiry form is styled by the theme, not the plugin.** The plugin
   injects `.mallok-inquiry` markup at stage two (`PLUGIN_API §11`); the
   theme's stylesheet gives it the site's own controls. A plugin shipping its
   own CSS would either fight the theme or need a second stylesheet request.

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass (12 pre-existing theme-CSS warnings, no errors) |
| `pnpm typecheck` | pass (root + core tsconfig) |
| `pnpm test` | 19 files / 207 tests pass |
| `pnpm build` | pass (theme validation included) |
| `pnpm bundle:size` | 836.6 KiB raw / **225.6 KiB gzip** = 7.3 % of the Free limit |

New tests:

- `test/core/themes.test.ts` — renders **every layout of every theme** (home,
  each kind's page, each list) and asserts: no unresolved Liquid, no
  `[object Object]`/`undefined` leaking, `canonical` present, hreflang on
  pages that have real alternates, and **no `<script>` other than JSON-LD**.
  That last one turns the 0-byte-JS promise into a test rather than a claim.
  Plus atelier-specific assertions for the relations, the spec table, the FAQ
  accordion, and the single-nav markup.
- `test/core/view.test.ts` — `faqPairs` in both shapes, FAQPage emission and
  suppression, `<` escaping inside JSON-LD, relation view assembly,
  `buildImageViews` variant selection.
- `test/worker/relations.test.ts` — `loadRelations` against **real D1** in
  workerd: forward refs, reverse refs, siblings, and that drafts, scheduled
  items and other locales never leak in. This is also where `json_extract`
  was confirmed to work on D1 rather than assumed.

The `pnpm preview` output was reviewed in a browser at desktop and mobile
widths: the checkbox nav opens and closes, no horizontal overflow, the case
page's outcomes and the resolved product link render.

## 6. Not done / known limits

- **`reference[]` is still unresolved.** Only single `reference` fields are
  read; a list of references would need one statement per element and no kind
  needs it yet. Declaring it is allowed and simply yields nothing.
- **Front-matter galleries have no `sizes` beyond the theme's literal.** The
  body renderer computes `sizes` from the pipeline defaults; a theme's gallery
  writes its own. Acceptable, but the two can drift.
- **The reverse-reference query scans a kind's published rows in one locale.**
  Bounded by the `content_list` index prefix and only on cold render, but a
  catalogue above ~2000 items of one kind would want an expression index —
  which cannot be created without knowing the theme's field names at migration
  time. Recorded in `DATA_MODEL §3`.
- **Lighthouse and axe were not run.** `SEO_PERFORMANCE §12` requires them on
  a custom domain with a warm cache, which needs the real-account pass
  (`TASK-01 §4`). The 0-byte-JS budget is covered by test; the numeric budgets
  in `SEO_PERFORMANCE §7` remain unconfirmed by the product owner.
- **`ACTIVE_THEME` is still `journal`.** Switching the deployment to `atelier`
  is a one-line source change plus a redeploy, which is the whole point of the
  build-time model — but it belongs to the starter task (Task 15), not here.
