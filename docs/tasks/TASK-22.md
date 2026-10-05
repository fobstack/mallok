# Task 22 — The `renderData` hook

- Status: **done**.
- Date: 2026-10-05
- Scope: a render-path hook through which a plugin reads its own tables while
  a page is rendered, and a `plugins` object in the view through which a theme
  prints what it read. The build's plugin API version becomes 2.
- Source: the owner's task list of 2026-10-01, item M2
  (`docs/IMPLEMENTATION_PLAN.md`, phase six), with the owner's decisions of
  2026-10-05: the database handle rejects writes; a failing hook loses its
  data, the page renders, the failure is logged and the page is not cached.
  Task 41 (structured data from the same hook) follows on the same branch.

## 1. Demonstrable loop

A site lists a plugin with a `renderData` hook and a theme that prints
`plugins.<id>`. A product page, a list, a tag archive and the home page show
what the plugin read from its table, in the cached HTML. Break the plugin —
make it throw, query twice, or write — and the same page still answers 200
without that data, a structured event names the plugin, and the next request
renders it again instead of being served the lesser page from the cache.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/plugin.ts` | `renderData` joins the hook names; `PLUGIN_API_VERSION` is 2; a version 2 hook under `pluginApi: 1` is refused |
| `src/core/page.ts`, `view.ts` | `PageView.plugins`, filled from `ViewContext.plugins`, empty where no plugin code runs |
| `src/worker/render-data.ts` | New. The guarded database handle, the read-only check, and `runRenderData` |
| `src/worker/pages/*.page.ts`, `context.ts` | The four page shapes run the hooks, pass the result to the view, and do not cache a degraded page |
| `src/worker/render.ts` | `RenderContext.plugins` |
| `src/plugins/types.ts`, `src/worker/public.d.ts`, `framework.ts` | `PluginRenderDataContext`, the hook's signature, the public export |
| `test/worker/render-data.test.ts` | New: a composed Worker with a probe theme and three test plugins |
| `test/core/plugin.test.ts`, `test/cli/strict-consumer.test.ts`, `test/types/public-surface.ts` | The manifest rule; a plugin written against the tarball alone; the public types in both directions |
| `docs/` | `PLUGIN_API §5, §5.6, §6, §9, §13.1, §13.2`, `THEME_FORMAT §7.1, §7.9`, `ARCHITECTURE §4`, the plan |

## 3. Decisions and deviations

- **The limit of two plugins is enforced, not only documented.** The plan
  said "at most two plugins on a page may use `renderData`, and the docs say
  so". The same plan argues, for the one-call rule, that a guard which is not
  in production leaves the budget unguarded; that applies equally here. The
  first two enabled plugins in the site's compiled order run; a further one is
  skipped and `render_data_skipped` is logged. **A skipped plugin does not make
  the page uncacheable**: it is a standing property of the site's composition,
  and refusing to cache would turn a configuration mistake into every request
  being a cold render. This is a decision made here, not by the owner.
- **The limit counts plugins, not calls.** A hook that makes no database call
  still takes one of the two places. Counting calls across concurrent hooks
  would make which plugin is refused depend on timing.
- **Keys are not renamed.** The plan says the result reaches templates "in
  `snake_case`". The core passes the plugin's keys through and the docs tell
  plugin authors to use `snake_case`; rewriting keys would make the data a
  plugin returns differ from the data its templates read. Only the top-level
  key is derived: the plugin id with hyphens as underscores, so
  `plugins.my_shop` needs no bracket syntax.
- **"JSON-serialisable" is enforced by a JSON round trip.** A function
  disappears, a cycle fails the hook, and what the template engine receives is
  plain data. No size limit is imposed.
- **A violation the hook swallows still fails it.** The handle records the
  first rule broken; a `try`/`catch` around the second query does not turn a
  refused call into a successful hook.
- **The read-only check is by keyword** and the docs say what that means: it
  can refuse a legitimate query with `;` or a write keyword inside a string
  literal, and it is not a sandbox.
- **A version 2 hook requires `"pluginApi": 2`.** Not in the plan; without it
  a manifest could claim to be written for a version that never had the hook.
- `PageView.plugins` is always present, `{}` when nothing ran, so the static
  build and the admin preview render a theme that reads it.
- The home page's hook runs in `load`, with the covers query, so its outcome
  is known to `cache`.

## 4. Verification

- `test/worker/render-data.test.ts`, against the real handler:
  data on a content page, a list, a tag archive and the home page; escaping;
  the context the hook receives; one extra round trip and never more than
  four; no call on a cache hit; byte-identical HTML from the same state; no
  call for a disabled plugin or a 404; each of six ways to fail (throw, second
  query, second query swallowed, write, array, cycle) renders 200 without the
  data, logs once, answers `BYPASS`/`no-store`, and the next request is a
  `MISS` with the data; a refused write changes nothing; a third plugin is
  skipped, logged, and the page is still cached.
- Mutation checks, each restored afterwards: removing the call limit, ignoring
  a swallowed violation, allowing writes, caching a degraded content page,
  caching a degraded home page, lifting the plugin limit, and skipping the
  JSON round trip each turn at least one case red.
- A plugin compiled against the packed tarball with `skipLibCheck` off defines
  under plugin API 2 and is refused under 1.
- `pnpm typecheck` fails in `test/types/public-surface.ts` when the public
  declarations and the real types disagree (seen while adding the hook name).
- The existing tests pass unchanged, the five official themes among them; `test/worker/budget.test.ts` still reads two round trips with no
  `renderData` plugin enabled.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Notes for the next release

- The build supports plugin API 2. A plugin declaring `"pluginApi": 2` is
  accepted from this release on, **while most of version 2 is still planned**
  (`PLUGIN_API.md §13.2` says what exists).
- Themes gain `plugins`; existing themes are unaffected.

## 6. Not done / known limits

- **No CPU measurement.** The hooks, the JSON round trip and the extra query
  all add to a cold render that already exceeded the 10 ms target on rc.5.
  Nothing here was measured on a deployed Worker.
- **No plugin cache tags yet** (Task 23): a change in a plugin's table reaches
  a cached page only when the page is purged or expires.
- **The admin does not warn** when more than two enabled plugins implement
  `renderData`; the only signal is the logged event.
- No timeout: a hook that never settles holds the page.
- The hook cannot tell a home page from a list page except by `ctx.path`.
