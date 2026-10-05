# Task 25 — Rate-limit tiers

- Status: **done**.
- Date: 2026-10-05
- Scope: a plugin route asks for a `strict` or a `relaxed` rate limit, each a
  binding in the site's `wrangler.jsonc`, and every route has its own count
  per visitor.
- Source: the owner's task list of 2026-10-01, item M4 part 4, moved into P0
  on 2026-10-01 (`docs/IMPLEMENTATION_PLAN.md`, phase six), with the owner's
  decisions of 2026-10-05: a second binding **and** the key by route; a
  `relaxed` route on a site without the second binding falls back to the
  strict one and logs it.

## 1. Demonstrable loop

A plugin declares `cart/add` as `"rateLimit": "relaxed"` and `checkout` as
`"strict"`. On a site made from the current template the cart is counted
against `RATE_LIMITER_RELAXED` (120 a minute) and the checkout against
`RATE_LIMITER` (10 a minute), each under its own key, so using up the cart's
budget leaves the checkout's untouched. On a site that has only the first
binding, the cart is held to 10 a minute and the log says which binding is
missing.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/plugin.ts` | `rateLimit` accepts `"strict"` and `"relaxed"` as well as a boolean; the names need plugin API 2 |
| `src/worker/plugin-runtime.ts` | Chooses the binding, falls back and logs, keys by plugin, route and IP |
| `src/worker/env.ts`, `public.d.ts` | `RATE_LIMITER_RELAXED`; the declared type of `rateLimit` |
| `src/cli/site-config.ts` | `relaxedRateLimitNamespace`; the second namespace written and checked |
| `template/wrangler.jsonc`, `scripts/e2e-config.mjs` | The second binding |
| `test/worker/plugin-routes.test.ts`, `test/core/plugin.test.ts`, `test/cli/site-config.test.ts` | The tiers, the manifest rule, the configuration |
| `docs/` | `PLUGIN_API §4, §7.2, §13.2`, `CLOUDFLARE_RESOURCES §4, §5`, `SECURITY`, the plan |

## 3. Decisions and deviations

- **Nundar's checkout budget cannot be expressed, and the docs say so.** The
  task list asks for "about 10 per 10 minutes". Cloudflare's binding accepts
  a period of 10 or 60 seconds only (read 2026-10-05), so the strict tier is
  10 a minute. A plugin that needs a longer window counts in its own table.
- **The limits stay in `wrangler.jsonc`.** A manifest names a tier and never
  a number: the site's owner sets the numbers, and the runtime can only
  enforce what a binding is configured with.
- **The key changed for every plugin**, version 1 included: from
  `<plugin>:<ip>` to `<plugin>:<route>:<ip>`. It is a loosening, not a new
  check — two rate-limited routes of one plugin no longer share a budget — so
  it is in the upgrade notes rather than `PLUGIN_API.md §13.3`. The official
  plugin has one rate-limited route and behaves as before.
- **The route in the key is the declared path**, so `orders/:orderNo` is one
  budget and trying many order numbers does not multiply it; the locale
  segment is not in the key either.
- **The second namespace is the first plus one.** One recorded value — the
  ledger's, or `--rate-limit-namespace` — decides both, and the
  configuration fingerprint is unchanged, so resuming a `mallok create`
  started before this release still works.
- **`mallok create` checks the relaxed binding only when the file has one.**
  A project file from before the tier is valid; a file where both bindings
  share a namespace is refused.
- **`mallok upgrade` does not add the binding.** It writes `package.json`,
  the lockfile and its journal, never `wrangler.jsonc`. An existing site adds
  four lines by hand (`CLOUDFLARE_RESOURCES.md §4`); until then the fallback
  applies.
- No event is logged when a site has no rate-limit binding at all. That was
  already the documented best-effort state.

## 4. Verification

- **Cloudflare's binding was read on 2026-10-05**
  (`developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/`,
  page dated 2026-04-23): `period` 10 or 60; several bindings per Worker;
  `namespace_id` a positive integer unique in the account; "permissive,
  eventually consistent"; counted per location; keying on IP not recommended.
  **The page states no plan or price**, as on 2026-09-29.
- `test/worker/plugin-routes.test.ts`, "rate-limit tiers", through the real
  route handler with recording bindings: which binding and which key each
  route uses, including `true`, a version 1 plugin, a parameter and a locale
  segment; one route refused with 429 while another route and another
  visitor pass; the fallback, with the logged event; no binding at all.
- `test/core/plugin.test.ts`: the values accepted, and a named tier refused
  under plugin API 1.
- `test/cli/site-config.test.ts`: both namespaces written into the fixture
  and into the real `template/wrangler.jsonc`, different from each other;
  a shared namespace refused; a one-binding file accepted; the template's
  periods are 10 or 60.
- Mutation checks, each restored afterwards: a key without the route, the
  relaxed tier sent to the strict binding, no fallback, the second namespace
  not written, and a named tier allowed under version 1 each turn at least
  one case red.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Notes for the next release

- **Existing sites: add `RATE_LIMITER_RELAXED` to `wrangler.jsonc` and
  deploy** (`CLOUDFLARE_RESOURCES.md §4`). Until then `relaxed` routes are
  held to the strict limit.
- Rate-limited routes are now counted separately per route.

## 6. Not done / known limits

- **No real binding was exercised.** The tests stand in for the bindings;
  that two namespaces on one Worker count separately on Cloudflare is the
  documented behaviour, not something run here.
- **Whether the Free plan includes rate-limit bindings is still not stated by
  Cloudflare.** A second binding does not change that question, and a site
  where bindings are unavailable has no rate limiting at all.
- Two tiers only. A third needs a third binding and a task of its own.
- The 429 response carries no `Retry-After`.
