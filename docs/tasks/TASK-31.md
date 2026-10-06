# Task 31 — Raw-body routes

- Status: **done**.
- Date: 2026-10-06
- Scope: a plugin route may declare `"body": "raw"`; the core parses nothing
  and the handler reads the bytes exactly as sent, so a signature over them
  can be verified.
- Source: the owner's task list of 2026-10-01, item M8, with its note of
  2026-10-05 on what the first consumer needs
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A plugin declares `webhook` as a raw route. A request whose body is
`{ "b":1,\r\n  "a" : "Grüße — 你好",   "n": 1e3 }\r\n\n`, signed with HMAC-SHA256
over those bytes, reaches the handler with those bytes; the handler's own
HMAC matches. A wrong signature is answered with the handler's 400, a
failure with its 500, and a body over the cap with 413 before the handler
runs.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/plugin.ts` | `body: "raw"` and `maxBytes` on a route, and their rules |
| `src/worker/plugin-runtime.ts` | The raw path: no cross-site check, no parsing, a capped read, the response passed through |
| `src/worker/public.d.ts` | The declaration's two new members |
| `test/worker/plugin-routes.test.ts`, `test/core/plugin.test.ts` | New cases |
| `docs/` | `PLUGIN_API §7.2, §13.2`, `SECURITY §7`, the plan |

## 3. Decisions and deviations

- **Stripe states no maximum event size.** The task asked for this to be
  verified; `docs.stripe.com/webhooks`, read 2026-10-06, gives none. The
  default cap is therefore 256 KiB by judgement, a route may declare up to
  1 MiB, and the docs say the figure is ours.
- **The body is read by the core, under the cap, and handed on as a new
  request with the same bytes.** "The handler reads the untouched request"
  is kept in the sense that matters — not one byte differs — while a sender
  cannot make the Worker hold an unbounded body. A test sends bytes that are
  not valid text, to show nothing is decoded on the way.
- **The cap applies while reading**, not only to `Content-Length`: a stream
  with no declared length is cut off.
- **The handler must return a `Response`.** Anything else is a 500 with the
  route named in the log, as for other routes.
- Rate limiting stays as declared rather than being forbidden: the task says
  "may disable".
- A raw route combined with Turnstile, or with `render: "page"`, is refused
  at build time.

## 4. Verification

- `test/worker/plugin-routes.test.ts`, "a raw-body route", through
  `SELF.fetch`: the exact bytes and a verifying HMAC, with CRLF, irregular
  spacing, non-ASCII and a trailing newline; binary bytes; a body that is not
  JSON; an empty body; statuses 400, 500, 202 and 200 passed through; a
  request marked cross-site accepted on the raw route while the same headers
  are refused on a parsed one; 413 one byte over the default cap, at a
  route's own cap, and for a stream with no length.
- `test/core/plugin.test.ts`: what a manifest may declare.
- Mutation checks, each restored afterwards: applying the cross-site check,
  not capping the read, not capping at all, and re-encoding the body as text
  each turn a case red.

## 5. Not done / known limits

- **No real payment provider has called it.** The signature in the tests is
  a plain HMAC with a fixed key, not Stripe's scheme with its timestamp.
- The route is as open as its handler makes it: a raw route that verifies
  nothing accepts anything from anyone.
- The body is held in memory up to the cap.
