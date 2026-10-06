# Task 34 — Site-provided starter content

- Status: **done**.
- Date: 2026-10-06
- Scope: a site registers its own starter, the first-run wizard offers and
  imports it, and the starter can fill its plugins with sample data.
- Source: the owner's task list of 2026-10-01, item M11
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A site's Worker entry passes `starters: [shop]` to `createMallok`. On a
fresh deployment the wizard's third step lists "A small shop — 3 pages · 7
sample records" first and preselected. Installing it publishes the
products, switches on the shop's plugin, and creates the catalog items with
their variants and a note attached to one product — each through the
plugin's own `save` handler. The last screen says how many pages and
records were added and lists the ones that were refused, with the reason.

## 2. What changed

| File | Change |
| --- | --- |
| `src/starters/define.ts` | New: `defineStarter`, `normalizeStarters`, `StarterDefinitionError` |
| `src/starters/types.ts`, `index.ts` | `StarterRecord`, `Starter.records`; `findStarter` removed (unused) |
| `src/worker/framework.ts`, `public.d.ts`, `composition.ts` | `createMallok({ starters })`, the exports and their declarations, `siteStarters()` |
| `src/worker/setup.ts` | The wizard offers the site's starters first and imports their records |
| `src/worker/admin-plugins.ts` | `savePluginRecord`: the record save path, shared by the admin API and the wizard |
| `src/admin/pages/setup.tsx` | Sample-record counts, and what could not be imported |
| `test/worker/setup-site-starter.test.ts`, `test/e2e/01-wizard.spec.ts`, `test/e2e/worker/index.ts` | New cases |
| `docs/` | `ARCHITECTURE §11.1`, `ADMIN §5`, `PLUGIN_API §7.5, §13.2`, the plan |

## 3. Decisions and deviations

- **Owner decision, 2026-10-06:** `createMallok({ theme, plugins,
  starters })`, not a documented `mallok publish` flow.
- **The site's starters are added to the official one, and come first.**
  The owner's text says a site "registers" a starter; it does not say the
  official one goes. Removing it would need a way to ask for it back. The
  wizard preselects the first entry, so a site's starter is what a click on
  Install gets. A starter written for another theme is already labelled as
  such.
- **Sample plugin data is `records` on the starter**, each naming a plugin,
  one of its `records` panels and the values its form would submit. This is
  the plan's "written through Task 28's declared write handlers" made
  concrete: the wizard never writes a plugin table and has no knowledge of
  variants.
- **One save path.** The check-then-`save` sequence was lifted out of the
  admin route into `savePluginRecord`, and the admin route now calls it.
  No behaviour of the admin API changed; its tests are untouched and pass.
- **An attached record names its owner by kind and slug**, since a
  starter cannot know a translation group that does not exist yet. The
  wizard resolves it to the group of the document it just imported.
- **Checked at module load, reported at run time.** Everything that can be
  known without a database fails `createMallok`, and so the deployment.
  What depends on the data — a refused document, a refused record, a
  handler that throws — is reported and the import goes on. A wizard that
  stops halfway leaves a site that is harder to recover than one with a
  record missing.
- **An official starter's id cannot be reused.** A site cannot replace
  `trade-b2b` by naming its own starter that.
- **`defineStarter` is optional.** `createMallok` validates whatever it is
  given; `defineStarter` exists so that the error is raised in the
  starter's own file.
- **The wizard's last screen now also lists documents that failed.** The
  response always carried them; the interface did not show them.
- No interface for `mallok build`: a static build has no plugins and no
  wizard, and reads `content/` directly.

## 4. Verification

- `test/worker/setup-site-starter.test.ts`, through `createMallok` and the
  wizard's endpoints on a fresh database: the site's starter listed first
  with its counts; its documents and translation imported and one refused;
  three records saved and four reported — refused by the declared fields,
  refused by the plugin, owner not imported, handler threw — with the
  import continuing past all of them; the rows the plugin wrote, including
  a `rows` field's children and a `money` value, and an undeclared value
  dropped; the attached record keyed by the product's translation group,
  which its translation shares; the plugins switched on and the settings
  applied; the page served; an unknown starter answered 404. And what
  `createMallok` refuses: eleven malformed starters, each by its message.
- Each guarantee was checked by breaking it: seventeen single changes
  (the order, site starters not importable, stopping at the first failure,
  letting a throw escape, skipping the field check, passing unchecked
  values, the wrong group, the count, and each of the nine definition
  checks) each turned at least one test red.
- `test/e2e/01-wizard.spec.ts`: in a browser, the site's starter is listed
  first, preselected, with "1 pages · 1 sample records"; the official one is
  then chosen and the rest of the suite runs on it as before.
- `test/worker/records-panel.test.ts` and `attached-panel` tests: unchanged
  and passing, over the refactored save path.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 5. Not covered, and known risks

- **Not run on a real account.** A starter is imported in one request: every
  document is rendered and saved, then every record. The official starter
  already does this with about two dozen saves; how many documents and
  records fit in one invocation on the Free plan has not been measured, and
  nothing limits how many a starter may carry. A request that is stopped
  partway leaves what was imported so far; running the step again adds the
  missing documents and resubmits every record.
- **Resubmitted records.** On a second run, whether a record is stored
  twice depends on the plugin's `save`.
- **The list of what could not be imported is not covered by a browser
  test**, only its data by the Worker test.
- The acceptance in the owner's list — "a fresh deployment ends up as a
  shop with sample products and variants" — is shown with the test
  fixture plugin, not with Nundar's.
- `ARCHITECTURE §11` still says "Importing again overwrites, and requires
  explicit confirmation". Nothing in the code does that; the sentence
  predates this task and was left for a separate correction.
