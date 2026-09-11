# The 0.1 release gate

- Status: runbook. Written 2026-09-09, rewritten 2026-09-11.
- Scope: everything between "all local work is done" and "0.1.0 is released".

Every step below needs something this repository cannot provide: a real
Cloudflare account, a domain, a third-party API key, or a published npm
package. That is the only reason they are not done. Each one names the exact
command, what a pass looks like, and how to undo it.

**Nothing here has been run.** Every row is `NOT_RUN` until an operator
records otherwise, and a local `workerd` result never promotes a row —
`docs/ACCEPTANCE.md §14` explains why that distinction is load-bearing.

## 0. Vocabulary

The statuses are the seven in `docs/TESTING.md §6` and no others. This file
used to invent two of its own (`VERIFIED_EDGE`, `BLOCKED_EXTERNAL`), which
meant a row could be "verified" in a vocabulary nothing else in the project
shared:

| Status | Meaning here |
| --- | --- |
| `NOT_AVAILABLE` | There is no testable implementation yet |
| `NOT_RUN` | It could run; nobody has run it. **Every row in this file starts here** |
| `FAILED` | It ran and failed |
| `VERIFIED_LOCAL` | Passes in this repository: Vitest, local `workerd`, a local build |
| `VERIFIED_STAGING` | Measured against a real Cloudflare account, on a real domain |
| `VERIFIED_HUMAN` | Needed a person's judgement — "the email really arrived" |
| `ACCEPTED` | The product owner has confirmed it |

A conclusion about platform behaviour can only be `VERIFIED_STAGING` or
`VERIFIED_HUMAN`.

## 1. The rule that overrides everything else

> **`mallok-titaniumseller` is out of scope.** Its Worker, its D1 database,
> its R2 bucket and its content are a real site with real data. Nothing in
> this runbook may reuse, overwrite, migrate, rename, purge or delete any of
> them, and no step may deploy a Worker whose name, database or bucket
> collides with them.

Every resource this gate touches is **created for the gate and deleted
afterwards**, under its own slug. `mallok create` refuses to adopt a
same-named resource it did not create (`docs/CLOUDFLARE_RESOURCES.md §6`),
which makes a collision an error rather than an overwrite — but the slug is
chosen by the operator, so the operator is the one who has to get it right.

Use a slug with the date in it and nothing else, for example
`mallok-gate-20260911`, and a test hostname on a domain the operator owns —
never the production hostname of any existing site.

## 2. What an operator must have first

None of this is in the repository, and none of it can be:

| Thing | Why | Where it goes |
| --- | --- | --- |
| Cloudflare account, Workers enabled | Everything | — |
| A **test** hostname on a domain on that account | §7, §12, Lighthouse | Cloudflare DNS |
| API token: Zone→Cache Purge, Zone→DNS Edit, Account→R2 Edit | Purge and the R2 custom domain | `wrangler secret put CF_API_TOKEN` |
| Zone id for that domain | Purge | `wrangler secret put CF_ZONE_ID` |
| Resend account + verified sending domain | `AC-PLUGIN-02b` | Admin → Plugins → Inquiry |
| Turnstile site + secret key | `AC-PLUGIN-03b` | Admin → Plugins → Inquiry |
| npm account with `mallok` publish rights | §5 | `npm login` |
| A public GitHub repository | `AC-DEPLOY-02` (Deploy button) | github.com/fobstack/mallok |

**Never commit any of these.** `MALLOK_SECRET`, `CF_API_TOKEN` and
`CF_ZONE_ID` are Worker secrets; third-party keys are entered in the admin and
stored AES-GCM-encrypted in D1 (`docs/CLOUDFLARE_RESOURCES.md §5`).

## 3. Order

The order changed on 2026-09-11, and the change is the point: **the same
tarball that is tested is the one that gets published.** Publishing first and
then testing a project made from the registry copy tests a different artifact
from the one under review, and leaves nothing to withhold if the gate fails.

```
1. Build the release tarball from this repository        (§4)
2. Create an isolated project from that tarball          (§6)
3. Run the whole Cloudflare gate on isolated resources   (§7–§13)
4. Publish that same tarball to npm                      (§5, deliberately later)
5. Push the repository and make it public                (§14)
6. Test the Deploy button from the public repository     (§14)
7. Delete every resource the gate created                (§16)
```

