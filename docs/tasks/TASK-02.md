# Task 02 — Authentication and the real management API

- Status: **complete**, all checks green locally
- Date: 2026-08-29
- Scope: replace the Task 01 shortcut (`Authorization: Bearer <MALLOK_SECRET>`)
  with sessions, CSRF and scoped API tokens, and grow the management API from
  two endpoints to the full content, settings and diagnostics surface.
- Contract: `docs/SECURITY.md §3`, `docs/ADMIN.md §12`, `docs/CLI.md §4`.

## 1. Demonstrable loop

> Bootstrap the administrator → sign in → mint a scoped token → publish from
> the command line with that token → revoke it and watch publishing stop.

Every step is exercised by tests; the shell transcript is in
`docs/tasks/TASK-01.md §1`, which was rewritten to use the new credentials.

## 2. What changed

| Area | Files | Notes |
| --- | --- | --- |
| Credential primitives | `src/worker/credentials.ts` | PBKDF2-SHA256 hashing with per-user salt, upgrade-on-login, opaque token minting, constant-time comparison. WebCrypto only. |
| Authorization | `src/worker/auth.ts` | Session and bearer principals, four scopes, CSRF check, cookie construction and parsing. |
| Persistence | `src/db/auth.ts` | `admin_user`, `session`, `api_token` access. Only SHA-256 of a credential is ever stored. |
| Router | `src/worker/admin.ts` | Two unauthenticated routes (bootstrap, login); everything else needs a principal, writes need a scope, cookie writes need CSRF. |
| Auth endpoints | `src/worker/admin-auth.ts` | bootstrap, login, logout, me, password change, token list/create/revoke. |
| Content endpoints | `src/worker/admin-content.ts` | list (drafts included), read one, save, delete. Save logic moved unchanged from `admin.ts`. |
| Settings endpoints | `src/worker/admin-settings.ts` | settings read/patch, health, diagnostics. |
| Queries | `src/db/queries.ts` | `listContent`, `deleteContent`, `updateSite`, `countStorage`, `appliedMigrations`. |
| Cron | `src/worker/scheduled.ts` | Expired sessions are now dropped each tick. |

No schema migration was needed: `0001_init.sql` already carried all three
tables (`docs/DATA_MODEL.md §2.8`).

## 3. API surface

| Method | Route | Credential | Scope |
| --- | --- | --- | --- |
| POST | `/_mallok/api/auth/bootstrap` | none, and only while no admin exists | — |
| POST | `/_mallok/api/auth/login` | none | — |
| POST | `/_mallok/api/auth/logout` | any | — |
| GET | `/_mallok/api/auth/me` | any | — |
| POST | `/_mallok/api/auth/password` | session only | — |
| GET | `/_mallok/api/tokens` | any | — |
| POST | `/_mallok/api/tokens` | any | `settings:write` |
| DELETE | `/_mallok/api/tokens/<id>` | any | `settings:write` |
| GET | `/_mallok/api/content` | any | — |
| GET | `/_mallok/api/content/<id>` | any | — |
| POST | `/_mallok/api/content` | any | `content:write` |
| DELETE | `/_mallok/api/content/<id>` | any | `content:write` |
| GET | `/_mallok/api/settings` | any | — |
| PATCH | `/_mallok/api/settings` | any | `settings:write` |
| GET | `/_mallok/api/health` | any | — |
| GET | `/_mallok/api/diagnostics` | any | — |

Scopes gate writes, not reads. A session carries every scope because 0.1 has a
single administrator; tokens carry only what was granted.

## 4. Decisions worth recording

1. **PBKDF2 at 50 000 iterations.** The only data available is the local
   benchmark (`TASK-01 §3.3`): 50 000 ≈ 7.8 ms in Node, which is the most that
   fits the Free plan's 10 ms budget. This is **below** the OWASP 2023
   guidance of 600 000. `GET /_mallok/api/auth/me` returns both numbers so the
   admin UI can state the gap rather than imply there is none. Raising the
   constant is safe: a login re-derives any hash stored with a lower cost.
   The real number comes from `TASK-01 §4.4` (§18 item 5).
2. **Deploy first, then set the secret.** `wrangler secret put` needs the
   Worker to exist, so `TASK-01 §4.1` was reordered.
3. **Changing `default_locale` returns 501.** It rewrites every public path
   and writes a redirect per row; that belongs to Task 06 with its own
   confirmation flow. Refusing is better than leaving paths inconsistent with
   the setting.
4. **Quota usage is reported as `null`.** D1 row-read and row-write quotas
   live in the Cloudflare analytics API, not in a binding. `GET
   /_mallok/api/diagnostics` says so instead of inventing a number.
5. **`MALLOK_SECRET` still guards `/_mallok/spike/*`** and nothing else. That
   route group is removed in Task 17.

## 5. Evidence

Environment for every run below: Node 22.22.2, workerd via
`@cloudflare/vitest-pool-workers` 0.22.0, macOS 24.6.0, vitest 4.1.11.

```
pnpm lint        → exit 0
pnpm typecheck   → exit 0
pnpm test        → exit 0   (8 files, 72 tests)
pnpm build       → exit 0
pnpm bundle:size → exit 0   (769.5 KiB raw, 203.6 KiB gzip, 6.6% of the Free limit)
```

