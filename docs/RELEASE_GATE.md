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

The statuses are `docs/TESTING.md §6`'s and no others — the same set
`docs/ACCEPTANCE.md` uses. Every row in this file is `NOT_RUN`.

A conclusion about platform behaviour can only reach `VERIFIED_STAGING` or
`VERIFIED_HUMAN`, and only from a run recorded with a command, its output and
a date.

**Gate A's evidence does not carry over.** Five criteria were verified against
a real account on 2026-09-03/04, and all five are `STALE` as of 0.1.0-rc.3:
`mallok create` was rewritten, the Worker's theme and plugins became an
argument instead of a compiled-in constant, and the package became a framework
rather than a copy of this repository. Those measurements are history worth
keeping (`docs/tasks/TASK-01.md §5`) and they are not evidence for this
release. Everything below is run from scratch.

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
`gate-20260911`, and a test hostname on a domain the operator owns — never the
production hostname of any existing site.

**Leave the `mallok-` prefix off the slug.** The CLI adds it: slug
`gate-20260911` produces Worker `mallok-gate-20260911`, database
`mallok-gate-20260911-db` and bucket `mallok-gate-20260911-media`. Passing
`--slug mallok-gate-20260911` is refused rather than silently corrected, so
this document naming the prefixed form would have wasted the first command of
every gate run.

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
1. Build the release tarball from this repository         (§4)
2. Create an isolated project from that tarball           (§6)
3. Run the whole Cloudflare gate on isolated resources    (§7–§14)
4. Publish that same tarball to npm                       (§5, deliberately later)
5. Push the repository and make it public                 (§15)
6. Test the Deploy button from the public repository      (§15)
7. Roll forward to the next version, when there is one    (§16)
8. Delete every resource the gate created, and the ones
   the Deploy button created                              (§17)
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
pnpm release:pack          # writes dist/pkg/mallok-<version>.tgz
```

**Pass:** every command exits 0 and the tarball exists. Record its name, byte
size and sha256 — the same three values must match at §5, or a different
artifact is being published from the one that was tested:

```sh
shasum -a 256 dist/pkg/mallok-*.tgz
```

`npm publish` from the repository root is **refused** by `prepublishOnly`
(`scripts/refuse-publish.mjs`); the publishable package is `dist/pkg` and
nothing else.

## 5. Publish the package — after §7–§14, not before

**Blocker:** npm publish rights for `mallok`. **Status:** `NOT_RUN`.

What is published is the **whole framework**, not a command line tool: the
`mallok` package carries `cli/`, the `mallok/worker` entry, its type
declarations, the compiled admin assets and the project shell
(`docs/PRODUCT_CONTRACT.md §1`). A generated site depends on it at an exact
version, so the version published here is the version every project created
afterwards will pin.

The page runtime is **not** published separately — it is an internal module at
`src/runtime`, and there is no `@fobstack/runtime` package to release
(`docs/ARCHITECTURE.md §3`). A clone builds and tests with no sibling checkout
and no registry dependency.

```sh
cd dist/pkg
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
  --slug gate-20260911 --no-deploy
```

**Pass:** `gate-site/` contains `package.json`, `package-lock.json`,
`wrangler.jsonc`, `tsconfig.json`, `biome.json`, `site.json`, `content/`,
`test/`, `scripts/`, `.gitignore` and a `src/` holding exactly `worker/` and
`plugins/`; the run reported install, build and `deploy --dry-run` all
succeeding; and **nothing exists on the account yet**.

It must **not** contain `src/runtime`, `src/core`, `src/admin`, `src/db` or
`src/themes`. Those are the framework, and they arrive as a dependency:

```sh
grep -c 'mallok' gate-site/package.json          # the exact version, once
ls gate-site/src                                 # plugins  worker
wc -l gate-site/src/worker/index.ts              # a couple of dozen lines
```

Then, from inside the generated project, the real thing:

```sh
cd gate-site
../node_modules/.bin/mallok create . --slug gate-20260911 \
  --domain gate.example.com