Steps 4 and 5 are the irreversible ones and they come **after** the evidence,
not before it.

---

## 4. Build the release tarball

**Status:** `NOT_RUN`. No account needed; this step is local and is the input
to everything after it.

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build \
  && pnpm bundle:size && pnpm admin:size \
  && pnpm test:coverage && pnpm test:e2e && pnpm scan:secrets
pnpm release:pack          # writes dist/cli/mallok-<version>.tgz
```

**Pass:** every command exits 0 and the tarball exists. Record its name, byte
size and sha256 — the same three values must match at §5, or a different
artifact is being published from the one that was tested:

```sh
shasum -a 256 dist/cli/mallok-*.tgz
```

`npm publish` from the repository root is **refused** by `prepublishOnly`
(`scripts/refuse-publish.mjs`); the publishable package is `dist/cli` and
nothing else.

## 5. Publish the CLI — after §7–§13, not before

**Blocker:** npm publish rights for `mallok`. **Status:** `NOT_RUN`.

The page runtime is **not** published separately — it is an internal module at
`src/runtime`, and there is no `@fobstack/runtime` package to release
(`docs/ARCHITECTURE.md §3`). A clone builds and tests with no sibling checkout
and no registry dependency.

```sh
cd dist/cli
shasum -a 256 mallok-*.tgz        # must equal the value recorded in §4
npm publish mallok-<version>.tgz --access public --tag next
```

Publishing the **file**, not the directory, is what makes "the same artifact"
checkable rather than a claim.

**Pass:** `npm install mallok@next` into an empty directory links
`node_modules/.bin/mallok`, and `mallok --version` prints the published version
and exits 0.

**Rollback:** `npm unpublish mallok@<version>` within 72 hours, or
`npm deprecate` after that.

## 6. Create an isolated project from the tarball

**Blocker:** a Cloudflare account. **Status:** `NOT_RUN`.
**Rows:** `AC-DEPLOY-01`, `AC-CLI-*` install rows.

From an **empty directory**, outside this repository:

```sh
mkdir ~/gate && cd ~/gate
npm install /path/to/mallok-<version>.tgz
./node_modules/.bin/mallok --version          # exits 0, prints the version

# Everything below is free and reversible: generate, install, build and
# prove the deploy would work, without touching the account at all.
./node_modules/.bin/mallok create gate-site \
  --slug mallok-gate-20260911 --no-deploy
```

**Pass:** `gate-site/` contains `package.json`, `pnpm-lock.yaml`,
`wrangler.jsonc`, `src/` (with `src/runtime` and `src/worker`), `content/`,
`test/`, `scripts/` and a `.gitignore`; the run reported install, build and
`deploy --dry-run` all succeeding; and **nothing exists on the account yet**.

Then, from inside the generated project, the real thing:

```sh
cd gate-site
../node_modules/.bin/mallok create . --slug mallok-gate-20260911 \
  --domain gate.example.com
