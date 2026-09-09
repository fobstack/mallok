# The 0.1 release gate

- Status: runbook, written 2026-09-09
- Scope: everything between "all local work is done" and "0.1.0 is released"

Every step below needs something this repository cannot provide: a real
Cloudflare account, a domain, a third-party API key, or a published npm
package. That is the only reason they are not done. Each one names the exact
command, what a pass looks like, and how to undo it.

**Nothing here has been run.** Statuses in this file are `BLOCKED_EXTERNAL`
until an operator records otherwise, and a local `workerd` result never
promotes a row — `docs/ACCEPTANCE.md §14` explains why that distinction is
load-bearing.

## 0. Vocabulary

| Status | Meaning |
| --- | --- |
| `VERIFIED_LOCAL` | Passes in this repository: Vitest, local `workerd`, a local build |
| `VERIFIED_EDGE` | Measured against a real Cloudflare account, on a real domain |
| `BLOCKED_EXTERNAL` | Cannot run here; the blocker is named in the row |
| `NOT_RUN` | Could run, has not |

## 1. What an operator must have first

None of this is in the repository, and none of it can be:

| Thing | Why | Where it goes |
| --- | --- | --- |
| Cloudflare account, Workers enabled | Everything | — |
| A domain on that account | `AC-DEPLOY-04`, all three Lighthouse rows | Cloudflare DNS |
| API token: Zone→Cache Purge, Zone→DNS Edit, Account→R2 Edit | Purge and the R2 custom domain | `wrangler secret put CF_API_TOKEN` |
| Zone id for that domain | Purge | `wrangler secret put CF_ZONE_ID` |
| Resend account + verified sending domain | `AC-PLUGIN-02b` | Admin → Plugins → Inquiry |
| Turnstile site + secret key | `AC-PLUGIN-03b` | Admin → Plugins → Inquiry |
| npm account with `@fobstack` publish rights | Runtime release | `npm login` |
| A public GitHub repository | `AC-DEPLOY-02` (Deploy button) | github.com/fobstack/mallok |

**Never commit any of these.** `MALLOK_SECRET`, `CF_API_TOKEN` and
`CF_ZONE_ID` are Worker secrets; third-party keys are entered in the admin and
stored AES-GCM-encrypted in D1 (`docs/CLOUDFLARE_RESOURCES.md §5`).

## 2. Order

Steps 1–3 must happen before anything else, because every later row runs
against the deployment they produce.

```
1. Release @fobstack/runtime to npm
2. Pin Mallok to that exact version
3. Deploy to a real account, bind a domain
4. Wizard → content → media → cache → purge      (§4–§8)
5. Cron and media collection                      (§9)
6. Turnstile, Resend, a real inquiry              (§10)
7. Lighthouse                                     (§11)
8. Public repository and the Deploy button        (§12)
9. Rolling upgrade                                (§13)
10. Re-measure what the Runtime migration changed (§14)
```

---

## 3. Release the Runtime and pin it

**Blocker:** npm publish rights. **Status:** `BLOCKED_EXTERNAL`.

The exact tarball to publish is already built and verified (see
`../runtime/RELEASE.md` for the verification that produced it).

```sh
cd ../runtime
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm pack                       # must reproduce the recorded SHA-256
npm publish fobstack-runtime-0.1.0-alpha.2.tgz --access public --tag next
git tag v0.1.0-alpha.2 && git push --tags
```

Then, in Mallok:

```sh
pnpm pkg set dependencies.@fobstack/runtime=0.1.0-alpha.2
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size && pnpm admin:size
```

**Pass:** the gate is green with the dependency resolved from the registry, and
`node_modules/@fobstack/runtime` contains no `src/`.

**Exact version, never a range.** `^0.1.0-alpha.2` would let a prerelease with
a different cache contract in silently; this package's defaults decide what may
enter a shared cache.

**Rollback:** `git revert` the pin commit. The `file:../runtime` dependency is
a development convenience and must not return to a release branch.

## 4. Deploy and bind a domain

**Blocker:** a Cloudflare account and a domain. **Status:** `BLOCKED_EXTERNAL`.
**Rows:** `AC-DEPLOY-01` (re-confirm), `AC-DEPLOY-04`.

```sh
npx mallok create my-site        # creates D1, R2, secrets, deploys
cd my-site
npx wrangler deployments list
curl -sI https://<name>.<subdomain>.workers.dev/ | head -20
```