| Requirement | Implementation | Test | Status |
| --- | --- | --- | --- |
| Bootstrap closes after the first admin | `src/worker/admin-auth.ts:66` `bootstrapAdmin()` | `test/worker/auth.test.ts:58` | `VERIFIED_LOCAL` |
| Wrong password and unknown account are indistinguishable | `src/worker/admin-auth.ts:93` `login()` | `test/worker/auth.test.ts:66` | `VERIFIED_LOCAL` |
| Session cookie is `HttpOnly; Secure; SameSite=Strict; Path=/_mallok` | `src/worker/auth.ts:119` `sessionCookie()` | `test/worker/auth.test.ts:82` | `VERIFIED_LOCAL` |
| CSRF required on session writes | `src/worker/auth.ts:104` `csrfOk()` | `test/worker/auth.test.ts:96` | `VERIFIED_LOCAL` |
| Bearer tokens exempt from CSRF | `src/worker/auth.ts:108` | `test/worker/auth.test.ts:120` | `VERIFIED_LOCAL` |
| Token scopes enforced on writes | `src/worker/admin.ts:137` `withScope()` | `test/worker/auth.test.ts:131` | `VERIFIED_LOCAL` |
| Revoked token stops working | `src/db/auth.ts` `findLiveApiToken()` | `test/worker/auth.test.ts:149` | `VERIFIED_LOCAL` |
| Token plaintext never returned twice | `src/worker/admin-auth.ts` `getTokens()` | `test/worker/auth.test.ts:183` | `VERIFIED_LOCAL` |
| Password cost disclosed honestly | `src/worker/admin-auth.ts:168` `whoami()` | `test/worker/auth.test.ts:193` | `VERIFIED_LOCAL` |
| Password change drops every session | `src/worker/admin-auth.ts:192` `changePassword()` | `test/worker/auth.test.ts:208` | `VERIFIED_LOCAL` |
| Only hashed credentials are stored | `src/worker/credentials.ts` `mintApiToken()` | `test/worker/credentials.test.ts` | `VERIFIED_LOCAL` |
| Corrupt password params return false, never throw | `src/worker/credentials.ts:76` `verifyPassword()` | `test/worker/credentials.test.ts` | `VERIFIED_LOCAL` |
| End-to-end: bootstrap → login → token → publish | the whole chain | `test/worker/flow.test.ts:55` | `VERIFIED_LOCAL` |
| Admin list shows drafts | `src/worker/admin-content.ts:53` `getContentList()` | `test/worker/flow.test.ts:233` | `VERIFIED_LOCAL` |
| Markdown round-trips through read | `src/worker/admin-content.ts:80` `getContentItem()` | `test/worker/flow.test.ts:246` | `VERIFIED_LOCAL` |
| Delete stops serving the page | `src/db/queries.ts` `deleteContent()` | `test/worker/flow.test.ts:256` | `VERIFIED_LOCAL` |
| Settings read and patch | `src/worker/admin-settings.ts` | `test/worker/flow.test.ts:274` | `VERIFIED_LOCAL` |
| Default-locale change refused | `src/worker/admin-settings.ts:97` | `test/worker/flow.test.ts:294` | `VERIFIED_LOCAL` |

### Cross-stage invariants (`ACCEPTANCE.md §11`)

| ID | Status |
| --- | --- |
| `AC-INV-01` `src/core/` free of Cloudflare and Node APIs | `VERIFIED_LOCAL` |
| `AC-INV-02` deterministic rendering | `VERIFIED_LOCAL` |
| `AC-INV-03` full check chain green | `VERIFIED_LOCAL` |
| `AC-INV-04` bundle within the Free limit | `VERIFIED_LOCAL` (203.6 KiB gzip) |
| `AC-INV-07` errors leak nothing | `VERIFIED_LOCAL` |
| `AC-INV-09` content changes need no deploy | `VERIFIED_LOCAL` |

## 6. Not done, and why

- **PBKDF2 iteration count is provisional.** Needs `TASK-01 §4.4` on a real
  account (gate A).
- **No admin UI.** Task 10–12.
- **No setup wizard.** `POST /_mallok/api/auth/bootstrap` is the minimum that
  makes the loop demonstrable; the seven-step wizard is Task 15.
- **No media, plugin or theme endpoints.** Tasks 03, 04, 07.
- **`media.ref_count` is not maintained on delete**, because nothing
  increments it yet. Task 03 owns the whole media lifecycle.
- **Quota usage unavailable** (see §4.4).

## 7. Known risks

1. A Free-plan login costs one PBKDF2 derivation inside a 10 ms budget. If
   workerd is slower than Node, login itself may exceed the limit. `TASK-01
   §4.4` measures it; if it does, the honest options are a lower cost with
   disclosure, Cloudflare Access in front of `/_mallok/*`, or Workers Paid.
2. `login` derives a hash even for unknown accounts to equalise timing. That
   doubles the cost of a login-flood against the CPU budget. Rate limiting the
   login route belongs with the `RATE_LIMITER` binding in Task 07.
3. Session storage grows until the cron tick prunes it. The tick now deletes
   expired rows, but a burst of logins between ticks is unbounded.