```

The order this runs in is fixed and is a safety property, not an
implementation detail: slug and domain checks, package check, generate, write
the **final** `wrangler.jsonc` (real Worker name, database name, bucket,
rate-limit namespace, custom domain), install, build, `wrangler deploy
--dry-run` against that configuration — and only then `whoami --json`, the
read-only existence checks, `d1 create`, `r2 bucket create`, `deploy`,
`secret put` (`docs/CLOUDFLARE_RESOURCES.md §6`). Each created resource is
recorded in `.mallok/create-state.json` before the call that creates it.

**It prints a setup key, once.** Copy it: the wizard in §8 will not create the
administrator without it, and it is deliberately not written to any file. If
it is lost, `wrangler secret put MALLOK_SETUP_KEY` sets a new one.

**Pass:** `.mallok/create-state.json` names the database and bucket that were
created, records the account id, and carries **no secret value**;
`.mallok/sites.json` has the site; the Worker answers on its `.workers.dev`
address.

**Then run it again.** A finished project must be a no-op:

```sh
./node_modules/.bin/mallok create . --slug gate-20260911 \
  --domain gate.example.com --json
```

**Pass:** exit 0, `"alreadyComplete": true`, and `wrangler deployments list`
shows no new deployment. A second run must not redeploy and must not rotate
`MALLOK_SECRET` — rotating it signs every user out and makes stored plugin
keys unreadable.

**Every wrangler command from here on is the project's own:**

```sh
cd gate-site
./node_modules/.bin/wrangler deployments list
```

Not `npx wrangler` — that resolves to whatever the registry publishes today,
which is not the version this project was built and deployed with. There is no
`-c .mallok/sites/<slug>.jsonc`; that nested config no longer exists, and the
project's own `wrangler.jsonc` is the one `wrangler deploy` reads.

**Rollback:** §17.

## 7. Bind the test hostname

**Blocker:** a domain on the account. **Status:** `NOT_RUN`.
**Row:** `AC-DEPLOY-04`.

`--domain` above already wrote the `custom_domain` route, so the deploy
created the DNS record and the certificate. Confirm:

```sh
# GET, not HEAD. A HEAD does not populate the edge cache, so a HEAD/HEAD pair
# reports MISS twice and a HEAD/GET pair reports MISS twice as well — which
# reads exactly like a broken cache. `-o /dev/null -D -` keeps the headers and
# throws the body away.
curl -s -o /dev/null -D - https://gate.example.com/ | grep -i 'x-mallok-cache\|cache-control'
curl -s -o /dev/null -D - https://gate.example.com/ | grep -i 'x-mallok-cache'
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
   The first asks for the setup key §6 printed; a wrong one is refused, and
   the right one stops working the moment setup succeeds.
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

**Also check what provisioning wrote**, because these are new in 0.1.0-rc.3 and
have never run against a real account:

```sh
cd gate-site
./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
  --command "SELECT domain, media_base_url, setup_key_used_at FROM site"
```

`domain` must be `gate.example.com` — copied from the Worker's own
`MALLOK_DOMAIN` var when setup finished, not typed in. `setup_key_used_at`
must be set. `media_base_url` is `https://media.gate.example.com` **only if**
that host was already answering when setup finished; if the R2 custom domain
was attached afterwards, set it in Settings → Site and say so in the report.

## 9. Cache invalidation after a publish

**Blocker:** a real zone. **Status:** `NOT_RUN`. **Row:** `AC-CONTENT-02b`.

The old version of this step edited an article and polled until the new text
appeared. That passes whether or not purging works: a page whose TTL expires
during the poll looks identical to a page that was purged. The sequence below
distinguishes them.

```sh
PAGE=https://gate.example.com/news/<slug>

# 1. Cache the current version, and prove it is cached.
curl -s -o /dev/null -D - "$PAGE" | grep -i x-mallok-cache     # MISS
curl -s "$PAGE" | grep -c '<OLD MARKER>'                       # 1
curl -s -o /dev/null -D - "$PAGE" | grep -i x-mallok-cache     # HIT

# 2. Edit the article in the admin, replacing OLD MARKER with NEW MARKER.
#    Do not reload the page yet.

# 3. Prove the edge is still serving the old copy. This is the step that
#    makes the rest meaningful: it shows there is something to purge.
curl -s "$PAGE" | grep -c '<OLD MARKER>'                       # still 1

# 4. Purge, from the admin (it happens on save) or by hand, then poll.
for i in $(seq 1 12); do
  curl -s "$PAGE" | grep -c '<NEW MARKER>'
  sleep 5
done
```