Bind the domain in the dashboard (Workers → Settings → Domains & Routes), then:

```sh
curl -sI https://example.com/ | grep -i 'x-mallok-cache\|cache-control'
curl -sI https://example.com/ | grep -i 'x-mallok-cache'
```

**Pass:** first `MISS`, second `HIT`, `cache-control: public, max-age=0,
s-maxage=3600`.

**Note the changed expectation.** Before the Runtime migration this header was
`public, max-age=3600`. The browser lifetime is now 0 on purpose
(`docs/ACCEPTANCE.md §14.2.2` item 3) — a purge cannot reach a browser, so only
the edge gets a long life.

**Rollback:** remove the custom domain; the `.workers.dev` address keeps
working. `npx wrangler delete` removes the Worker; D1 and R2 outlive it and
must be deleted separately (`docs/CLOUDFLARE_RESOURCES.md §6`).

## 5. Wizard, content, media

**Blocker:** the deployment from §4. **Status:** `BLOCKED_EXTERNAL`.
**Rows:** `AC-DEPLOY-03`, `AC-CONTENT-01/02b`, `AC-MEDIA-01/04`.

1. Open `https://example.com/_mallok/setup`, complete all four steps.
2. Confirm the wizard 404s afterwards:
   `curl -so /dev/null -w '%{http_code}\n' https://example.com/_mallok/setup`
   → **404**.
3. Publish a real trade article with at least one image, in two languages.
4. Connect the R2 custom domain (`media.example.com`) and re-check an image.

**Pass:** the article is live at its locale-prefixed URL; `<img>` points at the
media domain; the image loads without touching the Worker.

**Rollback:** delete the content in the admin; media objects are collected by
the cron after seven days (§9).

## 6. Cache invalidation after a publish

**Blocker:** a real zone. **Status:** `BLOCKED_EXTERNAL`. **Row:**
`AC-CONTENT-02b` (re-measure — see §14).

```sh
curl -sI https://example.com/news/<slug> | grep -i 'x-mallok-cache\|cache-tag'
# edit the article in the admin, then poll:
for i in $(seq 1 12); do
  curl -s https://example.com/news/<slug> | grep -c '<NEW TEXT>'
  sleep 5
done
```

**Pass:** the new text appears **within one minute** (the wording settled
2026-09-06). Record the actual seconds.

**Fail:** if it never appears, `CF_API_TOKEN` lacks Zone→Cache Purge, or
`CF_ZONE_ID` is wrong. Both are secrets — check by re-putting them, never by
printing them.

## 7. Cache safety on the real edge

**Blocker:** a real domain. **Status:** `BLOCKED_EXTERNAL`. **Rows:**
`AC-INV` cache rows, re-confirmed on the edge.

```sh
curl -sI https://example.com/                            | grep -i 'x-mallok-cache\|cache-control\|cache-tag'
curl -sI -H 'Authorization: Bearer x' https://example.com/ | grep -i 'x-mallok-cache\|cache-control'
curl -sI -H 'Cookie: a=1' https://example.com/             | grep -i 'x-mallok-cache\|cache-control'
curl -sI -X HEAD https://example.com/                      | grep -i 'x-mallok-cache'
```

**Pass:** anonymous `MISS`→`HIT`; both credentialed requests `BYPASS` with
`private, no-store` and **no** `cache-tag`; `HEAD` returns the `GET` headers
with an empty body.

This is the row where a local result is least convincing: local `workerd` has
no real edge cache, so `VERIFIED_LOCAL` here says the Worker emits the right
headers, not that Cloudflare honoured them.

## 8. D1, subrequests and CPU on the real edge

**Blocker:** a real deployment. **Status:** `BLOCKED_EXTERNAL`. **Rows:**
`AC-INV-05`, `ARCHITECTURE §18` items 2 and 5.

```sh
npx wrangler tail --format=json > tail.json     # in one terminal
curl -s https://example.com/news/<slug> >/dev/null
```

Read `cpuTime` and the D1 call count from the tail output.

**Pass:** ≤ 4 D1 round trips on a cold render (2 expected); CPU within the
plan's budget. Record both numbers in `docs/tasks/TASK-01.md §5`.

**This is a re-measurement, not a first measurement** — the figures there were
taken against the pre-Runtime handler (§14).

## 9. Cron and media collection

**Blocker:** elapsed real time. **Status:** `BLOCKED_EXTERNAL`. **Rows:**
`AC-CONTENT-06b`, `AC-MEDIA-06b`.

