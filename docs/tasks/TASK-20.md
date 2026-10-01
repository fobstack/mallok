# Task 20 — Public helpers for plugins

- Status: **done**.
- Date: 2026-10-02
- Scope: export `escapeHtml` and `renderTextTemplate` from `mallok/worker`, so
  a plugin that lives in a site can build its own HTML and email.
- Source: the owner's task list of 2026-10-01, item M1 parts 1–2
  (`docs/IMPLEMENTATION_PLAN.md`, phase six). Part 3, site-level email
  settings, is Task 21.

## 1. Demonstrable loop

A project that installed only the `mallok` tarball, with `skipLibCheck` off,
contains a plugin module that imports `escapeHtml` and `renderTextTemplate`
from `mallok/worker`. It compiles under strict settings, and running it
renders an operator-style text template unescaped and the HTML body escaped.

## 2. What changed

| File | Change |
| --- | --- |
| `src/worker/framework.ts` | Re-exports `escapeHtml` and `renderTextTemplate` from the core |
| `src/worker/public.d.ts` | Declares both, with the rule that template output is text and is not HTML-escaped |
| `test/cli/strict-consumer.test.ts` | New case: a third-party email module compiled against the tarball and executed |
| `docs/PLUGIN_API.md §7.6` | The helpers and how the official plugin uses them; §13.2's row marked done |
| `docs/IMPLEMENTATION_PLAN.md §1` | Phase six status brought up to date |

## 3. Decisions and deviations

- **A stale paragraph was corrected.** `PLUGIN_API.md §7.6` said email
  templates live at `emails/<name>.<locale>.liquid` and that the restricted
  engine escapes what a buyer typed "by default in the email too". No such
  files exist: the `inquiry` plugin's templates are text in its settings,
  rendered by `renderTextTemplate`, which does not escape; the HTML body is
  then built by passing the rendered text through `escapeHtml`
  (`src/plugins/inquiry/emails.ts`). The safety came from that last step, not
  from the engine. Publishing `renderTextTemplate` with the old paragraph in
  place would have told plugin authors the opposite of what it does.
- The official plugin keeps importing from `src/core`; it is compiled inside
  the package, and changing its imports would change nothing a user sees.
- The phase-six status row in the plan had still said "Not started" after
  Tasks 18 and 19; it is corrected here.

## 4. Verification

- Red-green on the consumer test: before the export, `tsc` in the consumer
  project failed with `TS2305 … has no exported member 'escapeHtml'` and
  `'renderTextTemplate'`; after it, all eight consumer tests pass, the new one
  included.
- The public surface stays honest: with `public.d.ts` reverted and the export
  kept, `pnpm typecheck` fails in `test/types/public-surface.ts` naming both
  functions.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not done / known limits

- Nothing in this task changes behaviour at runtime: both functions existed
  and are unchanged; only their visibility changed.