```

The order this runs in is fixed and is a safety property, not an
implementation detail: directory and slug checks, template check, generate,
`pnpm install --frozen-lockfile`, `pnpm run build`, `wrangler deploy
--dry-run`, and only then `whoami`, `d1 create`, `r2 bucket create`, `deploy`,
`secret put` (`docs/CLOUDFLARE_RESOURCES.md §6`). Each created resource is
recorded in `.mallok/create-state.json` before the next step runs.

**Pass:** `.mallok/create-state.json` names the database and bucket that were
created and carries **no secret**; `.mallok/sites.json` has the site; the
Worker answers on its `.workers.dev` address.

**Every wrangler command from here on is the project's own:**

```sh
cd gate-site
./node_modules/.bin/wrangler deployments list
```

Not `npx wrangler` — that resolves to whatever the registry publishes today,
which is not the version this project was built and deployed with. There is no
`-c .mallok/sites/<slug>.jsonc`; that nested config no longer exists, and the
project's own `wrangler.jsonc` is the one `wrangler deploy` reads.

**Rollback:** §16.

## 7. Bind the test hostname

**Blocker:** a domain on the account. **Status:** `NOT_RUN`.
**Row:** `AC-DEPLOY-04`.

`--domain` above already wrote the `custom_domain` route, so the deploy
created the DNS record and the certificate. Confirm:

```sh
curl -sI https://gate.example.com/ | grep -i 'x-mallok-cache\|cache-control'
curl -sI https://gate.example.com/ | grep -i 'x-mallok-cache'
```

**Pass:** first `MISS`, second `HIT`, `cache-control: public, max-age=0,
s-maxage=3600`.

**Note the changed expectation.** Before the runtime migration this header was
`public, max-age=3600`. The browser lifetime is 0 on purpose
(`docs/ACCEPTANCE.md §14.2.2` item 3) — a purge cannot reach a browser, so only
the edge gets a long life.

## 8. Wizard, content, media

**Blocker:** §6's deployment. **Status:** `NOT_RUN`.
**Rows:** `AC-DEPLOY-03`, `AC-CONTENT-01/02b`, `AC-MEDIA-01/04`.

1. Open `https://gate.example.com/_mallok/setup` and complete all four steps.
2. Confirm the wizard 404s afterwards:
   `curl -so /dev/null -w '%{http_code}\n' https://gate.example.com/_mallok/setup`
   → **404**.
3. Publish a real trade article with at least one image, in two languages.
4. Connect the R2 custom domain (`media.gate.example.com`) and re-check an
   image.

The same four steps run locally in a browser on every `pnpm test:e2e`
(`test/e2e/01-wizard.spec.ts`), so what this adds is the platform: real DNS, a
real certificate, a real R2 custom domain.

**Pass:** the article is live at its locale-prefixed URL; `<img>` points at the
media domain; the image loads without invoking the Worker.

## 9. Cache invalidation after a publish

**Blocker:** a real zone. **Status:** `NOT_RUN`. **Row:** `AC-CONTENT-02b`.

```sh
curl -sI https://gate.example.com/news/<slug> | grep -i 'x-mallok-cache\|cache-tag'
# edit the article in the admin, then poll:
for i in $(seq 1 12); do
  curl -s https://gate.example.com/news/<slug> | grep -c '<NEW TEXT>'
  sleep 5
done
```

**Pass:** the new text appears **within one minute** (wording settled
2026-09-06). Record the actual seconds.

**Fail:** if it never appears, `CF_API_TOKEN` lacks Zone→Cache Purge, or
`CF_ZONE_ID` is wrong. Both are secrets — check by re-putting them, never by
printing them.

## 10. Cache safety on the real edge

**Blocker:** a real domain. **Status:** `NOT_RUN`. **Rows:** the `AC-INV`
cache rows, re-confirmed on the edge.

```sh
curl -sI https://gate.example.com/                              | grep -i 'x-mallok-cache\|cache-control\|cache-tag'
curl -sI -H 'Authorization: Bearer x' https://gate.example.com/ | grep -i 'x-mallok-cache\|cache-control'
curl -sI -H 'Cookie: a=1' https://gate.example.com/             | grep -i 'x-mallok-cache\|cache-control'
curl -sI -X HEAD https://gate.example.com/                      | grep -i 'x-mallok-cache'
```

**Pass:** anonymous `MISS`→`HIT`; both credentialed requests `BYPASS` with
`private, no-store` and **no** `cache-tag`; `HEAD` returns the `GET` headers
with an empty body.

This is the row where a local result is least convincing: local `workerd` has
no real edge cache, so `VERIFIED_LOCAL` here says the Worker emits the right
headers, not that Cloudflare honoured them.

## 11. CPU and D1 on the real edge

**Blocker:** a real deployment. **Status:** `NOT_RUN`. **Rows:** `AC-INV-05`,
`ARCHITECTURE §18` items 2 and 5.

**What `wrangler tail` can and cannot tell you.** It streams logs, exceptions,
the outcome and `cpuTime`/`wallTime` per invocation. It does **not** report how
many D1 round trips a request made — an earlier version of this document said
it did, and a number read that way would have been invented. Use it for CPU:

```sh
cd gate-site
./node_modules/.bin/wrangler tail --format=json > tail.json   # one terminal
curl -s https://gate.example.com/news/<slug> >/dev/null       # another
```

