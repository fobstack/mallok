# Task 33 — Isolated scheduled hooks and a job API

- Status: **done**.
- Date: 2026-10-06
- Scope: one plugin's `scheduled` hook can no longer stop another's; a plugin
  can queue named jobs that the cron runs later, retries and gives up on
  visibly.
- Source: the owner's task list of 2026-10-01, item M9
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A plugin declares `jobs: { send_receipt }` and, in the same `db.batch` that
marks an order paid, adds `ctx.enqueueStatement('send_receipt', { orderId })`.
Within a minute or so the cron calls the handler. If it throws, it is tried
again 2, 4, 8 and 16 minutes later; after the fifth failure the job appears
under Settings → Advanced → Diagnostics with its last error. Meanwhile
another plugin whose `scheduled` hook throws every minute stops nothing.

## 2. What changed

| File | Change |
| --- | --- |
| `src/worker/plugin-runtime.ts` | `runScheduledHooks` isolates each plugin; `ctx.enqueue`, `ctx.enqueueStatement`; `processPluginJobs` |
| `src/worker/scheduled.ts` | Runs plugin jobs, last in the tick |
| `src/worker/email.ts` | The stale-claim rescue is limited to `email` rows |
| `src/db/queries.ts` | `enqueueJobStatement`, `dueJobsByPrefix`, `stuckJobsByPrefix`, `failedJobs` |
| `src/plugins/define.ts`, `types.ts`, `src/worker/public.d.ts` | `jobs` on a plugin, its checks, and the two context members |
| `src/worker/admin-settings.ts`, `src/admin/pages/settings-advanced.tsx` | Diagnostics lists failed jobs |
| `test/worker/plugin-jobs.test.ts`, `test/e2e/14-failed-jobs.spec.ts`, `test/fixtures/catalog-plugin.ts` | New |
| `docs/` | `PLUGIN_API §5.5, §6, §7.4, §13.2`, `DATA_MODEL §2.9`, `ADMIN` (Advanced), the plan |

## 3. Decisions and deviations

- **Owner decisions, 2026-10-06:** every job follows the email jobs' rule —
  five attempts, 2, 4, 8 and 16 minutes apart — and `ctx.enqueueStatement` is
  offered beside `ctx.enqueue`.
- **No schema change.** The `job` table and its `plugin:<id>:<name>` type
  were already there (`DATA_MODEL §2.9`).
- **A stale claim counts as a failed attempt for plugin jobs.** Not in the
  task text. Before this task a row left `running` for ten minutes went back
  to `pending` unchanged, which is right for email — the send is the core's
  own code. A plugin's job may be the reason the Worker stopped (CPU is not
  an exception; nothing catches it), and released unchanged it would come
  back every ten minutes for ever. So the release costs it an attempt and
  applies the backoff. Email keeps its old behaviour: its rescue now names
  its own type.
- **Plugin jobs run last in the tick**, after session and media clean-up and
  scheduled publishing. For the same reason: whatever a job costs, the
  site's own work has been done. `scheduled` hooks stay where they were,
  before those steps; moving them was not part of this task (§5).
- **At most five plugin jobs per tick, across all plugins**, oldest `runAt`
  first. A number, not a measurement: what fits in a tick depends on what
  the handlers do, and has not been measured on a real account.
- **Jobs of a switched-off plugin wait** rather than fail: switching a
  plugin off is immediate and reversible, and should not destroy work.
- **`enqueue` refuses what could never run**: a name the plugin does not
  declare, a payload over 16 KB or not JSON. The error is thrown where the
  author calls it, not discovered five retries later.
- **Jobs need plugin API 2**; `definePlugin` refuses them under 1.
- **"A plugin cannot write the `job` table freely" is a convention, not a
  barrier.** `ctx.db` is the site's database, as it always was; a plugin is
  trusted source (`PLUGIN_API §2`). What the core guarantees is that a
  plugin does not need to.
- **Failed jobs are shown, not managed.** The plan asks that exhausted jobs
  be marked failed in the admin. There is no retry or dismiss button; a
  failed row stays until someone removes it.

## 4. Verification

- `test/worker/plugin-jobs.test.ts`, on a Worker composed with two plugins:
  a throwing `scheduled` hook logged by plugin id while the next plugin's
  runs; a job queued, run once, marked done; `runAt` respected; five
  attempts with waits of 2, 4, 8 and 16 minutes, each logged, then `failed`,
  not run again and listed by the diagnostics endpoint; success on a later
  attempt; five per tick, oldest first, across plugins; a stale claim
  counted, backed off and run again; a job whose Worker always stops ending
  `failed`; a fresh claim left alone; a switched-off plugin's job waiting;
  the refusals, with nothing written; a job in the plugin's own batch
  committed with it, and absent when the batch fails; what `definePlugin`
  accepts.
- Each guarantee was checked by breaking it: thirteen single-line changes to
  the implementation (removing the `catch`, raising the per-tick bound,
  dropping each refusal, releasing a stale claim uncounted, ignoring its
  age, selecting every plugin's jobs, not marking done, linear backoff,
  ignoring `runAt`, allowing API 1, reversing the order, emptying the
  diagnostics list) each turned at least one test red.
- `test/e2e/14-failed-jobs.spec.ts`: in a browser, a job that gave up is
  listed under Advanced with its type and last error.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 5. Not covered, and known risks

- **Nothing here was run on a real account.** In particular the CPU a tick
  uses with jobs in it, and whether five is the right bound.
- **A `scheduled` hook that exhausts the invocation's CPU still ends the
  tick**, including scheduled publishing, which runs after the hooks. That
  was true before this task; isolation by `try`/`catch` does not change it.
  Running the hooks last as well would, and is a separate decision.
- **Two ticks overlapping** is covered by the claim (`UPDATE … WHERE status =
  'pending'`), the same statement email uses; no test drives two ticks at
  once.
- A failed job cannot be retried or removed from the admin.
