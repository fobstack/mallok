# Task 39 — Resolve `reference[]` fields

- Status: **done**.
- Date: 2026-10-06
- Scope: a `reference[]` field reaches templates as content, in both
  directions, the way a `reference` field does.
- Source: the owner's item M14, added 2026-10-03
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A theme declares `also_in: { "type": "reference[]", "kind": "category" }` on
its product kind. A product whose front matter says `also_in: [second,
family]` renders `content.refs.also_in` as those two families, in that order,
with title, path and cover; and each family's page lists the product in
`content.backrefs.product`. Before this task the field reached a template as
two bare slugs, and neither family knew about the product.

## 2. What changed

| File | Change |
| --- | --- |
| `src/worker/render.ts` | `loadRelations` resolves `reference[]` forward and backward, inside the existing batch |
| `src/db/queries.ts` | `summariesBySlugs`, `listByReferenceList` |
| `src/core/view.ts`, `page.ts` | `refs.<field>` is one summary or a list of them |
| `src/cli/site-model.ts`, `build.ts` | `mallok build` resolves the same, and reports each slug that names nothing |
| `test/worker/relations.test.ts`, `budget.test.ts`, `test/cli/site-model-relations.test.ts`, `test/core/view.test.ts` | New cases |
| `docs/` | `THEME_FORMAT §5.2, §7.5`, `DATA_MODEL §3`, the plan |

## 3. Decisions and deviations

- **`content.refs.<field>` is a list for a `reference[]` and one item for a
  `reference`.** The type of the field decides, not what it holds, so a
  template never has to ask which it got.
- **The order is the author's.** The slugs are fetched in one statement and
  put back in the order written; a slug written twice counts once.
- **At most 24 targets per list**, the bound back-references already have.
  More are not resolved and `reference_list_truncated` is logged.
- **An unresolvable slug is left out of the list**; the Worker does not log
  it (a missing target is a normal state while content is being written).
  `mallok build` reports each one, as it does for a single reference.
- **One item, once.** A kind that points at the same target through two
  fields used to be able to appear twice in `backrefs.<kind>`, and that list
  could hold 24 per field. It now holds each item once and 24 in all. This
  changes the result only for a theme with two reference fields from one
  kind to another; none of the five official themes has that.
- **Back-references stay between kinds.** A `reference[]` from a kind to
  itself resolves forward only, as a `reference` to the same kind always
  has: the backward loop skips the item's own kind, and this task did not
  change that.
- **No index for the contents of the list.** The plan asked for "an index
  strategy". The strategy is the tag archive's: `json_each` over the rows the
  `content_list` prefix selects — the published items of that kind and
  language. SQLite cannot index the elements of a JSON array with an
  expression index; doing better needs a table of references maintained on
  save, which is a schema change this task did not make (§5).
- **The forward statement needed `+status` and `+published_at`.** Found by
  the plan test, not by reading: for `slug IN (…)` SQLite chose
  `content_list` and would have read every published item of the kind to
  find two. With the two terms kept out of index selection it uses the
  unique `(kind, locale, slug)` index. The single-reference statement
  (`slug = ?`) already did.
- **The admin has no picker for a list.** It shows the slugs as a list of
  strings, as before (`tasks/TASK-09.md §6`). `THEME_FORMAT §5.2` said
  "Multi-select content"; it now says what is there.

## 4. Verification

- `test/worker/relations.test.ts`, "lists of references", against D1: the
  order written, with a missing, an unpublished, a repeated, an empty and a
  non-string entry; another language's item with the same slug not used; a
  list resolving to nothing, a value that is not a list, a field not set; an
  item listed on every target it names, and not on one whose slug its own
  only contains; a draft not listed; an item named by two fields listed
  once; one batch, one statement longer than without the list; the bound of
  24 and its log line; the field-name check; and the query plan of both
  statements.
- `test/worker/budget.test.ts`: through the real handler with a theme that
  declares a list — a cold product page is still `batch(5)` then one more
  batch, the page shows both families in order, and each family's page shows
  the product once, in two round trips.
- `test/cli/site-model-relations.test.ts`: the same cases for
  `mallok build`.
- `test/core/view.test.ts`: a list stays a list and a single stays single.
- Each guarantee was checked by breaking it: thirteen single changes to the
  implementation (database order instead of the author's, skipping the list
  backward, no de-duplication in either place, a substring match, no array
  check, a larger bound, unpublished targets, another locale, repeated
  slugs, and four in the static build) each turned at least one test red.
  The plan test was red before the `+` terms were added.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not covered, and known risks

- **Rows read by a back-reference grow with the kind**, as they did for a
  single reference: every published item of the pointing kind in that
  language is read on a cold render of the target's page, and for a list
  its array is expanded as well. `DATA_MODEL §3` puts the comfortable limit
  at roughly two thousand items per kind. Not measured on a real account.
- **No content picker for a list** in the admin; authors type slugs.
- **Saving does not check** that the slugs of a `reference[]` exist. Nor
  does it for a `reference`.
- None of the five official themes declares a `reference[]`, so no official
  page shows one; the browser tests do not cover it.
