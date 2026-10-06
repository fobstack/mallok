# Task 44 — A kind with an address and no list layout answers 404

- Status: **done**.
- Date: 2026-10-06
- Scope: the list address of a kind whose theme declares no `listLayout`.
- Source: Nundar's item M19, received 2026-10-06
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A theme declares `"tool": { "layout": "layouts/tool.liquid" }` and the site
gives it the base `tools`. `/tools/calculator` is the item's page. `/tools`
answered `500 {"error":"Internal error."}`; it now answers 404 with the
theme's not-found page, and `/de/tools` does so in German.

## 2. What changed

| File | Change |
| --- | --- |
| `src/worker/pages/content.page.ts` | A path is a kind's list page only when the theme has a list layout for that kind |
| `test/worker/list-without-layout.test.ts` | New |
| `CHANGELOG.md`, the plan | The entry |

## 3. Decisions and deviations

- **The documentation was already right.** `THEME_FORMAT.md §5` says of
  `listLayout`: "Without it the kind has no list page and the list path
  returns 404". The code threw instead. Nothing in the docs changed.
- **The path falls through, it is not refused early.** With no list page at
  the base, the request goes on to the redirect lookup and only then to
  not-found, so a redirect stored for that path is still followed (read from the code; no test stores one).
- **No build-time warning.** Nundar's note offers one as optional. A kind
  without a list layout is a declared, documented state — `page` is one — and
  a warning for it would fire on every official theme.
- `mallok build` already skipped such a kind's list page; it is unchanged.
- The tag archive has the same `throw` for a theme with no list layout on
  any kind. No official theme is in that state and Nundar did not report it;
  it is left as it is and noted in §5.

## 4. Verification

- `test/worker/list-without-layout.test.ts`, on a Worker whose theme has such
  a kind: the item is served; the base and its second page answer 404 as
  HTML in the address's language; a kind with a list layout is still listed.
- Red-green: with the fix reverted the two 404 cases fail with
  `expected 500 to be 404`; restored, they pass.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not covered, and known risks

- `/tags/<tag>` on a theme where no kind has a list layout still throws.
- Not run on a deployed site.
