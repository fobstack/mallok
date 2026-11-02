# Task 47 — Purges that take effect, and failures an operator can see

- Status: **done**, merged to `main`, not released.
- Date: 2026-10-25; review fixes 2026-10-31.
- Scope: the Cache Purge API call, what is recorded when it fails, what the
  admin and a plugin are told, and why the test site's purges failed.
- Source: the owner's item M1 (`docs/IMPLEMENTATION_PLAN.md`, phase seven),
  continuing `TASK-46.md §7`.

## 1. Demonstrable loop

A plugin answers a webhook by calling `ctx.purgeTags(['quote'])`; the page
that carries `p:<plugin>:quote` is served fresh on the deployed site within
seconds, and the call resolves to `{ attempted: true, ok: true, status: 200 }`.
With a token that may not purge, the same call resolves to `ok: false`, the
failure is logged as `purge_failed`, and Settings → Advanced shows when, from
where and what Cloudflare answered, with the permission to check.

## 2. What was built

- **Success is read from the response** (`src/worker/cache.ts`, `purgeCall`):
  an HTTP 2xx whose body parses as JSON with `"success": true`. Anything else
  — a refusal, an unreachable API, a 200 that is not that envelope — is a
  failure.
- **A failure is recorded** on the site row (`last_purge_failure`, migration
  `0008_site_purge_failure`): time, source (`manual`, `content`, `settings`,
  `plugin:<id>`), status, number of tags and Cloudflare's text. It is shown in
  Settings → Advanced and `GET /health` with advice from
  `purgeFailureAdvice`, until a purge of the whole site that **started after
  it** succeeds, or until no token is configured.
- **"Clear cached pages" answers 502** with the reason instead of "Cleared".
- **`ctx.purgeTags` resolves to a `PurgeOutcome`** (`{ attempted, ok,
  status? }`, exported for plugin authors), not `unknown`.
- Purges are still coalesced per isolate over two seconds.

## 3. Why the test site's purges failed

Read on 2026-10-25 on `rc5-gate.mallok.dev`, running a build of this branch
(pipeline 1, before Task 48), with the owner changing the token in the
dashboard and the maintainer sampling pages:

- Every purge — the admin's button, a content save, a plugin switch —
  answered **HTTP 401, code 10000, "Authentication error"**, although the
  dashboard called the token valid and active. The token held **Zone → Cache
  Rules → Edit**. That permission sits next to **Zone → Cache Purge → Purge**
  in the dashboard's list and purges nothing.
- With only that permission changed (same token value, no new secret):
  "Clear cached pages" answered `{"purged":true,"attempted":true}`, and the
  sampled page went from HIT to MISS within two seconds, then HIT again; the
  stored failure was cleared.
- A plugin's tag purge from a webhook: the plugin's call answered
  `{"attempted":true,"ok":true,"status":200}`, the webhook answered after 2.7
  seconds, and the new content was served **3.6 seconds after the call**.
  (A first attempt answered 404 because the plugin was not switched on; the
  page then changed only when its 60-second lifetime ran out. That run says
  nothing about the token.)
- Single runs, not percentiles.
- **Not checked:** which permission the token bound when purges worked on
  rc.5 held. Why rc.5 succeeded and rc.6–rc.11 did not is therefore not
  explained; a different token is the likely reason, not an established one.

So the advice for 401 and 403 names the permission, and `RELEASE_GATE.md
§9.4` and `§9.5` check a plugin switch's purge and a refused purge's display
on a deployed site.

## 4. Review fixes, 2026-10-31

From an independent review of the branch:

- A plugin's purge could be dropped when its request ended before the
  two-second flush: it is now kept alive with `waitUntil` and the plugin is
  told the outcome of the flush that carried it.
- A flush lost with its isolate is detected by the next purge in that isolate
  (older than five windows), logged as `purge_flush_lost` and sent with it.
- A failure recorded while a whole-site purge was in flight is no longer
  cleared by that purge's success (`clearPurgeFailure` takes the purge's
  start time).
- With no token configured, a stored failure is forgotten: it no longer
  applies.
- A 200 whose body is not JSON counts as a failure.

## 5. Verification

`test/worker/cache-admin.test.ts` covers each rule above against a stubbed
API, including the non-JSON 200, the in-flight whole-site purge, the
tokenless case, the plugin's outcome after its request ended and the lost
flush (fake timers). Each was red-green checked by reverting the fix. The
deployed check is §3.

## 6. Open

- Purge rate limits under many saves are not measured.
- The rc.5 token question in §3.