**Pass:** step 3 still shows the old marker — proving the page was genuinely
cached — and step 4 shows the new one **within a minute** (wording settled
2026-09-06). Record the actual seconds.

If step 3 already shows the new text, the page was never cached and this step
has measured nothing. Check `x-mallok-cache` and `cache-control` before
drawing any conclusion about purging.

**Fail:** if the new text never appears, `CF_API_TOKEN` lacks Zone → Cache
Purge, or `CF_ZONE_ID` is wrong. Both are secrets — check by re-putting them,
never by printing them.

## 10. Cache safety on the real edge

**Blocker:** a real domain. **Status:** `NOT_RUN`. **Rows:** the `AC-INV`
cache rows, re-confirmed on the edge.

```sh
SITE=https://gate.example.com/

# Anonymous: GET twice, because a HEAD does not populate the edge cache.
curl -s -o /dev/null -D - "$SITE" | grep -i 'x-mallok-cache\|cache-control'
curl -s -o /dev/null -D - "$SITE" | grep -i 'x-mallok-cache'

# Credentialed: each must bypass the cache entirely.
curl -s -o /dev/null -D - -H 'Authorization: Bearer x' "$SITE" | grep -i 'x-mallok-cache\|cache-control'
curl -s -o /dev/null -D - -H 'Cookie: a=1' "$SITE"             | grep -i 'x-mallok-cache\|cache-control'

# HEAD: the GET headers, no body.
curl -sI "$SITE" | grep -i 'x-mallok-cache'
```

**Pass:** anonymous `MISS` then `HIT`; both credentialed requests `BYPASS`
with `private, no-store`; `HEAD` returns the `GET` headers with an empty body.

**Do not check `Cache-Tag` on the client.** Cloudflare strips it before the
response leaves the edge, so `curl` never sees it whether or not the Worker
set it — an earlier version of this document asked for its absence on
credentialed requests and its presence on anonymous ones, and the first would
have passed for the wrong reason while the second could only ever fail. That
the Worker sets the right tags is `VERIFIED_LOCAL`
(`test/worker/cache*.test.ts`); that purging by tag works is §9, which is the
only observation that actually proves the tags arrived.

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
- `VERIFIED_STAGING` — **not the same measurement, and it must not be
  reported as one.** D1's dashboard records *queries*, *rows read* and
  *latency*; a binding round trip may carry several statements (a `batch()` is
  one round trip and many queries), so the dashboard number is an upper bound
  on round trips and an exact count of something else. What it is good for is
  a sanity check on an isolated database over a window in which exactly one
  cold request was issued: queries and rows read should be small and constant,
  and a page that reads hundreds of rows is a regression however many round
  trips it made.

Record both, label each with what it actually counts, and never present the
dashboard figure as the round-trip number.

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
is not a test anybody runs. Do it on isolated data, with a real cron tick.

The field is `media.unreferenced_since`, set when the last reference to an
object goes away, and the collector takes rows whose value is older than seven
days (`src/worker/scheduled.ts`, `MEDIA_GRACE_MS`). An earlier version of this
document told the operator to update `media.deleted_at`, which does not exist:
the command would have failed, or worse, succeeded against a column somebody
later added for something else.

1. Upload an image through the admin that **nothing else references**, and
   note its `sha256` from the media library.
2. Delete the content that referenced it, so the object becomes unreferenced.
   Confirm the site set the field rather than assuming it:

   ```sh
   cd gate-site
   ./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
     --command "SELECT sha256, ref_count, unreferenced_since FROM media WHERE sha256 = '<sha>'"
   ```

   `ref_count` must be 0 and `unreferenced_since` must be set. If it is not,
   the reclaim has nothing to act on and the rest of this step proves nothing.
3. Age that one row past the grace period — this gate's own database, this
   object only, never a blanket update:

   ```sh
   ./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
     --command "UPDATE media SET unreferenced_since = datetime('now','-8 days') WHERE sha256 = '<sha>'"
   ```

   The `WHERE` clause is not optional. Without it every object in the bucket
   is collected on the next tick.
