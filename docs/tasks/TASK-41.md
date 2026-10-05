# Task 41 — Structured data from `renderData`

- Status: **done**.
- Date: 2026-10-05
- Scope: a `renderData` result may offer properties for the JSON-LD node the
  core builds for the page; the core merges the ones on an allow-list —
  `offers` on `Product` — into that one node.
- Source: the owner's task list, item M16, added 2026-10-05 and planned with
  Task 22 (`docs/IMPLEMENTATION_PLAN.md`, phase six), with the owner's
  decision of 2026-10-05: an allow-list per node type, starting with `offers`
  on `Product` and nothing else.

## 1. Demonstrable loop

A plugin returns `structuredData: { offers: … }` from `renderData` on a
product page. The page's `<head>` carries one `Product` node, the core's, now
containing `offers`. The same plugin offering `name`, `@type` or
`aggregateRating` changes nothing but the log.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/view.ts` | `mergeStructuredData`, the allow-list `STRUCTURED_DATA_ADDITIONS`, and the three page builders passing their node through it |
| `src/worker/render-data.ts` | Splits `structuredData` off each hook's result before it reaches templates |
| `src/worker/render.ts`, `pages/*.page.ts` | Carry the offered properties to the view and log what was dropped |
| `test/core/structured-data.test.ts` | New: the merge rule on its own |
| `test/worker/render-data.test.ts` | The rule through the real handler |
| `docs/` | `PLUGIN_API §5.6, §13.2`, `SEO_PERFORMANCE §5`, the plan |

## 3. Decisions and deviations

- **The rule is in core, the logging in the Worker.** `src/core` stays free of
  side effects: the merge returns what it dropped, and the Worker's view
  context turns that into `structured_data_dropped` events.
- **The reserved key is not exposed to templates.** Not in the task list;
  agreed with the owner when the task was planned. A template reading
  `plugins.<id>.structuredData` would be reading a second copy of the price.
- **Two plugins, one property: the first in the site's plugin order keeps
  it.** Also agreed at planning. The second is logged as `already_set`.
- **A dropped property does not make the page uncacheable.** Unlike a failed
  hook, it is not transient: the same plugin drops the same property on every
  render, and the page is exactly what the core alone produces.
- **Every unused property is logged, including on pages with no node.** A
  plugin that offers `offers` on a list page gets `no_node` on every cold
  render of it. That is noise for a careless plugin and the only signal for a
  mistaken one; a plugin avoids it by offering only when `ctx.content` is a
  product.
- **The task list's premise was partly wrong and is corrected in the plan.**
  It says a theme cannot contain `<script` at all. That holds only for a theme
  declaring no `clientScripts` (`assertNoUndeclaredScripts`). A theme that
  declares them could write a JSON-LD element, but with HTML-escaped output
  and as a second node — so the task stands, for a different reason than the
  one given. An earlier version of the plan entry repeated the claim as
  verified; it was not, and has been reworded.
- The home page's node is a `WebSite` and takes no additions.

## 4. Verification

- Through the real handler (`test/worker/render-data.test.ts`, "structured
  data"): one `Product` node containing `offers`, byte-identical across cold
  renders; `@context`, `@type`, `name` and `url` cannot be replaced, each
  logged as `core_key`; `aggregateRating` dropped as `not_allowed`; the second
  of two plugins logged as `already_set`; `</script>` inside an offered value
  is emitted as `</script>`; an article page, a plain page, a list and
  the home page are byte-identical with and without an offer, and cached; a
  product page with the plugin offering nothing has the same node as with the
  plugin switched off; a failing hook and a non-object `structuredData` leave
  the node alone.
- Mutation checks, each restored afterwards: removing the allow-list, letting
  core properties be replaced, letting a later plugin overwrite, passing the
  reserved key to templates, and not merging at all each turn at least one
  case red.
- The existing tests pass unchanged, the five official themes among them.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not done / known limits

- **Nothing checks that an offered price is the one the page shows.** That is
  the rule in `SEO_PERFORMANCE.md §5`, and only the plugin can keep it.
- The offered value is not validated as a schema.org `Offer`.
- Not run against Google's Rich Results Test or any external validator.
- `SEO_PERFORMANCE.md §5` lists an `Organization` node on the home page; the
  code emits `WebSite`. Found here, not changed here.