**Pass (CPU):** within the plan's budget, recorded in
`docs/tasks/TASK-01.md §5` next to the Gate A figures it is being compared to.

**The D1 round-trip count** (`AC-INV-05`: at most four on a cold render, two
expected) is measured two ways, neither of them tail:

- `VERIFIED_LOCAL` — `test/worker/**` counts the calls directly inside
  workerd. This is the precise measurement, and it is already green.
- `VERIFIED_STAGING` — the D1 dashboard's query count for **this gate's own
  database**, over a window in which exactly one cold request was issued and
  nothing else touched it. That is only meaningful because §1 requires an
  isolated database: on a shared one, the number is somebody else's traffic.

Record both, and say which is which.

## 12. Cron: scheduled publishing and the seven-day media reclaim

**Blocker:** elapsed real time. **Status:** `NOT_RUN`. **Rows:**
`AC-CONTENT-06b`, `AC-MEDIA-06b`.

**Scheduled publishing** is quick: schedule an article two minutes ahead, then

```sh
cd gate-site
./node_modules/.bin/wrangler tail --format=pretty | grep -i scheduled
```

**Pass:** the item publishes with no request arriving.

**The seven-day media reclaim** is the awkward one, because waiting seven days
is not a test anybody runs. Do it on isolated data, with a real cron tick:

1. Upload an image through the admin that **nothing else references**, and
   note its sha256 from the media library.
2. Delete the content that referenced it, so the object is orphaned. Record
   the timestamp.
3. Age the row so it falls outside the window, using this gate's own database
   and this object only — never a blanket update:

   ```sh
   cd gate-site
   ./node_modules/.bin/wrangler d1 execute mallok-mallok-gate-20260911-db --remote \
     --command "UPDATE media SET deleted_at = datetime('now','-8 days') WHERE sha256 = '<sha>'"
   ```

   The `WHERE` clause is not optional. A missing one would sweep every object
   in the bucket on the next tick.
4. Wait for a **real** cron tick and watch it arrive. A Mallok site runs one
   trigger at `* * * * *` (`wrangler.jsonc`), so this is a minute, not a day:

   ```sh
   cd gate-site
   ./node_modules/.bin/wrangler tail --format=pretty | grep -i scheduled
   ```

   A deployed Worker has no endpoint that fires its own cron on demand —
   `/cdn-cgi/handler/scheduled` is a `wrangler dev` facility, and
   `--test-scheduled` proves the code, not the platform. Waiting sixty seconds
   is the whole cost of doing this for real.
5. Confirm the object is gone:

   ```sh
   ./node_modules/.bin/wrangler r2 object get \
     mallok-mallok-gate-20260911-media/<key> 2>&1 | tail -1
   ```

**Pass:** step 5 reports the object does not exist, and the media row is gone
from the admin. Record which of steps 4's two paths was used.

**Free plan ceiling:** five cron triggers per account, one per Mallok site. A
gate site occupies one of them for as long as it exists, which is another
reason for §16.

## 13. Turnstile, Resend, a real inquiry

**Blocker:** Turnstile and Resend accounts. **Status:** `NOT_RUN`.
**Rows:** `AC-PLUGIN-02b`, `AC-PLUGIN-03b`, `AC-PLUGIN-05b`.

Enter both key pairs in Admin → Plugins → Inquiry. Then, from a browser (not
curl — the widget must render):

1. Submit the inquiry form on a product page.
2. Confirm the email arrives at the configured address.
3. Confirm the inquiry appears in the admin and in an export.
4. `wrangler tail` during the submission, for CPU and subrequest counts.

**Pass:** a real email received; the widget rejects a submission with no token;
CPU and subrequests within budget.

**Do not use a real customer address.** Send to an address the operator owns.

## 14. Lighthouse

**Blocker:** the test hostname, with a warm cache. **Status:** `NOT_RUN`.
**Rows:** `AC-SEO-05`, `AC-SEO-06`, `AC-SEO-07`.

```sh
curl -s https://gate.example.com/ >/dev/null        # warm the edge first
npx lhci autorun --collect.url=https://gate.example.com/ \
  --collect.url=https://gate.example.com/news/<slug> \
  --collect.numberOfRuns=3
```