4. Wait for a **real** cron tick and watch it arrive:

   ```sh
   ./node_modules/.bin/wrangler tail --format=pretty | grep -i 'scheduled\|media_collected'
   ```

   A Mallok site's trigger is `* * * * *`, so a tick is a minute away — but
   **a newly deployed or newly changed cron schedule can take up to about 15
   minutes to start firing**, so on a freshly created gate site, wait that long
   before concluding anything. A deployed Worker has no endpoint that fires its
   own cron on demand: `/cdn-cgi/handler/scheduled` is a `wrangler dev`
   facility, and `--test-scheduled` proves the code, not the platform.
5. Confirm both halves are gone — the row and the object:

   ```sh
   ./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
     --command "SELECT COUNT(*) AS n FROM media WHERE sha256 = '<sha>'"
   ./node_modules/.bin/wrangler r2 object get \
     mallok-gate-20260911-media/<sha>.<ext> 2>&1 | tail -1
   ```

**Pass:** the count is 0, the object is reported as not existing, and
`media_collected` appeared in the tail. Record the tick's timestamp.

**Free plan ceiling:** five cron triggers per account, one per Mallok site. A
gate site occupies one of them for as long as it exists, which is another
reason for §17.

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

The version is pinned and the thresholds are in a committed file
(`lighthouserc.json`), not typed on the command line: two runs on two machines
have to measure the same thing, and a threshold that lives in a shell history
is a threshold nobody can review.

```sh
# Warm the edge first: a cold cache fails this for reasons that say nothing
# about the code.
curl -s -o /dev/null https://gate.example.com/
curl -s -o /dev/null https://gate.example.com/news/<slug>

npx --yes @lhci/cli@0.15.1 autorun \
  --config=./lighthouserc.json \
  --collect.url=https://gate.example.com/ \
  --collect.url=https://gate.example.com/news/<slug>
```

**Pass:** `lhci` exits 0. Its assertions are the gate:

| Category | Minimum |
| --- | --- |
| Performance | 0.90 |
| SEO | 1.00 |
| Accessibility | 0.95 |
| Best Practices | 0.95 |

Those are the numbers `docs/SEO_PERFORMANCE.md §7` proposed, with one
correction: §7 asks for a *median* performance score ≥ 95 with no single run
below 90, and Lighthouse CI asserts the median of its three runs against one
threshold. The file asserts the floor it can actually enforce (0.90) rather
than a rule it cannot express.

Keep `.tmp/lighthouse` with the run; the JSON report is the evidence.

Accessibility is already covered locally by axe on every admin screen and all
five official themes (`pnpm test:a11y`). Lighthouse adds the performance half,
which needs a real network.

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

## 16. Rolling upgrade, between two real versions

**Blocker:** two real deployments. **Status:** `NOT_RUN`. **Row:**
`AC-DEPLOY-08`.

Do this before §17 deletes the site, and name both versions. "Deploy the next
build over it" was the previous wording and it describes nothing: there is no
"next build", there are two published versions and the move between them.

```sh
cd gate-site

# 1. Publish content on the version this gate deployed (0.1.0-rc.3), and note
#    a page that must survive.
curl -s https://gate.example.com/news/<slug> | grep -c '<MARKER>'   # 1

# 2. Move the site to the next release. This is `mallok upgrade`, the same
#    command a user runs — not a merge, and not an edit of the manifest.
./node_modules/.bin/mallok upgrade --to 0.1.0-rc.4

# 3. Deploy it.
./node_modules/.bin/wrangler deploy

# 4. The content is still there, and the migration ran once.
curl -s https://gate.example.com/news/<slug> | grep -c '<MARKER>'   # 1
./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
  --command "SELECT id FROM migration ORDER BY id"
```

**Pass:** step 4 finds the content intact, every migration id appears exactly
once, and `wrangler tail` during step 3 shows no window of failed requests.

Until a second version exists, this step is `NOT_RUN` for a reason nobody can
fix on the day: **it needs two published releases.** The local half — that an
upgrade between two real tarballs keeps content, settings, theme and plugins,
runs each migration once and is idempotent — is `VERIFIED_LOCAL` in
`test/cli/upgrade.test.ts`.

