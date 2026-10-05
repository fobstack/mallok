# Task 24 — Route enhancements

- Status: **done**.
- Date: 2026-10-05
- Scope: plugin routes with several segments and parameters, a locale
  segment after the plugin id, and JSON bodies passed whole. Rate-limit tiers
  are Task 25.
- Source: the owner's task list of 2026-10-01, item M4 parts 1–3
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A plugin declaring plugin API 2 lists `cart`, `orders/new` and
`orders/:orderNo`. `/_mallok/p/shop/de/orders/A-1001` reaches the last one
with `input.params.orderNo` `A-1001` and `ctx.locale` `de`; the same path
without `de` reaches it in the site's default language; `orders/new` is not
taken for an order number. A JSON body's `quantity: 3` arrives as the number
3 in `input.json`.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/plugin.ts` | Route paths with segments and `:parameters`; the manifest rules for them; `matchPluginRoute` |
| `src/worker/plugin-runtime.ts` | Path splitting and decoding, the locale segment, `input.params`, `input.json`, `ctx.locale` |
| `src/plugins/types.ts`, `src/worker/public.d.ts` | `RouteInput.params`, `RouteInput.json` |
| `test/worker/plugin-routes.test.ts` | New: a version 2 and a version 1 plugin through the real Worker |
| `test/core/plugin.test.ts`, `test/cli/strict-consumer.test.ts` | The manifest rules and the matcher; a handler typed against the tarball |
| `docs/` | `PLUGIN_API §6, §7.2, §13.2`, the plan |

## 3. Decisions and deviations

- **Everything new is for plugins declaring API 2; a version 1 plugin is
  routed exactly as before.** The plan put the locale-shape refusal on every
  route. Applied to version 1 it would break a plugin whose route happens to
  be named `go` or `my-cart`, against the rule that version 1 runs unchanged;
  and a locale segment read for version 1 would hide such a route on a site
  that enables that locale. So for version 1 there is no locale segment, no
  second segment, and no shape check — the old behaviour, tested with a
  version 1 route named `de` on a site whose locales include `de`.
- **The shape check covers the first segment only.** The plan says "route
  segments". Only the first can be read as a locale, and refusing `orders/go`
  would restrict authors for no gain.
- **The shape is wider than it looks**: `LOCALE_PATTERN` is two letters,
  optionally `-` and two to four more, so `my-cart` and `to-pay` are refused
  as well as `de`. The build error says what the shape is and why.
- **The first segment must be a name.** A route `:id` would capture every
  one-segment request, the locale among them.
- **A name beats a parameter; then declaration order.** Routes with the same
  shape are refused at build time, so the tie-break only arises between
  patterns like `a/:x/c` and `a/b/:y`.
- **Parameters are decoded and bounded, not validated.** An encoded slash,
  `.`/`..`, an empty segment, invalid encoding and anything over 200
  characters are 404s. The docs tell authors a parameter is visitor text.
- **`input.json` is the whole body, unvalidated; `input.fields` is
  unchanged.** A JSON array was already accepted before this task (with no
  fields) and still is; a scalar or `null` is still a 400.
- At most six segments. Not in the task; an unbounded pattern has no use and
  the bound keeps matching trivially cheap.

## 4. Verification

- `test/worker/plugin-routes.test.ts`, through `SELF.fetch` on a Worker
  composed with a version 2 and a version 1 plugin and a site with locales
  `en` and `de`: parameters across several segments; a name preferred to a
  parameter; decoding and the refusals above; 405 for the wrong method; the
  locale segment setting `ctx.locale`; a non-site locale (`fr`) not mistaken
  for one; a parameter that looks like a locale staying a parameter; numbers,
  booleans, `null` and nested values surviving in `input.json`; a form giving
  fields and no JSON; the version 1 plugin's `de` route reachable, in the
  default locale, with no locale segment and no second segment.
- `test/core/plugin.test.ts`: the manifest accepts and refuses what §3 says,
  and the matcher's ordering.
- A handler reading `input.params` and `input.json` compiles against the
  packed tarball with `skipLibCheck` off.
- Mutation checks, each restored afterwards: routing version 1 like version
  2, not reading the locale, dropping the JSON body, not preferring a name,
  allowing an encoded slash, and allowing a locale-shaped version 2 route each
  turn at least one case red.
- The inquiry plugin's tests pass unchanged.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not done / known limits

- **`onRequest` still sees the site default as `ctx.locale`.** Only route
  handlers get the locale segment.
- The rate-limit key is still `<plugin-id>:<ip>` for every route of a plugin
  (Task 25).
- No limit on the size of a JSON body beyond the platform's.
- A plugin that omits `pluginApi` gets the build's version, now 2, and with it
  the locale-shape check. One written before this release with a route named
  like a locale has to declare `"pluginApi": 1` or rename the route.
