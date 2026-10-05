# Task 28 — Editable `records` panels, with sorting and search

- Status: **done**.
- Date: 2026-10-05
- Scope: a plugin panel that creates, edits and deletes records through a
  form the admin builds from declared fields, including `money` and `rows`;
  sortable columns and text search on any panel.
- Source: the owner's task list of 2026-10-01, item M6 parts A and E
  (`docs/IMPLEMENTATION_PLAN.md`, phase six). Part F was Task 19.

## 1. Demonstrable loop

A plugin declares a `records` panel with a name, a code, a status, a price
and a repeatable list of variants, and provides `load`, `save` and `remove`.
In the admin the panel has a New button; the form it opens has a price field
that takes `99.5` and a currency, and a Variants group with "Add a row".
Saving without the required code puts "This field is required." under Code;
saving a code that exists puts the plugin's own "Another item already uses
this code." there. The saved record lists as `USD 99.50`, reopens with every
value as entered, sorts by name, is found by search, and is deleted after a
second click.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/records.ts` | New. The record field vocabulary and `validateRecord` |
| `src/core/plugin.ts` | Panel `type: "records"`, `fields`, `search`, `sortable` columns, and their rules |
| `src/plugins/define.ts`, `types.ts`, `src/worker/public.d.ts`, `framework.ts` | `records` handlers on a plugin, checked against its panels; the public types |
| `src/worker/admin-plugins.ts` | The record endpoints; `sort`, `dir` and `q` on the list; `canRemove` |
| `src/admin/components/record-editor.tsx` | New. The form, the money control, the rows control |
| `src/admin/components/plugin-panel.tsx`, `types.ts`, `api.ts`, `styles.css` | New/Edit, search box, sortable headings; per-field errors on `ApiError` |
| `src/admin/components/lazy.tsx` | **A fix**: a lazily loaded part of the admin crashed the second time it mounted (§3) |
| `test/fixtures/catalog-plugin.ts` | A plugin with records panels, shared by Worker and browser tests |
| `test/e2e/worker/index.ts`, `scripts/e2e-config.mjs`, `scripts/e2e-server.mjs` | The browser tests' Worker adds that plugin |
| `test/worker/records-panel.test.ts`, `test/core/records.test.ts`, `test/e2e/10-records-panel.spec.ts`, `test/e2e/11-lazy-remount.spec.ts` | New |
| `docs/` | `PLUGIN_API §6, §7.5, §13.2`, `ADMIN §7, §10`, `TESTING §7`, the plan |

## 3. Decisions and deviations

- **A defect in the released admin was found and fixed here.** `lazyRoute`
  held the loaded component in `useState(cached)`. React calls a function
  passed to `useState`, so the second time any lazily loaded route mounted,
  its component was invoked with no props from inside `useState`. **On
  `0.1.0-rc.9`, opening a second content item in one admin session blanks the
  whole admin until reload.** It surfaced when the record form was opened a
  second time; `test/e2e/11-lazy-remount.spec.ts` reproduces it with the
  editor, was red before the one-line fix and is green after.
- **`load` is the plugin's, like `save`.** The task list names only a save
  handler. A record is not always a row — the test plugin keeps variants in a
  second table — so the admin cannot read one back from `table` either.
- **The list is still read from `table` by the core**, exactly as for a
  `table` panel. "The admin never runs generic SQL" is about writes, and is
  kept: there is no write to a plugin table anywhere in the core.
- **The handlers live in `records: { <panel id>: { load, save, remove? } }`**,
  not as `save_<panel>` functions among the actions: three functions per
  panel belong together, and `definePlugin` can then refuse a panel missing
  one.
- **The Worker validates; the browser does not.** One validator, in core,
  run by the Worker. The form sends what was typed and shows the messages
  that come back, keyed by field. That keeps zod out of the admin's bundle
  and makes it impossible for the two to disagree.
- **Only declared fields reach a handler.** Everything else in the request is
  dropped. A mutation check showed the first test of this could not fail; the
  fixture now records the keys it was handed.
- **`money` is whole minor units**, validated as a safe integer, with the
  currency one of those declared. The form converts on the text, not through
  a float, using the browser's knowledge of each currency's decimal places.
- **`rows` do not nest**, and a field type is from the settings vocabulary,
  not the theme's: no `image`, `file` or `reference` in a record. Those need
  the media and content pickers, which are wired to the content editor.
- **Sorting accepts only columns marked `sortable`**; anything else in the
  request is ignored rather than refused, so an old bookmark still lists.
- **Search is `LIKE` over the declared columns**, wildcards escaped. It scans.
- **Deleting asks first** — a second button, not a browser dialog.
- **The browser tests now run a Worker with one extra plugin.** The entry is
  no longer byte-for-byte the four lines a generated site has; it is those
  lines plus a plugin, switched off unless a spec turns it on.
- Record reads need `export` and writes `content:write`, matching a panel's
  list and its update actions (Task 19).

## 4. Verification

- `test/worker/records-panel.test.ts`, through `SELF.fetch`: what the admin
  is told; create with money and rows stored by the plugin; load in the saved
  shape; edit adding and removing rows; field-by-field refusal before the
  plugin runs; the plugin's own refusal; undeclared fields never reaching a
  handler; delete, and no delete without `remove`; scopes both ways; 404 and
  405; sorting both ways; four hostile `sort` values ignored with the table
  intact; search including literal `%` and `_`; a panel declaring neither
  unchanged.
- `test/core/records.test.ts`: every field type's acceptance and message;
  money's integer rule; row limits; what a manifest may and may not declare.
- `test/worker/plugin-shape.test.ts`: `definePlugin` refusing a records
  panel without handlers, and handlers without a panel.
- **In a browser** (`test/e2e/10-records-panel.spec.ts`): the whole loop of
  §1 clicked through against a real Worker, including a row removed from the
  middle keeping the other row's typed values, the money field reopening as
  `99.50`, `aria-sort` on the sorted heading, and a panel without `remove`
  showing no delete.
- Mutation checks, each restored afterwards: no validation before the plugin,
  undeclared fields passed through, writes allowed with `export` alone, any
  column sortable, wildcards unescaped, fractional money accepted, and delete
  without a handler each turn at least one case red.
- A plugin with a records panel and typed handlers compiles against the
  packed tarball.
- `pnpm admin:size`: the first load is unchanged in kind — the form is in a
  chunk of its own.
- The inquiry plugin's panel and tests are unchanged.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

- Two things this run turned up in earlier work and fixed: the snapshot
  test needed the two new entries, and `test/worker/render-data.test.ts` had
  a race of its own making — its cold-render helper did not wait for the
  cache write, so now and then the next "cold" render was a hit. It failed
  once in the full run; the helper now waits, and four runs in a row pass.

## 5. Notes for the next release

- **Fixed: the admin went blank when a second content item was opened in one
  session** (any lazily loaded screen mounted twice).

## 6. Not done / known limits

- **The record form was not put through the accessibility scan.** The
  browser test finds every control by role and label, which is evidence of
  labelling and not an audit.
- No `image`, `file` or `reference` fields in a record.
- Search scans the table; sorting and search have no index of their own.
- A record form cannot show related rows from another table or take action
  parameters (Task 32), and is not attached to the content editor (Task 29).
- Money's decimal places come from the browser's `Intl`; a currency code the
  browser does not know is treated as having two.
- Nothing bounds what a plugin's `load` and `save` cost.