**Rollback:** `wrangler rollback` returns the previous Worker version. It does
**not** undo a D1 migration, so an upgrade whose migration is destructive needs
its down-path written before the upgrade, not after it.

## 17. Delete everything the gate created

**Status:** `NOT_RUN`. This is a step, not a courtesy: a gate site holds one of
five free cron triggers and keeps a database and a bucket alive.

An R2 bucket cannot be deleted while it holds objects, so the order is:
objects, then the three resources, then the things only the dashboard can do.

```sh
cd gate-site

# The bucket first. `--empty-bucket` deletes every object in it, which is
# every image the gate site uploaded; it is opt-in for that reason.
../node_modules/.bin/mallok destroy gate-20260911 \
  --confirm gate-20260911 --empty-bucket
```

`destroy` empties the bucket, then deletes the Worker, the database and the
bucket in that order, using the project's own Wrangler, and stops on the first
failure rather than skipping ahead. Without `--empty-bucket` it refuses the
bucket step and says why, rather than reporting a deletion that did not happen.

Then, by hand, because no Wrangler command does them:

| Resource | Where |
| --- | --- |
| Worker custom domain (`gate.example.com`) | Workers → the Worker → Settings → Domains & Routes |
| DNS records the wizard wrote | DNS → the zone |
| R2 custom domain (`media.gate.example.com`) | R2 → the bucket → Settings |
| Turnstile widget | Turnstile → the widget |
| `CF_API_TOKEN` created for purging | My Profile → API Tokens |
| Deploy-button deployment from §15 | Workers → the Worker it created, plus its D1 and R2 |

The last row is easy to forget: §15 provisions a **second** set of resources
under whatever name the button chose, on the account that clicked it.

**Pass, checked rather than assumed:**

```sh
./node_modules/.bin/wrangler deployments list --name mallok-gate-20260911 --json
./node_modules/.bin/wrangler d1 info mallok-gate-20260911-db --json
./node_modules/.bin/wrangler r2 bucket info mallok-gate-20260911-media --json
dig +short gate.example.com
dig +short media.gate.example.com
```

Every one of the first three must fail or report nothing; the two `dig`
lookups must return nothing.

**Check once more that nothing belonging to `mallok-titaniumseller` changed.**

## 18. The five `STALE` rows

**Blocker:** §6's deployment. **Status:** `NOT_RUN`.

Gate A verified five criteria against a real account on 2026-09-03/04. All
five are `STALE` (`docs/TESTING.md §6`): the code they tested has since been
replaced — `mallok create` rewritten, the Worker's theme and plugins made an
argument rather than a compiled-in constant, and the package turned into a
framework instead of a copy of this repository.

| Row | Re-run in | Why the old result does not carry |
| --- | --- | --- |
| `AC-DEPLOY-01` | §6 | A different `create`, a different configuration, a different install |
| `AC-DEPLOY-04` | §7 | Same deployment path, new bundle |
| `AC-DEPLOY-07b` | §8 | A second core migration exists now (`0002_setup_key`) |
| `AC-CONTENT-02b` | §9 | The 20-second purge round trip was measured against the previous handler |
| `AC-MEDIA-04` | §8 | The R2 custom domain is unchanged, but `media_base_url` is now set by the wizard rather than by hand |

They return to `VERIFIED_STAGING` one at a time, each with a command, its
output and a date. None of them may be restored by argument.

## 19. Where evidence goes

| Artefact | Location |
| --- | --- |
| Per-criterion status | `docs/ACCEPTANCE.md` group tables |
| Raw numbers and surprises | `docs/tasks/TASK-01.md §5` |
| Wording or scope decisions | `docs/ACCEPTANCE.md §14.2` |
| Lighthouse JSON | `.tmp/lighthouse`, attached to the release issue |
| Tarball name, size and sha256 | The release issue, from §4 and §5 |
| The setup key `create` printed | Nowhere. It is used once, by the wizard, and is not written down |

A criterion moves to `VERIFIED_STAGING` only with a command, its output, and a
date. "Looked fine" is not evidence, and a local `workerd` run is not an edge
run.