**Pass:** the thresholds in `docs/SEO_PERFORMANCE.md §7`. Keep the JSON report
alongside the run.

A cold cache fails this for reasons that say nothing about the code, which is
why the warm-up is the first line. Accessibility is already covered locally by
axe on every admin screen and all five official themes (`pnpm test:a11y`);
Lighthouse adds the performance half, which needs a real network.

## 15. Public repository and the Deploy button

**Blocker:** a repository decision. **Status:** `NOT_RUN`. **Row:**
`AC-DEPLOY-02`.

This comes **after** the gate above has passed, and after §5. The button needs
a **public** repository; the markup and bindings are in `README.md` and
`docs/CLOUDFLARE_RESOURCES.md §7`.

Before making anything public:

```sh
pnpm scan:secrets        # every blob on every ref, values never printed
```

**Pass:** exit 0. Findings are listed with a path, a line and a rule; a
credential that was ever real must be **rotated first and removed from history
second** — a public repository is assumed to have been cloned the moment it is
public.

Then push, make the repository public, and click the button on a **clean**
account.

**Pass:** the button provisions D1 and R2 from `wrangler.jsonc`, prompts for
the secrets, and lands on a working `.workers.dev` address.

**This is the one irreversible step in this document.** Making a repository
public cannot be undone for anything already cloned.

## 16. Delete everything the gate created

**Status:** `NOT_RUN`. This is a step, not a courtesy: a gate site holds one of
five free cron triggers and keeps a database and a bucket alive.

```sh
cd gate-site
../node_modules/.bin/mallok destroy mallok-gate-20260911 \
  --confirm mallok-gate-20260911
```

That deletes the Worker, the database and the bucket, in that order, using the
project's own Wrangler, and stops on the first failure rather than skipping
ahead. It does **not** do the rest, and says so:

- the R2 bucket must be **empty** first — `wrangler` has no command that
  empties one, so delete the objects before running destroy, or the bucket
  step will fail;
- the R2 custom domain, the Turnstile widget, the `CF_API_TOKEN` and the DNS
  records the wizard wrote are dashboard work.

**Pass:** `wrangler deployments list` finds no Worker, `d1 list` no database,
`r2 bucket list` no bucket, and the gate hostname no longer resolves to a
Worker.

**Check once more that nothing belonging to `mallok-titaniumseller` changed.**

## 17. Rolling upgrade

**Blocker:** two real deployments. **Status:** `NOT_RUN`. **Row:**
`AC-DEPLOY-08`.

Do this on the gate site before §16 deletes it: deploy `0.1.0-rc.2`, publish
content, then deploy the next build over it.

```sh
cd gate-site
./node_modules/.bin/wrangler deploy
```

**Pass:** migrations apply once, content survives, and `wrangler tail` shows no
window of failed requests.

**Rollback:** `wrangler rollback` returns the previous version. A rollback does
**not** undo a D1 migration — write the down-path before an upgrade whose
migration is destructive.

## 18. Re-measure what the runtime migration changed

**Blocker:** §6's deployment. **Status:** `NOT_RUN`.

Two rows in `docs/ACCEPTANCE.md` carry evidence collected against the
**previous** request handler, before the public site moved onto the page
runtime in `src/runtime`:

| Row | What to re-run | Why it may differ |
| --- | --- | --- |
| `AC-CONTENT-02b` | §9 | The runtime writes `Cache-Tag`; the header is byte-identical, so this should be unchanged — but nobody has watched it purge |
| `ARCHITECTURE §18` CPU | §11 | The public request path is new code; stage one is untouched |

Neither has shown a regression. Both are claims whose evidence predates the
code now serving them.

## 19. Where evidence goes

| Artefact | Location |
| --- | --- |
| Per-criterion status | `docs/ACCEPTANCE.md` group tables |
| Raw numbers and surprises | `docs/tasks/TASK-01.md §5` |
| Wording or scope decisions | `docs/ACCEPTANCE.md §14.2` |
| Lighthouse JSON | Attach to the release issue |
| Tarball name, size and sha256 | The release issue, from §4 and §5 |

A criterion moves to `VERIFIED_STAGING` only with a command, its output, and a
date. "Looked fine" is not evidence, and a local `workerd` run is not an edge
run.
