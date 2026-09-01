# Task 07 — Plugin runtime

- Status: **complete**, all checks green locally
- Date: 2026-08-29
- Scope: manifest validation, plugin migrations, the five hook dispatchers,
  plugin routes with Turnstile and rate limiting, encrypted secrets, settings,
  panels, `sendEmail` with retryable jobs, and the admin API for all of it.
- Contract: `docs/PLUGIN_API.md`, `docs/SECURITY.md §2.2`,
  `docs/DATA_MODEL.md §2.9/§2.11`.

## 1. Demonstrable loop

> A compiled-in plugin creates its table at boot, registers a route, stores
> validated settings and an encrypted secret, and is turned on and off by an
> instant admin switch — while installing or removing it remains a source
> change plus redeploy, and the API says so.

The loop is exercised end-to-end by `test/worker/plugins.test.ts` (with the
`inquiry` plugin as the registered specimen) and `test/core/plugin.test.ts`
(the manifest schema in isolation).

## 2. What exists now

| Piece | Where | Notes |
| --- | --- | --- |
| Manifest schema + settings validator | `src/core/plugin.ts` | zod; `beforeRender` ⇒ `affectsFragmentCache` enforced; panel tables must carry the `p_<id>_` prefix; `pluginApi` above this build's version is rejected. |
| Worker-side plugin interface | `src/plugins/types.ts` | `MallokPlugin`: manifest, migrations, hooks, routes, panel actions. |
| Registry | `src/plugins/index.ts` | A compile-time constant. **This list is what "installing a plugin" means.** |
| Secret encryption | `src/worker/secrets.ts` | HKDF-SHA256(`MALLOK_SECRET`, per plugin+name) → AES-GCM, exactly `SECURITY.md §2.2`; decryption fails closed to `null`. |
| Hook dispatch + routes | `src/worker/plugin-runtime.ts` | Enabled-state resolution, per-plugin contexts with lazily decrypted secrets, `/_mallok/p/<plugin>/<path>`. |
| Email + jobs | `src/worker/email.ts`, `job` queries in `src/db/queries.ts` | Queue first, send immediately, cron retries with exponential backoff. |
| Admin API | `src/worker/admin-plugins.ts` | List / enable / settings / secrets / panels / panel actions. |
| Boot integration | `src/worker/bootstrap.ts` | Plugin migrations run through the core migrator (same `migration` table and lock); `plugin_state` rows are seeded disabled with declared defaults. |

## 3. Decisions worth recording

1. **The fragment cache key only covers plugins that declare
   `affectsFragmentCache`** (`fragmentPluginHash`). Toggling a purely
   stage-two plugin (like `inquiry`) no longer invalidates every stored
   fragment; toggling a `beforeRender` plugin still does, via the key change.
   This replaced the Task 01 hash over *all* enabled plugins.
2. **`onRequest` costs nothing until a compiled-in plugin declares it.**
   `registryDeclaresOnRequest()` is a constant over the registry; when false
   (the current build), the visitor path performs no plugin-state read before
   the cache lookup, preserving the near-zero-cost cache hit
   (`ARCHITECTURE §2`). When true, the documented per-request cost applies
   and the admin list marks the plugin `runsOnEveryRequest: true`.
3. **Email jobs are claimed atomically.** The post-submit immediate attempt
   and the cron can race for the same job; a
   `UPDATE … SET status='running' WHERE status='pending'` claim guarantees an
   email is never sent twice. Jobs stuck in `running` for over 10 minutes
   (a dead isolate) are rescued back to `pending` by the cron.
4. **Secrets are write-only.** The admin API accepts values and returns only
   which names are configured; list responses, panel data and logs never
   carry a plaintext or ciphertext value. Verified by test: the stored
   column holds ciphertext, and decryption with a different plugin id or
   secret name fails closed.
5. **Panel queries are parameterized; identifiers come from the manifest.**
   Table, column and filter names are compile-time constants from
   `plugin.json` (schema-restricted to `[a-z_][a-z0-9_]*`), never from the
   request; only values are bound.
6. **Scopes:** plugin toggle/settings/secrets need `settings:write`; panel
   `update` actions need `content:write`; `download` actions need `export`.
7. **Rate limiting is best-effort and optional.** `Env.RATE_LIMITER` is an
   optional binding; without it the request proceeds (`SECURITY.md §12.5`).
   The workerd test environment does not provide the binding, so the 429 path
   is untested locally (listed in §5).

## 4. Gate B′ status

Gate B′ (inline HTML / `rehype-raw`) blocks only the sanitizer surface and
the wording of `CONTENT_FORMAT §3.4`. Nothing in this task touches the
sanitizer: the runtime, hooks, routes, secrets and panels are all orthogonal
to that decision, so Task 07 proceeded. The `beforeRender` signature stayed
on mdast as fixed by the gate-B decision (`PLUGIN_API.md §5.2`).

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass (12 pre-existing theme-CSS warnings, no errors) |
| `pnpm typecheck` | pass (root + core tsconfig) |
| `pnpm test` | 16 files / 178 tests pass |
| `pnpm build` | pass |
| `pnpm bundle:size` | 829.1 KiB raw / **223.2 KiB gzip** = 7.3 % of the Free limit |

New tests: `test/core/plugin.test.ts` (manifest schema, settings validator),
`test/worker/plugins.test.ts` (admin API, scopes, secret encryption
round-trip and scoping), plus the Task 08 suite which exercises hooks,
routes, jobs and panels through a real plugin.

Not verified locally (needs a real account or is environment-limited):

- the `RATE_LIMITER` 429 path (binding absent in the test environment);
- real Resend delivery and Turnstile verification (mocked per
  `TESTING.md §180`: no live third-party calls in tests);
- purge-by-tag after toggling a plugin (no `CF_API_TOKEN` locally; the
  `purgeTags(['site'])` call is made and resolves as "not configured").

## 6. Testing note for the record

`@cloudflare/vitest-pool-workers` **0.22 removed the `fetchMock` export from
`cloudflare:test`**. The official migration guidance is to mock
`globalThis.fetch` directly or adopt MSW. The tests stub `globalThis.fetch`
(the `SELF` worker runs in the same isolate, so its subrequests hit the
stub); MSW was not added to avoid a new dependency.
