# Task 30 — Theme script validation with declared scripts

- Status: **done**. With it, P0 of phase six is complete.
- Date: 2026-10-06
- Scope: a theme's templates are scanned for script whether or not the theme
  declares `clientScripts`; the only script allowed is a `<script src>`
  naming a declared file. The docs and the code agree on `.js` assets.
- Source: the owner's task list of 2026-10-01, item M10
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A theme declares `assets/switch.js` and loads it with
`<script src="{{ theme.asset_base }}/switch.js" defer></script>`: it builds.
Add `<script>track()</script>` to a partial, or `onclick="…"` to a button, or
a second `<script src>` pointing at a CDN, and the build fails naming the
template and what is wrong. Before this task all three built, because one
declared script switched the whole check off.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/theme-package.ts` | `assertNoUndeclaredScripts` no longer returns early for a theme with declarations; it checks every `<script>` tag and every `on…=` attribute |
| `test/core/theme-package.test.ts` | The test that asserted the gap is replaced; the five official themes are read from their directories and validated |
| `docs/` | `THEME_FORMAT §3, §9`, `PLUGIN_API §5.6, §13.2`, the plan |

## 3. Decisions and deviations

- **The handoff's finding was confirmed first**: the function returned at
  once when `clientScripts` was non-empty, and an existing test,
  "allows scripts once the manifest declares them", asserted that an inline
  `<script>go()</script>` passed. That test is gone.
- **The only accepted `src` is `{{ theme.asset_base }}/<path under assets/>`.**
  A literal `/theme/<id>/<version>/…` path is refused even when it names the
  same file: it would be wrong after the next version bump, and the asset
  prefix is what the docs have always told theme authors to use.
- **External scripts are refused.** `clientScripts` declares files the theme
  ships; a URL on someone else's host is not a file the admin can show a size
  for, or that this check can say anything about. The task says "naming a
  declared path", and a CDN URL is not one.
- **Inline data blocks are refused too** — `<script type="application/ld+json">`
  is inline script by the task's wording, and structured data has a
  supported route since Task 41. `PLUGIN_API.md §5.6`, which said a theme
  with declared scripts could hand-write one, is corrected.
- **A `<script src>` must be empty.** Browsers ignore the content of a tag
  that has a `src`; content there is either a mistake or an attempt to look
  like one.
- **Event attributes are refused with or without declarations**, as before
  for themes with none.
- **This tightens what already-built themes may contain**, and the docs say
  so. No official theme is affected: Atelier's one script was already loaded
  exactly this way.
- `.js` under `assets/` was already accepted by the code only when declared;
  `THEME_FORMAT.md §3` now says so instead of omitting `js`.

## 4. Verification

- `test/core/theme-package.test.ts`, "a theme that declares a script": six
  accepted spellings of a declared reference (quotes, case, whitespace in the
  Liquid tag, `type="module"`, two scripts, none); four kinds of inline
  script refused, a JSON-LD block among them; ten undeclared or disguised
  `src` values refused — another file, absolute and protocol-relative URLs,
  a literal theme path, a bare path, `..`, a Liquid value, a query string
  built from content, a `data:` URL, an empty `src`; code inside a `src` tag
  and an unclosed tag refused; three event attributes refused; a partial
  checked like a layout.
- **All five official themes validated from their directories**, as the build
  reads them, Atelier's carousel line asserted verbatim.
- Mutation checks, each restored afterwards: restoring the early return (the
  state before this task), accepting any asset-prefixed path, accepting code
  inside a `src` tag, and allowing event attributes once a script is declared
  each turn at least one case red.
- The existing tests for themes without declarations pass unchanged.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 5. Notes for the next release

- **A theme that declares `clientScripts` is now checked like any other.**
  Inline `<script>`, `on…=` attributes and scripts loaded from anywhere but
  a declared file fail the build. A site with its own theme that relied on
  the gap has to move the code into a declared file.

## 6. Not done / known limits

- **It is a text scan.** A template that builds a tag from Liquid output
  (`<{{ "script" }}>`), or a `javascript:` URL in an `href`, is not caught.
  That was true before and is now written down in `THEME_FORMAT.md §9`.
- A declared script's `bytes` is not compared with the file's real size.
- A declared file that no template loads is not reported.
- What a plugin's `afterRender` injects is the plugin's `clientScripts`
  declaration, a separate mechanism this task did not touch.