```sh
npx wrangler tail --format=pretty | grep -i scheduled
```

Schedule an article for two minutes ahead and wait; for media, upload an
object, delete the content referencing it, and check after seven days.

**Pass:** the scheduled item publishes without a request; the orphaned object
is gone after the window.

**Free plan ceiling:** five cron triggers per account, one per Mallok site.

## 10. Turnstile, Resend, a real inquiry

**Blocker:** Turnstile and Resend accounts. **Status:** `BLOCKED_EXTERNAL`.
**Rows:** `AC-PLUGIN-02b`, `AC-PLUGIN-03b`, `AC-PLUGIN-05b`.

Enter both key pairs in Admin → Plugins → Inquiry. Then, from a browser (not
curl — the widget must render):

1. Submit the inquiry form on a product page.
2. Confirm the email arrives at the configured address.
3. Confirm the inquiry appears in the admin and exports.
4. `npx wrangler tail` during the submission for CPU and subrequest counts.

**Pass:** a real email received; the widget rejects a submission with no token;
CPU and subrequests within budget.

**Do not use a real customer address.** Send to an address the operator owns.

## 11. Lighthouse

**Blocker:** a custom domain with a warm cache. **Status:** `BLOCKED_EXTERNAL`.
**Rows:** `AC-SEO-05`, `AC-SEO-06`, `AC-SEO-07`.

```sh
curl -s https://example.com/ >/dev/null            # warm the edge first
npx lhci autorun --collect.url=https://example.com/ \
  --collect.url=https://example.com/news/<slug> \
  --collect.numberOfRuns=3
```

**Pass:** the thresholds in `docs/SEO_PERFORMANCE.md §7`. Keep the JSON report
alongside the run.

A cold cache fails this for reasons that say nothing about the code, which is
why the warm-up is the first line.

## 12. Public repository and the Deploy button

**Blocker:** a repository decision. **Status:** `BLOCKED_EXTERNAL`. **Row:**
`AC-DEPLOY-02`.

The button needs a **public** repository; the markup and bindings are already
in `README.md` and `docs/CLOUDFLARE_RESOURCES.md §7`.

**Pass:** clicking the button on a clean account provisions D1, R2 and the
secrets, and lands on a working `.workers.dev` address.

**This is the one irreversible step in this document.** Making a repository
public cannot be undone for anything already cloned. Before it: confirm no
secret has ever been committed (`git log -p | grep -iE 'api[_-]?key|secret|token'`),
and that `.dev.vars` is ignored and absent from history.

## 13. Rolling upgrade

**Blocker:** two real deployments. **Status:** `BLOCKED_EXTERNAL`. **Row:**
`AC-DEPLOY-08`.

Deploy 0.1.0-rc.1, publish content, then deploy the next build over it.

**Pass:** migrations apply once, content survives, no downtime window in
`wrangler tail`.

**Rollback:** `npx wrangler rollback` returns the previous version. Note that a
rollback does **not** undo a D1 migration — write the down-path before the
upgrade if the migration is destructive.

## 14. Re-measure what the migration changed

**Blocker:** §4's deployment. **Status:** `BLOCKED_EXTERNAL`.

Two rows in `docs/ACCEPTANCE.md` carry `VERIFIED_HUMAN` evidence collected
against the **previous** request handler, before the public site moved onto
`@fobstack/runtime`:

| Row | What to re-run | Why it may differ |
| --- | --- | --- |
| `AC-CONTENT-02b` | §6 | The runtime writes `Cache-Tag`; the header is byte-identical, so this should be unchanged — but nobody has watched it purge |
| `ARCHITECTURE §18` CPU | §8 | The public request path is new code. Stage one is untouched |

Neither has shown a regression; both are claims whose evidence predates the
code now serving them. Record the results in `docs/tasks/TASK-01.md §5` and
promote or correct the rows in `docs/ACCEPTANCE.md`.

## 15. Where evidence goes

| Artefact | Location |
| --- | --- |
| Per-criterion status | `docs/ACCEPTANCE.md` group tables |
| Raw numbers and surprises | `docs/tasks/TASK-01.md §5` |
| Wording or scope decisions | `docs/ACCEPTANCE.md §14.2` |
| Lighthouse JSON | Attach to the release issue |

A criterion moves to `VERIFIED_EDGE` only with a command, its output, and a
date. "Looked fine" is not evidence, and a local `workerd` run is not an edge
run.
