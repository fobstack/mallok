# Task 27 — Content save and delete hooks

- Status: **done**.
- Date: 2026-10-05
- Scope: `onContentSave`, documented and typed since the first plugin API
  and never called, runs on the save path; a new `onContentDelete` runs after
  a delete.
- Source: the owner's task list of 2026-10-01, item M7
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A plugin's `onContentSave` refuses a product without a SKU: the admin's
editor and `mallok publish` both get the plugin's own sentence back, and
nothing is stored. Another returns stamped Markdown: that is what is stored
and rendered, and publishing the same file again is reported unchanged.
Deleting the German page of a product tells `onContentDelete` so with
`lastInGroup: false`; deleting the English one after it, `true`.

## 2. What changed

| File | Change |
| --- | --- |
| `src/worker/admin-content.ts` | The save path runs the hooks before the length check and the comparison; the delete path runs the delete hook; the site and plugin rows are read once |
| `src/worker/plugin-runtime.ts` | `runOnContentSave` names the plugin that refused; `runOnContentDelete`; `anyPluginHas` |
| `src/core/plugin.ts` | `onContentDelete` joins the hook names, as a version 2 hook |
| `src/plugins/types.ts`, `src/worker/public.d.ts`, `framework.ts` | `ContentDeleteRef` and the hook's signature |
| `test/worker/content-hooks.test.ts` | New |
| `test/core/plugin.test.ts` | Which version each hook belongs to |
| `docs/` | `PLUGIN_API §5, §5.4, §5.7, §6, §13.2, §13.3`, the plan |

## 3. Decisions and deviations

- **The handoff's finding was confirmed before anything was built**:
  `runOnContentSave` existed and nothing in `src/` called it.
- **There is one save path, so there is one call.** The admin's editor,
  `mallok publish`, `mallok import` and a starter's content at setup all
  reach `saveContent`. Nothing was added to the CLI.
- **The order is the plan's**: hooks, then the length safety net on their
  result, then the comparison with the stored item. A test covers each of the
  three, and one more shows why the comparison is on the hook's answer: with
  the same file and a hook that now answers differently, the save is an
  update, not "unchanged".
- **A hook cannot move an item.** Kind, locale and slug are settled from what
  was submitted, before the hooks run; a hook that rewrites the front
  matter's `slug` changes the stored Markdown and not the item's address. The
  title is re-read from the hook's result.
- **A refusal is 422 with `rejectedBy`.** The existing validation errors are
  400; a plugin's refusal is not a malformed request, and the caller may want
  to tell which plugin said no.
- **A hook's result that can no longer be saved is refused too** — no front
  matter title, or over the size limit — with a message saying a plugin did
  it. Storing it would break the item for every reader.
- **A failing delete hook does not fail the delete.** The row is gone by
  then. It is logged, the other hooks run, and the response lists
  `hookFailed`.
- **`onContentDelete` requires plugin API 2; `onContentSave` does not.** The
  save hook has been in the version 1 contract all along.
- **This changes what a version 1 plugin does**, and is listed in
  `PLUGIN_API.md §13.3`: one that declared `onContentSave` did nothing until
  now. The official plugin does not declare it.
- The save path now reads the site row and the plugin rows in one batch
  instead of the site row first and both again before rendering: one round
  trip fewer on every save that renders, hooks or not.

## 4. Verification

- `test/worker/content-hooks.test.ts`, through `SELF.fetch` on a Worker
  composed with a version 1 plugin that has the save hook and two version 2
  plugins:
  - the draft a hook receives; the hook's Markdown stored, rendered by stage
    one and passed to the next plugin;
  - the same file again reported `unchanged`, with the hook still called;
  - a hook answering differently for the same file being an update;
  - a refusal: 422, the plugin's message, `rejectedBy`, nothing stored, an
    existing item untouched, later hooks not run;
  - a hook that lengthens the body past the safety net: saved as a draft
    with the warning;
  - a hook that removes the title: 422, nothing stored;
  - a plugin switched off: not called;
  - **the CLI's real publish loop** (`publishBundles`) against the Worker:
    stamped on first publish, `unchanged` on the second, `failed` with the
    plugin's message on a refusal;
  - a delete with another language left (`lastInGroup: false`) and the last
    one (`true`), with every field of the reference; a failing hook leaving
    the delete done, the other plugin called, `hookFailed` in the response
    and one logged event; nothing called for a 404 or a switched-off plugin.
- Mutation checks, each restored afterwards: not calling the save hook (the
  state before this task), not adopting its result, checking length before
  it, comparing the submitted bytes instead of the result, `lastInGroup`
  always true, and stopping at a failed delete hook each turn at least one
  case red. The fourth was not caught at first; the test that catches it was
  added because of it.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 5. Notes for the next release

- **`onContentSave` is now called.** A plugin that declares it starts
  rewriting or refusing saves on upgrade. It must be idempotent, or every
  `mallok publish` becomes a change.
- `DELETE /content/<id>` may answer with `hookFailed`.

## 6. Not done / known limits

- **No CPU measurement.** A save was already the most expensive request;
  hook time is added to it and nothing here bounds or measures it on a
  deployed Worker.
- **The draft has no id**, so a save hook cannot key its own rows by content
  id. `kind`, `locale` and `slug` identify the item; Task 29 attaches plugin
  records to content in the editor.
- The delete hook is not called for content that leaves the site in any way
  other than `DELETE /content/<id>`; today there is no other way.
- A plugin switched off when content is deleted never hears of it.
- The admin's editor shows a refusal through its existing error display; no
  browser test exercises it, since the default composition has no save hook.
