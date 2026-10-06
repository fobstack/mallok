# Task 32 — Action parameters and related rows

- Status: **done**.
- Date: 2026-10-06
- Scope: a panel action may declare parameters the admin asks for before it
  runs; a panel may declare child tables whose rows are shown with one of its
  rows.
- Source: the owner's task list of 2026-10-01, item M6 parts C and D
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

In the admin, select a row, press "Set status": a form asks for the new
status and a reason. Submitting it without a status puts "This field is
required." on that field; choosing one runs the action and the row's badge
changes. Open the row: under its fields is a "Variants" table with that
row's variants and nobody else's.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/plugin.ts`, `records.ts` | `params` on an action, `related` on a panel, and their rules |
| `src/worker/admin-plugins.ts` | Parameters validated and passed to the handler; `GET …/related/<id>` |
| `src/plugins/types.ts`, `src/worker/public.d.ts` | The handler's third argument; the declarations |
| `src/admin/components/related-rows.tsx` | New: the related tables, and the cell formatting panels share |
| `src/admin/components/record-editor.tsx`, `plugin-panel.tsx`, `types.ts`, `styles.css` | The parameter dialog; related rows in the detail view and the edit form |
| `test/fixtures/catalog-plugin.ts` | Two actions and a related table |
| `test/worker/records-panel.test.ts`, `test/core/records.test.ts`, `test/e2e/10-records-panel.spec.ts` | New cases |
| `docs/` | `PLUGIN_API §7.5, §13.2`, `ADMIN §10`, the plan |

## 3. Decisions and deviations

- **Parameters are the handler's third argument: `(ids, ctx, params)`.** The
  task list has `(ids, params, ctx)`. Every existing handler is
  `(ids, ctx)`; putting the new argument second would hand a version 1
  handler the parameters where it expects its context. Third, it is simply
  ignored by handlers that do not take it.
- **`params` is a map keyed by name**, like a record's `fields`, not the
  draft's array of `{ id, … }`. One vocabulary and one validator serve both.
- **Parameters are validated by `validateRecord`**, so an action's form and
  a record's form cannot disagree, and only declared parameters arrive.
- **Related rows are read by the core**, like a panel's list, with table and
  column names from the manifest only. They are read-only: editing child
  rows is what a `rows` field is for.
- A related table must carry the plugin's own prefix, like a panel's table.
- A `download` action cannot take parameters: it is a navigation, not a
  form.

## 4. Verification

- `test/worker/records-panel.test.ts`, "action parameters and related rows":
  the handler receiving checked parameters in declared order with a stray
  key dropped; four refusals answered 422 by field with nothing changed; an
  action declaring none receiving `{}` whatever was sent; what the admin is
  told, the inquiry panel unchanged; a row's related rows, in order, declared
  columns only, none for another row; `export` required, 400 without a
  parent, 404 for an undeclared table.
- `test/core/records.test.ts`: what a manifest may declare, including a
  related table outside the plugin's prefix and `rows` as a parameter, both
  refused.
- **In a browser** (`test/e2e/10-records-panel.spec.ts`): the parameter form,
  the server's message on the field, the action running and the row's badge
  changing, and the related table inside the edit form.
- The inquiry plugin's actions, which take two arguments, pass unchanged.

## 5. Not done / known limits

- At most 100 related rows are shown, with a note when there are more.
- Related rows cannot be sorted, searched or acted on.
- A text parameter's `max` is enforced by the input itself in the browser,
  so its server message is only seen by API callers.
