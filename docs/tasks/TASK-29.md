# Task 29 — Panels attached to the content editor

- Status: **done**.
- Date: 2026-10-05
- Scope: a records panel may declare `attachTo: { kind }`; it is then shown
  in the editor of content of that kind, listing the records of the open
  item, keyed by the item's translation group.
- Source: the owner's task list of 2026-10-01, item M6 part B
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A plugin attaches "Product notes" to products. Open a product in the admin:
the editor bar has a "Product notes ↓" link, and under the editor is the
panel, empty. Add a note; it lists. Open another product: its panel is empty.
Open the first product's other language: the same note is there. Delete one
language of the product and the note stays; delete the last and the plugin's
delete hook removes it.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/plugin.ts` | `attachTo: { kind, column }` on a records panel |
| `src/worker/admin-plugins.ts` | The list filtered by `attached`; a save checked against real content and told `attachedTo` |
| `src/plugins/types.ts`, `src/worker/public.d.ts` | `PluginRecordInput.attachedTo`; `attachTo` on the declaration |
| `src/admin/pages/editor.tsx` | Attached panels under the editor, and a link to them in the bar |
| `src/admin/components/plugin-panel.tsx`, `record-editor.tsx`, `pages/plugins.tsx`, `types.ts`, `styles.css` | The panel takes the item it is for; the plugins page points to the editor instead of listing |
| `test/fixtures/catalog-plugin.ts` | An attached "Product notes" panel and the delete hook that cleans it up |
| `test/worker/records-panel.test.ts`, `test/e2e/12-attached-panel.spec.ts` | New cases; a new browser spec |
| `docs/` | `PLUGIN_API §7.5, §13.2`, `ADMIN §10`, `TESTING §7`, the plan |

## 3. Decisions and deviations

- **The panels are below the editor, not beside it.** The task says
  "beside". The editor is three panes filling the window; the first attempt
  put the panel inside that frame and a browser screenshot showed the panes
  squeezed to a strip. They are now under the editor, reached by scrolling or
  by a link in the editor bar, and a browser test checks the panes keep their
  height.
- **The table column is declared, defaulting to `translation_group`.** The
  core filters the list on it, so it has to know its name; it never writes
  it.
- **The core checks the item, the plugin stores the link.** A save names a
  translation group; the core refuses one that no content of the panel's
  kind has, then hands `attachedTo` to `save`. The handler keys its row by
  it. Nothing in the core writes to the plugin's table.
- **Records are not cleaned up by the core.** The plan's wording is "deleting
  the item cleans them up through Task 27's hook", and that is literal: the
  plugin's `onContentDelete` does it, on `lastInGroup`. A plugin without the
  hook leaves orphans, and the docs say so.
- **On the plugins page an attached panel is not listed**, only pointed to:
  a list of every product's notes, with nothing to say whose each is, would
  be a worse view of the same data than the editor's.
- **`load` and `remove` are not checked against the open item.** They take a
  record id, which is the plugin's. The list is what scopes what the admin
  shows; a caller with `content:write` can already edit any record.
- A new, unsaved item has no translation group, so the panel appears after
  the first save.

## 4. Verification

- `test/worker/records-panel.test.ts`, "a panel attached to content": what
  the admin is told; two products and an article, one product in two
  languages; the list of one product's records only, and none for an unknown
  group; the plugin storing the group it was handed; a save refused with no
  group (400), an unknown group and an article's group (404), nothing
  stored; an edit staying under its item; **the records surviving the
  deletion of one language and removed with the last**, another product's
  untouched; a panel that is not attached unaffected by `attached`.
- **In a browser** (`test/e2e/12-attached-panel.spec.ts`): the plugins page
  pointing to the editor; the panel under a starter product, a note added,
  the item's own unsaved state unchanged by it, the editor panes keeping
  their height, the bar's link; a second product empty; the first product's
  note there after a reload; a page's editor showing no panel.
- Mutation checks, each restored afterwards: the list ignoring the item, any
  group accepted, the kind not checked, and `attachedTo` optional each turn
  at least one case red.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 5. Not done / known limits

- **Not tried in a browser: the other language of the same product.** The
  Worker test covers the shared group; the browser test deliberately picks
  two different products.
- **Orphans are possible**: a plugin without `onContentDelete`, or one
  switched off when an item is deleted, keeps the records.
- The panel is not shown for an item that has never been saved.
- The editor loads the plugin list on every item it opens.
- **Seen and not addressed:** the editor of a starter product shows
  "Unsaved" as soon as it opens, before anything is edited. The browser test
  only checks that adding a record does not change that. Nothing added in
  this task marks the item as edited, so it is not from here; where it does
  come from has not been investigated.
- **Seen once:** the `gazette` accessibility case of the browser suite hung
  for three minutes in one run and passed in the next three. Not reproduced.
