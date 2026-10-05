# Task 23 — Plugin-declared cache tags

- Status: **done**.
- Date: 2026-10-05
- Scope: a `renderData` result may declare cache tags for the page; the core
  namespaces them `p:<plugin-id>:<tag>` and adds them to `Cache-Tag`.
  `ctx.purgeTags` purges the calling plugin's own tags, or `site`.
- Source: the owner's task list of 2026-10-01, item M3
  (`docs/IMPLEMENTATION_PLAN.md`, phase six), with the owner's decision of
  2026-10-05: a plugin may purge only its own namespace, plus `site`.

## 1. Demonstrable loop

A plugin returns `cacheTags: ['product-42']` from `renderData`. The product's
page, and every list that printed that product's price, carry
`p:<plugin>:product-42`. When the price changes the plugin calls
`ctx.purgeTags(['product-42'])`, and the purge request names that one tag.
The same call with `c:<id>` or another plugin's tag names nothing outside the
plugin's own namespace.

## 2. What changed

| File | Change |
| --- | --- |
| `src/worker/render-data.ts` | Splits `cacheTags` off each hook's result and namespaces it |
| `src/worker/pages/*.page.ts` | The four page shapes append the plugin tags to their cache policy |
| `src/worker/cache.ts` | `pluginCacheTag`, `pluginPurgeTags`; `purgeNow` sends at most 100 tags per call |
| `src/worker/plugin-runtime.ts` | `ctx.purgeTags` goes through `pluginPurgeTags` |
| `src/plugins/types.ts`, `src/worker/public.d.ts` | What `purgeTags` accepts, stated on the type |
| `test/worker/render-data.test.ts` | "cache tags" |
| `docs/` | `PLUGIN_API §5.6, §6, §9.1, §13.2, §13.3`, `ARCHITECTURE §6.2`, the plan |

## 3. Decisions and deviations

- **The restriction is by construction, not by filtering.** A plugin passes
  the short name it declared; the core prefixes everything but `site`. There
  is no list of forbidden tags to keep up to date and no error to handle: a
  core tag or another plugin's, spelled in full, simply becomes a tag in the
  caller's own namespace that no page carries.
- **This changes `ctx.purgeTags` for version 1 plugins too.** Before, it
  purged whatever it was given. It is listed in `PLUGIN_API.md §13.3` and
  belongs in the release's upgrade notes. The official plugin never called it.
- **Validation is the runtime's, not new code.** `validateTags` in
  `src/runtime/core/cache.ts` already enforces Cloudflare's rules for every
  tag on a page and reports each one it drops; plugin tags go through it like
  the core's. The plan's "truncated with a logged event" is therefore
  "dropped with a logged event": a truncated tag would be a different tag,
  one nobody purges.
- **Plugin tags come after the core's**, so the 16 KB header limit can cost a
  plugin's tag and never the tag a content save purges.
- **`purgeNow` now splits at 100 tags.** Not in the task; the limit existed
  already and nothing respected it, and plugins purging per row make it
  reachable. The first failed call stops the rest: each call spends from the
  plan's purge rate.
- The purge side does not validate tag syntax. A tag that could not be put on
  a page cannot match one; purging it is a wasted name in a call, not an
  error.
- Tags are passed as written. Cloudflare compares them without regard to
  case; the docs say so rather than the core lower-casing them.

## 4. Verification

- **Cloudflare's limits were read on 2026-10-05**, not recalled:
  `developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/` (page
  dated 2026-08-21) for the header rules, and
  `developers.cloudflare.com/cache/how-to/purge-cache/` (page dated
  2026-09-29) for the rate limits and the 100-tag call limit.
- Through the real handler (`test/worker/render-data.test.ts`, "cache tags"):
  the exact `Cache-Tag` of a content page with two plugins' tags, duplicates
  removed, core tags first; the same on a list, a tag archive and the home
  page; a tag with a space, a comma or 1,100 characters dropped and logged
  while a good one stays; a `cacheTags` that is not a list of strings ignored
  and logged; no tags on a degraded page; the reserved key absent from
  templates.
- `ctx.purgeTags`, built by the real `buildPluginContext` with the purge API
  stubbed: the request body names the plugin's own tags and `site`, and a
  core tag and another plugin's tag arrive inside the caller's namespace.
- `purgeNow` with 250 tags makes calls of 100, 100 and 50, and stops after a
  429.
- Mutation checks, each restored afterwards: letting a plugin purge anything,
  not namespacing page tags, dropping plugin tags from the content page and
  from the home page, passing the reserved key to templates, and not
  splitting calls each turn at least one case red.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Notes for the next release

- **`ctx.purgeTags` now purges only the calling plugin's own tags, and
  `site`.** A plugin that purged a core tag such as `c:<id>` must declare its
  own tag from `renderData` and purge that, or purge `site`.

## 6. Not done / known limits

- **No purge was sent to Cloudflare.** That a purge by `p:…` tag evicts
  exactly the pages carrying it is Cloudflare's behaviour and is not exercised
  here; the tests show the tags on the pages and the tags in the request.
  The task's acceptance line "purging one affects only the matching pages" is
  `VERIFIED_LOCAL` in that sense only.
- **The rate limit is not guarded.** Coalescing reduces calls; nothing stops a
  plugin from purging a tag a second for a minute and being refused by
  Cloudflare, and a refused purge is not retried.
- A purge is coalesced per isolate and sent with the environment of the first
  caller in the window. In production every caller has the same environment;
  it surfaced only in a test.
- A plugin cannot purge a core tag. One whose change affects a page it did
  not tag has `site` and nothing finer.
