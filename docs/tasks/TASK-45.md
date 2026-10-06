# Task 45 — Let a template link to a kind's list page

- Status: **done**.
- Date: 2026-10-06
- Scope: `site.kinds.<kind>` in the view every template receives.
- Source: Nundar's item M20, received 2026-10-06
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A product layout writes
`{% assign own = site.kinds[content.kind] %}{% if own %}<a href="{{ own.path }}">{{ own.label }}</a>{% endif %}`.
On `/products/bar` it is a link to `/products` named as the list page is
titled; on the Chinese page it is `/zh/products` with the Chinese name; after
the owner changes the base to `catalogue` it points at `/catalogue`. On a
page of a kind with no list page, nothing is printed.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/page.ts`, `view.ts`, `index.ts` | `SiteView.kinds`, `KindLinkView`; one rule for a kind's label, shared with the list page's title |
| `test/core/view.test.ts`, `test/worker/kind-links.test.ts` | New cases |
| `docs/` | `THEME_FORMAT §7.1`, the plan, the changelog |

## 3. Decisions and deviations

- **Owner decision, 2026-10-06:** `site.kinds.<kind>` with `path` and
  `label` on every page, not `content.list_path`.
- **A kind is in `site.kinds` exactly when its list page exists.** Not an
  entry with an empty path: in Liquid an empty string is truthy, so
  `{% if site.kinds.tool.path %}` would be true for a kind with no page and
  every theme would have to remember to compare with `''`. The two
  conditions are the ones the router uses (Task 44).
- **`label` is the list page's own title rule**, now one function: the
  language pack's entry for the kind, the manifest's `label`, the kind's
  name. A link and the page it leads to cannot be named differently.
- **The path is relative**, like `content.path` and `site.home_path`.
- Because it is part of the site view, `mallok build` and the admin's
  preview have it too, with no code of their own.
- Found while testing, not changed: Atelier's language packs have no `case`
  entry, so its case-study list is titled "Case study" from the manifest in
  both languages. That is the theme's content, and predates this task.
- Found while testing, not changed: changing a kind's `base` does not move
  items already published; they keep the path they were saved with.

## 4. Verification

- `test/core/view.test.ts`: exactly the kinds with a list page — not one
  without a list layout, not one with an empty base, not one the site has
  not enabled; the prefix and the pack's name in another language; a changed
  base.
- `test/worker/kind-links.test.ts`, through the Worker and the real template
  engine, with a kind named `case`: a product page's link to its own list
  and to another kind's, the list page answering 200; the same in Chinese;
  a page of a kind with no list printing no link; the link following a
  changed base.
- Each condition was checked by breaking it: five single changes each turned
  a test red. The empty-base condition was not caught at first and has a
  case now.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not covered, and known risks

- No official theme uses `site.kinds` yet, so no official page shows it and
  the browser tests do not cover it.
- Not run on a deployed site.
