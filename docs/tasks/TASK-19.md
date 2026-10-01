# Task 19 — Scope check on plugin panel reads

- Status: **done**; to ship on its own as `0.1.0-rc.8` (owner decision,
  2026-10-01).
- Date: 2026-10-02
- Scope: close the gap that let any API token read every plugin panel.
- Source: the owner's task list of 2026-10-01, item M6 part F
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A token created with only `content:write` — a publishing token for CI, say —
asks for the inquiry panel's rows and gets `403 This operation needs the
"export" scope.` A token with `export`, and the administrator's own session,
still read them.

## 2. What the gap was

Every plugin route in `src/worker/admin-plugins.ts` went through `withScope`
except one: `GET /_mallok/api/plugins/<id>/panels/<panel>`. The management
API's design is that scopes guard writes and reads stay open to any valid
token, so on its own an unscoped read is not a mistake. Panel rows are
different: the inquiry panel returns buyers' names, email addresses and
messages, which the site export (`GET /_mallok/api/export`, including
`inquiries.csv`) and the panel's own CSV download action already put behind
`export`. The panel read was a way around that scope.

## 3. Decisions and deviations

- **Owner decision, 2026-10-02: require the existing `export` scope** rather
  than add a new read scope. It is the scope already guarding the same rows,
  it needs no change to the token model or the admin, and existing tokens
  that hold `export` are unaffected. A new scope (for example `plugins:read`)
  would have taken panel access away from every existing token on upgrade.
- Sessions hold every scope (`hasScope` in `src/worker/auth.ts`), so the
  admin's panel pages behave exactly as before.
- Panel actions were already scoped (`download` → `export`, others →
  `content:write`) but undocumented; `PLUGIN_API.md §7.5` now lists all three.

## 4. Verification

- New test, `test/worker/inquiry.test.ts`, "reads panel rows only with the
  export scope, as the CSV export does": a `content:write`-only token is
  refused with 403 and the scope named; a token with `export` and a session
  both get 200.
- Red-green: with the one-line fix reverted and the test kept, the test fails
  with `expected 200 to be 403`; with the fix restored it passes, along with
  the other 13 tests in the file, including the existing panel listing and
  CSV export tests.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Upgrade note for rc.8

API tokens without the `export` scope can no longer read plugin panels; they
receive 403. Give such a token `export` if it needs the rows. Admin sessions
are unaffected.

## 6. Not done / known limits

- The site export, `GET /_mallok/api/plugins` and the other reads remain
  unscoped by design (`SECURITY.md §3.4`); `GET /_mallok/api/plugins` returns
  plugin settings values but never secrets.
- Releasing rc.8 follows `docs/RELEASE_GATE.md` and needs the owner for the
  test-site deploy and the npm publish.
