# The 0.1 release gate

- Status: runbook. Written 2026-09-09, rewritten 2026-09-11, corrected for
  0.1.0-rc.4 on 2026-09-12 (§3, §5.1, §8, §9, §11, §12, §14, §15.1, §17).
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
`docs/ACCEPTANCE.md` uses. Every row in this file is `NOT_RUN`, with one
exception: §15.1, the Deploy to Cloudflare button, is **`NOT_AVAILABLE`** —
withdrawn from what 0.1.0-rc.4 claims rather than waiting for an operator.

A conclusion about platform behaviour can only reach `VERIFIED_STAGING` or
`VERIFIED_HUMAN`, and only from a run recorded with a command, its output and
a date.

**Gate A's evidence does not carry over.** Five criteria were verified against
a real account on 2026-09-03/04, and all five are `STALE` as of 0.1.0-rc.4:
`mallok create` was rewritten, the Worker's theme and plugins became an
argument instead of a compiled-in constant, and the package became a framework
rather than a copy of this repository. Those measurements are history worth
keeping (`docs/tasks/TASK-01.md §5`) and they are not evidence for this
release. Everything below is run from scratch.

**Every shell block in this document starts with `set -euo pipefail`, and it
is not decoration.** Without `pipefail`, `wrangler r2 object get ... | tail -1`
exits with `tail`'s status: Wrangler can fail outright — wrong account, no
permission, network down — and the pipeline still reports success, printing
whatever Wrangler wrote to stderr as though it were an answer. That is how a
step "passes" having proved nothing. Without `-u`, an unset `$PAGE` turns a
URL into a bare `curl`, and without `-e` a failed command is followed by the
next one regardless.

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
| A public GitHub repository | §15 (making the project public) | github.com/fobstack/mallok |

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
2. Create an isolated project from that tarball, served
   by a controlled local registry                         (§6)
3. Run the whole Cloudflare gate on isolated resources    (§7–§14)
4. Publish that same tarball — byte for byte — to npm     (§5, deliberately later)
5. Reinstall from the public registry and smoke it        (§5.1)
6. Push the repository and make it public                 (§15)
7. Roll forward to the next version, when there is one    (§16)
8. Delete every resource the gate created                 (§17)
```

Steps 4 and 6 are the irreversible ones and they come **after** the evidence,
not before it.

**The circularity, and how it is broken.** `mallok create` writes a project
that depends on `mallok` at an exact version *by name*, and then installs it.
Before publishing, that version does not exist on npmjs.com — so either the
gate publishes first and tests a different artefact from the one under review,
or it tests with a `file:` dependency, which is precisely what the generated
project must never contain.

Neither. Step 2 runs against a **local registry serving the same candidate
tarball** under its real name and version (`scripts/local-registry.mjs`, the
same device `test/cli/package-release.test.ts` uses). The project resolves
`mallok@<version>` by name, its manifest is what a published project's would
be, and nothing in its files points at this machine —

— **except its lockfile**, and that exception matters. npm records a
`resolved` URL for every package, and here that URL is a port on the gate
operator's laptop. **A lockfile produced against the local registry is a
temporary gate artefact and is not evidence that the project installs
anywhere.** It is not committed, not shipped, and not quoted in the report.
The portable lockfile is regenerated in §5.1, from the public registry, after
publishing. `test/cli/package-release.test.ts` asserts both halves: that no
file *other* than the lockfile carries a trace of the registry, and that with
the registry stopped, `node_modules` removed and an empty npm cache, `npm ci`
**fails** — which is the honest state of a candidate before it is published.

---

## 4. Build the release tarball

**Status:** `NOT_RUN`. No account needed; this step is local and is the input
to everything after it.

```sh
set -euo pipefail
pnpm lint && pnpm typecheck && pnpm test && pnpm test:release \
  && pnpm build && pnpm bundle:size && pnpm admin:size \
  && pnpm build:site \
  && pnpm test:coverage && pnpm test:e2e && pnpm scan:secrets
pnpm release:pack          # writes dist/pkg/mallok-<version>.tgz
```

`pnpm test:release` is its own step because it takes about fifteen minutes:
it builds two complete packages from two source trees and drives an upgrade
between them with the older one's published binary. `.github/workflows/
release.yml` runs this same list on a tag, in one job, with no step allowed to
be skipped.

**Pass:** every command exits 0 and the tarball exists. **Build once, pack
once.** Nothing after this step may write to `dist/pkg`; a test that repacks
it produces a second tarball, and then "the artefact that was tested" has no
referent.

Record all six values. They must match exactly at §5, or a different artefact
is being published from the one that was tested:

```sh
set -euo pipefail
cd dist/pkg
npm pack --json | tee ../../pack.json | node -e '
  const [p] = JSON.parse(require("fs").readFileSync(0, "utf8"));
  console.log({ filename: p.filename, size: p.size,
                unpackedSize: p.unpackedSize, integrity: p.integrity,
                shasum: p.shasum });
'
shasum -a 256 mallok-*.tgz
```

`npm pack --json` gives npm's own `integrity` (the SRI hash it will publish
under) and `shasum`; the separate `shasum -a 256` is the one a person can
recompute with a tool that is not npm.

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
set -euo pipefail
cd dist/pkg
shasum -a 256 mallok-*.tgz        # must equal the value recorded in §4
npm publish mallok-<version>.tgz --access public --tag next
```

Publishing the **file**, not the directory, is what makes "the same artifact"
checkable rather than a claim: `npm publish .` repacks, and a repack is a new
artefact whose only evidence is that it came from the same directory.

**Pass:** the sha256 above equals §4's, and npm's published `integrity`
matches the one §4 recorded:

```sh
npm view mallok@<version> dist.integrity dist.shasum dist.unpackedSize
```

**Rollback:** `npm unpublish mallok@<version>` within 72 hours, or
`npm deprecate` after that.

### 5.1 The install anybody else gets

**Blocker:** §5. **Status:** `NOT_RUN`.

Everything before this point resolved `mallok` from a local registry. This is
the first and only step that proves the published package installs from
npmjs.com, and it is also where the project's **portable** lockfile comes
from.

```sh
set -euo pipefail
# A new directory and an empty cache: a warm cache can satisfy an install
# from a tarball that was never fetched, and that result would mean nothing.
rm -rf ~/gate-public && mkdir ~/gate-public && cd ~/gate-public
npm cache clear --force 2>/dev/null || true
npm install mallok@<version> --cache "$(mktemp -d)"
./node_modules/.bin/mallok --version
```

Then regenerate the gate project's lockfile against the public registry and
prove it still runs:

```sh
set -euo pipefail
cd ~/gate/gate-site
rm -rf node_modules package-lock.json
npm install --cache "$(mktemp -d)"          # resolves from npmjs.com
grep -c '127.0.0.1' package-lock.json || true   # must print 0
npm run build
npm run smoke
```

**Pass:** `mallok --version` prints the published version; the regenerated
lockfile contains no loopback address; `build` and `smoke` both exit 0. **This
lockfile, not the one from §6, is the one a site keeps.**

## 6. Create an isolated project from the tarball

**Blocker:** a Cloudflare account. **Status:** `NOT_RUN`.
**Rows:** `AC-DEPLOY-01`, `AC-CLI-*` install rows.

From an **empty directory**, outside this repository. The candidate is
installed from the tarball, and *served* from a local registry so that the
project it generates can resolve `mallok@<version>` by name — see §3 for why
that is not a shortcut, and for what the resulting lockfile is and is not
worth.

```sh
set -euo pipefail
mkdir ~/gate && cd ~/gate
npm install /path/to/mallok-<version>.tgz
./node_modules/.bin/mallok --version          # exits 0, prints the version

# One terminal: the candidate, under its real name and version.
node /path/to/mallok/scripts/local-registry.mjs \
  /path/to/mallok-<version>.tgz
# → serving mallok@<version> on http://127.0.0.1:53017

# Everything below is free and reversible: generate, install, build and
# prove the deploy would work, without touching the account at all.
npm_config_registry=http://127.0.0.1:53017 \
  ./node_modules/.bin/mallok create gate-site \
  --slug gate-20260911 --no-deploy
```

Stop the registry once `create` has finished. Nothing after §6 needs it, and
leaving it running is how a later step passes because a port was still open.

The project's `package-lock.json` now records the local registry, and that is
expected. It is a gate artefact: **do not commit it, do not keep it, and do
not present it as evidence that the project installs.** §5.1 replaces it.

**Pass:** `gate-site/` contains `package.json`, `package-lock.json`,
`wrangler.jsonc`, `tsconfig.json`, `biome.json`, `site.json`, `content/`,
`test/`, `scripts/`, `.gitignore` and a `src/` holding exactly `worker/` and
`plugins/`; the run reported install, build and `deploy --dry-run` all
succeeding; and **nothing exists on the account yet**.

It must **not** contain `src/runtime`, `src/core`, `src/admin`, `src/db` or
`src/themes`. Those are the framework, and they arrive as a dependency:

```sh
set -euo pipefail
grep -c 'mallok' gate-site/package.json          # the exact version, once
ls gate-site/src                                 # plugins  worker
wc -l gate-site/src/worker/index.ts              # a couple of dozen lines

# Nothing but the lockfile may point at this machine. The same scan runs in
# `test/cli/package-release.test.ts`; this is the manual form of it.
grep -rIl --exclude=package-lock.json \
  -e '127\.0\.0\.1' -e 'localhost' -e 'file:' -e 'link:' -e 'workspace:' \
  gate-site --exclude-dir=node_modules --exclude-dir=dist || echo 'clean'
```

`scripts/smoke.mjs` is the one expected hit if the exclusions are dropped: it
starts `wrangler dev` on a loopback port, which is the reader's own machine
and not a registry.

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
set -euo pipefail
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

**And the objects are where the code puts them.** R2 keys are
`media/<sha256>.<ext>` for the original and `media/<sha256>_<width>.webp` for
each width variant (`objectKey` and `variantKey` in `src/core/media.ts`) — not
`<sha>.<ext>` at the bucket root, which is what an earlier version of this
document told the operator to look for. A check written against the wrong key
reports "not found" for an object that is present, and would have been read as
a broken upload; in §12 the same mistake would read as a successful reclaim.

```sh
set -euo pipefail
cd gate-site
# Every key the upload wrote, original and variants. `list` is a real
# Wrangler 4.124 subcommand for buckets; there is no `r2 object list`.
./node_modules/.bin/wrangler r2 object get \
  mallok-gate-20260911-media/media/<sha>.<ext> --file /dev/null
# DEFAULT_VARIANT_WIDTHS, minus any at or above the original's width:
# upscaling never helps, so a narrow image has fewer variants than this.
for width in 480 960 1440 1920; do
  ./node_modules/.bin/wrangler r2 object get \
    "mallok-gate-20260911-media/media/<sha>_${width}.webp" --file /dev/null
done
```

Take the widths from the media library's own record for that image rather than
from this list; a theme can ask for a different set.

**Also check what provisioning wrote**, because these are new since 0.1.0-rc.2 and
have never run against a real account:

```sh
set -euo pipefail
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

Two different claims live here, and the previous version of this step could
prove neither because it conflated them:

- **the edge really is holding a copy, and a tag purge really removes it**;
- **saving in the admin triggers that purge by itself.**

The old sequence edited the article *in the admin* and then asserted the edge
was still serving the old copy. If purging works, that assertion fails — the
save purges. If purging does not work, the assertion passes. It could only be
green when the thing it was testing was broken. And the final poll passed
whether the page was purged or simply expired: a TTL running out looks exactly
like a purge.

So: change the content **without** going near the admin, which is what makes
"the old copy is still cached" a real observation; purge by tag as a separate
act; and test the automatic purge on its own afterwards.

### 9.1 The edge is holding a copy, and nothing has purged it

```sh
set -euo pipefail
cd gate-site
PAGE=https://gate.example.com/news/<slug>

# 1. Cache the current version, and prove it is cached rather than assuming
#    it. GET twice: a HEAD does not populate the edge cache.
curl -fsS -o /dev/null -D - "$PAGE" | grep -i x-mallok-cache    # MISS
curl -fsS "$PAGE" | grep -c 'OLD MARKER'                        # 1
curl -fsS -o /dev/null -D - "$PAGE" | grep -i x-mallok-cache    # HIT

# 2. Change what the site *would* render, without any code path that purges.
#    `render_cache.html` is the derived fragment a page is assembled from
#    (src/db/migrations/0001_init.sql); writing it here is a deliberate reach
#    behind the application, and it is the only way to separate "the edge is
#    stale" from "the edge was purged".
./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
  --command "UPDATE render_cache SET html = REPLACE(html, 'OLD MARKER', 'NEW MARKER') WHERE content_id = '<content-id>'"

# 3. The edge must still serve the old copy — repeatedly, over more than a
#    moment, so that this is not a single lucky request.
for _ in 1 2 3; do
  curl -fsS -o /dev/null -D - "$PAGE" | grep -i x-mallok-cache  # HIT
  curl -fsS "$PAGE" | grep -c 'OLD MARKER'                      # 1
  sleep 5
done
```

**Pass:** every request in step 3 is a `HIT` carrying `OLD MARKER`.

**If step 3 shows `NEW MARKER`,** the page was not cached — check
`x-mallok-cache` and `cache-control` — and §9.2 below would measure nothing.
Stop and find out why before continuing.

### 9.2 A tag purge removes it

```sh
set -euo pipefail
# The tag the Worker set for this page. Cloudflare strips `Cache-Tag` before
# the response leaves the edge, so it cannot be read with curl; take it from
# the Worker's own logs (`wrangler tail`) or from the tagging rules in
# docs/ARCHITECTURE.md §9.
curl -fsS -X POST \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"tags":["<the page tag>"]}'

started=$(date +%s)
until curl -fsS "$PAGE" | grep -q 'NEW MARKER'; do
  [ $(($(date +%s) - started)) -lt 120 ] || { echo 'never purged' >&2; exit 1; }
  sleep 2
done
echo "purged after $(($(date +%s) - started))s"
```

**Pass:** `NEW MARKER` appears **within a minute** (wording settled
2026-09-06). Record the actual seconds printed.

**Fail:** if it never appears, `CF_API_TOKEN` lacks Zone → Cache Purge, or
`CF_ZONE_ID` is wrong. Both are secrets — check by re-putting them, never by
printing them.

### 9.3 Saving in the admin purges by itself

A separate claim, and the one a site owner actually depends on: nobody calls
the purge API by hand.

```sh
set -euo pipefail
# 1. Warm the page again and confirm the HIT.
curl -fsS -o /dev/null -D - "$PAGE" >/dev/null
curl -fsS -o /dev/null -D - "$PAGE" | grep -i x-mallok-cache    # HIT

# 2. Edit the article in the admin — a real save, through the UI — replacing
#    NEW MARKER with SAVED MARKER. Purge nothing by hand.

started=$(date +%s)
until curl -fsS "$PAGE" | grep -q 'SAVED MARKER'; do
  [ $(($(date +%s) - started)) -lt 120 ] || { echo 'save did not purge' >&2; exit 1; }
  sleep 2
done
echo "admin save purged after $(($(date +%s) - started))s"
```

**Pass:** the new text appears without any manual purge, within a minute.
Record the seconds. This is the row `AC-CONTENT-02b` actually asserts; §9.1
and §9.2 are what make its result mean something.

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

**What is measured, on what, and how many times.** "CPU is within budget" is
not a result; it is a sentence. The gate records a distribution, on a named
path, from a named source.

| | |
| --- | --- |
| **Path** | `GET /<locale>/news/<slug>` — one published article with an image, rendered from `render_cache`. The single most common visitor request, and the one `AC-INV-05` is written about |
| **Samples** | 30 requests, issued one at a time, at least one second apart. Ten is too few to read a p95 from; a burst measures the edge's concurrency, not the render |
| **Two populations, reported separately** | **Cold** (`x-mallok-cache: MISS`, the Worker assembled the page) and **warm** (`HIT`, the edge answered). Averaging them together produces a number describing neither, and the cold path is the one with a budget |
| **Statistics** | p50, p95 and max of `cpuTime`, in milliseconds, for each population |
| **Source** | `wrangler tail --format=json`, field `cpuTime`, one record per invocation. **Not** `wallTime`, which includes waiting on D1 and is not what the platform bills or kills |
| **Threshold** | Cold p95 ≤ 10 ms and max ≤ 50 ms — Mallok's own budget, from `docs/ARCHITECTURE.md §2`, not a number this account happens to allow. Gate A found this test account tolerating 700 ms–2 s before a kill (`docs/tasks/TASK-01.md §5`, item 4); a site installed on somebody else's account cannot assume that, so the budget stands |

```sh
set -euo pipefail
cd gate-site
./node_modules/.bin/wrangler tail --format=json > tail.json    # one terminal

# Another terminal. A warm run and a cold run, told apart by the header.
for i in $(seq 1 30); do
  curl -fsS -o /dev/null -D - "https://gate.example.com/news/<slug>" \
    | grep -i x-mallok-cache
  sleep 1
done

# Then, over tail.json:
node -e '
  const lines = require("fs").readFileSync("tail.json", "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const cpu = lines.map((l) => l.cpuTime).filter((n) => typeof n === "number")
    .sort((a, b) => a - b);
  const at = (q) => cpu[Math.min(cpu.length - 1, Math.floor(q * cpu.length))];
  console.log({ n: cpu.length, p50: at(0.5), p95: at(0.95), max: cpu.at(-1) });
'
```

**Pass (CPU):** the table above is filled in with real numbers — path, sample
count, cold p50/p95/max, warm p50/p95/max, the threshold each is compared
against, and `wrangler tail --format=json` as the source — and recorded in
`docs/tasks/TASK-01.md §5` next to the Gate A figures it is being compared to.
A report that says "within budget" without those numbers has not run this
step.

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
   before concluding anything.

   A deployed Worker has no endpoint that fires its own cron on demand. The
   local one is **`/cdn-cgi/local/scheduled`**, served by `wrangler dev`
   — `/cdn-cgi/handler/scheduled` is what this document used to give, and it
   is not a path `wrangler dev` answers on, so anyone following it would have
   got a 404 and concluded the scheduled handler was broken. It is reached
   through `wrangler dev --test-scheduled`, and it proves the code, not the
   platform:

   ```sh
   set -euo pipefail
   # Local only. Never against a deployed site — there is no such route there.
   npx wrangler dev --test-scheduled --port 8787 &
   curl -fsS 'http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*'
   ```
5. Confirm both halves are gone — the row and the object:

   ```sh
   set -euo pipefail
   ./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
     --command "SELECT COUNT(*) AS n FROM media WHERE sha256 = '<sha>'"

   # `media/<sha>.<ext>`, the key the code writes (src/core/media.ts), not
   # `<sha>.<ext>` at the bucket root — which this document used to give, and
   # which is "not found" whether the object was reclaimed or not.
   #
   # `pipefail` is what makes this check mean anything: without it the
   # pipeline exits with `tail`'s status, so a Wrangler that failed on
   # authentication reports the same success as a Wrangler that found nothing.
   if ./node_modules/.bin/wrangler r2 object get \
        "mallok-gate-20260911-media/media/<sha>.<ext>" --file /dev/null 2>err.txt
   then
     echo 'still present — the reclaim did not run' >&2; exit 1
   fi
   grep -qi 'not found\|does not exist\|NoSuchKey' err.txt \
     || { echo "Wrangler failed for another reason:"; cat err.txt; exit 1; }

   # And every width variant, which the reclaim removes with the original.
   for width in 480 960 1440 1920; do
     ./node_modules/.bin/wrangler r2 object get \
       "mallok-gate-20260911-media/media/<sha>_${width}.webp" --file /dev/null \
       && { echo "variant ${width} survived" >&2; exit 1; }
   done
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

**Mobile, three runs, and two thresholds that both have to hold.**

`docs/SEO_PERFORMANCE.md §7` asks for a **median** performance score ≥ 0.95
with **no single run** below 0.90. Lighthouse CI compares one threshold
against the median of its runs, so it can express either requirement but not
both — and this document used to resolve that by asserting the floor alone and
calling the difference a correction. The effect was that the gate read
"performance ≥ 0.90" and the median requirement stopped being checked.

There is no either/or. `scripts/lighthouse-gate.mjs` reads all three reports
and asserts both, per URL:

| Category | Every run | Median of three |
| --- | --- | --- |
| Performance | ≥ 0.90 | ≥ 0.95 |
| Accessibility | ≥ 0.95 | ≥ 0.95 |
| Best Practices | ≥ 0.95 | ≥ 0.95 |
| SEO | 1.00 | 1.00 |

SEO is 1.00 in both columns because it is a checklist rather than a
measurement: below 1 means a tag is missing, and that does not vary run to
run.

**The form factor is mobile**, set in `lighthouserc.json` and re-checked by
the script from each report's own `configSettings.formFactor`. Mallok's
visitors arrive on phones, from search and from messaging apps; a desktop run
with desktop throttling is the easier of the two tests, and passing it says
little about the request that actually happens. A report collected as desktop
fails the gate rather than being scored.

**The version is pinned exactly and run from `node_modules`**, not `npx --yes`
— which resolves to whatever the registry publishes on the day, so two runs a
month apart would not be comparing like with like. `@lhci/cli` is a pinned
devDependency at `0.15.1`.

```sh
set -euo pipefail
# Warm the edge first: a cold cache fails this for reasons that say nothing
# about the code.
curl -fsS -o /dev/null https://gate.example.com/
curl -fsS -o /dev/null https://gate.example.com/news/<slug>

rm -rf .tmp/lighthouse
./node_modules/.bin/lhci autorun \
  --config=./lighthouserc.json \
  --collect.url=https://gate.example.com/ \
  --collect.url=https://gate.example.com/news/<slug>

# Both thresholds, from the three reports lhci just wrote.
pnpm lighthouse:gate
```

**Pass:** `lhci` exits 0 **and** `pnpm lighthouse:gate` exits 0. The script
prints every run's score, the minimum and the median for each category —
those printed numbers are the evidence, not "lhci exited 0".

Keep `.tmp/lighthouse` with the run; the three `lhr-*.json` reports are what
the numbers came from.

Accessibility is already covered locally by axe on every admin screen and all
five official themes (`pnpm test:a11y`). Lighthouse adds the performance half,
which needs a real network.

## 15. Public repository

**Blocker:** a repository decision. **Status:** `NOT_RUN`.

This comes **after** the gate above has passed, and after §5.

Before making anything public:

```sh
set -euo pipefail
pnpm scan:secrets        # every blob on every ref, values never printed
```

**Pass:** exit 0. Findings are listed with a path, a line and a rule; a
credential that was ever real must be **rotated first and removed from history
second** — a public repository is assumed to have been cloned the moment it is
public.

Then push and make the repository public.

**This is the one irreversible step in this document.** Making a repository
public cannot be undone for anything already cloned.

### 15.1 The Deploy to Cloudflare button — `NOT_AVAILABLE`

**Row:** `AC-DEPLOY-02`, **withdrawn from 0.1.0-rc.4's claimed capability.**

Not "untested". **Not available**, and the reason is structural rather than a
matter of finding an afternoon to click it.

The button deploys *the repository it points at*. Until rc.3 that was a
coherent thing to do, because a Mallok site **was** a copy of this repository.
It is not any more: this repository is the framework, and pointing the button
here would deploy Mallok's own source — its tests, its admin sources, its
build scripts — as somebody's website. That is exactly the arrangement 0.1
exists to end.

What the button needs is a separate, public **starter site** repository: the
same thin shell `mallok create` writes — a `wrangler.jsonc`, a `site.json`,
some content, four lines of composition — with an exact dependency on
`mallok`. Creating, publishing and testing that repository is **external
follow-up work after 0.1.0-rc.4**, on a clean account, and it is tracked
separately.

**It is not Nundar.** Nundar is the commerce engine in the same organisation;
it is neither a Mallok starter nor a place to put one, and nothing in this
release touches it.

Until that repository exists and has been clicked on a clean account, every
document must say the button is unavailable. `README.md`,
`docs/ARCHITECTURE.md §17`, `docs/PRODUCT_VISION.md §5.4` and
`docs/CLOUDFLARE_RESOURCES.md §7` were corrected for rc.4; the markup was
removed from `README.md` rather than left as a link that would deploy the
wrong thing.

## 16. Rolling upgrade, between two real versions

**Blocker:** two real deployments. **Status:** `NOT_RUN`. **Row:**
`AC-DEPLOY-08`.

Do this before §17 deletes the site, and name both versions. "Deploy the next
build over it" was the previous wording and it describes nothing: there is no
"next build", there are two published versions and the move between them.

```sh
set -euo pipefail
cd gate-site

# 1. Publish content on the version this gate deployed (0.1.0-rc.4), and note
#    a page that must survive.
curl -fsS https://gate.example.com/news/<slug> | grep -c 'MARKER'   # 1

# 2. Move the site to the next release. This is `mallok upgrade`, the same
#    command a user runs — not a merge, and not an edit of the manifest.
./node_modules/.bin/mallok upgrade --to <the next published version>

# 3. Deploy it.
./node_modules/.bin/wrangler deploy

# 4. The content is still there, and the migration ran once.
curl -fsS https://gate.example.com/news/<slug> | grep -c 'MARKER'   # 1
./node_modules/.bin/wrangler d1 execute mallok-gate-20260911-db --remote \
  --command "SELECT id FROM migration ORDER BY id"

# 5. And the project's own record, which is tracked rather than git-ignored:
cat mallok.json
```

**Pass:** step 4 finds the content intact, every migration id appears exactly
once, and `wrangler tail` during step 3 shows no window of failed requests.

Until a second version exists, this step is `NOT_RUN` for a reason nobody can
fix on the day: **it needs two published releases.** The local half is
`VERIFIED_LOCAL` in `test/cli/upgrade-target-owned.test.ts`, and it is a
stronger test than it used to be: two packages are built from **two different
source trees**, the newer one carrying a project migration the older one has
never heard of, and the upgrade is driven by the *older* package's published
binary. That is what proves the target version runs its own migrations rather
than the installed CLI running whatever it was compiled with. The same file
checks that a failed upgrade leaves every file byte-identical, that a retry
still works, and that a downgrade is refused.

**Rollback:** `wrangler rollback` returns the previous Worker version. It does
**not** undo a D1 migration, so an upgrade whose migration is destructive needs
its down-path written before the upgrade, not after it.

## 17. Delete everything the gate created

**Status:** `NOT_RUN`. This is a step, not a courtesy: a gate site holds one of
five free cron triggers and keeps a database and a bucket alive.

An R2 bucket cannot be deleted while it holds objects, so the order is:
objects, then the three resources, then the things only the dashboard can do.

```sh
set -euo pipefail
cd gate-site
../node_modules/.bin/mallok destroy gate-20260911 --confirm gate-20260911
```

**There is no `--empty-bucket`, and there was never a way to implement it.**
The flag was documented as "deletes every object in the bucket", and the
implementation behind it called `wrangler r2 object list` — a subcommand
Wrangler 4.124.0 does not have. It would have failed on its first real use,
having already been described here as the safe way to clean up.
`test/cli/wrangler-contract.test.ts` now checks every Wrangler subcommand the
CLI and its fakes rely on against the locked binary's own `--help`, so an
invented command fails the suite rather than the operator.

What `destroy` does instead is try the **bucket first**, and stop there if
Cloudflare refuses because it is not empty — before the Worker and the
database are gone. An order that deleted the Worker first would leave a site
that is down, with a database and a bucket still billing, and nothing to serve
the pages. It uses the project's own Wrangler, records each deletion in the
ledger so a repeated run is idempotent, and checks the account id in both the
ledger and the registry before it deletes anything.

Emptying the bucket is therefore manual, and the gate should say so plainly:
remove the objects from the R2 dashboard (Buckets → the bucket → Objects →
select all → delete), then run `destroy` again. It resumes at the bucket.

Then, by hand, because no Wrangler command does them:

| Resource | Where |
| --- | --- |
| Worker custom domain (`gate.example.com`) | Workers → the Worker → Settings → Domains & Routes |
| DNS records the wizard wrote | DNS → the zone |
| R2 custom domain (`media.gate.example.com`) | R2 → the bucket → Settings |
| Turnstile widget | Turnstile → the widget |
| `CF_API_TOKEN` created for purging | My Profile → API Tokens |

The Deploy-button row that used to end this table is gone with §15.1: that
path is `NOT_AVAILABLE` in 0.1, so it provisions nothing to clean up.

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
| `AC-CONTENT-02b` | §9 | The 20-second purge round trip was measured against the previous handler — and by a sequence that could not tell a purge from an expiry (§9 explains what replaced it) |
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
| Tarball name, size, unpackedSize, npm integrity, shasum and sha256 | The release issue, from §4, re-checked at §5 |
| Lighthouse min/median per category | `pnpm lighthouse:gate` output, §14 |
| CPU distribution (path, n, cold and warm p50/p95/max) | `docs/tasks/TASK-01.md §5`, §11 |
| The setup key `create` printed | Nowhere. It is used once, by the wizard, and is not written down |

A criterion moves to `VERIFIED_STAGING` only with a command, its output, and a
date. "Looked fine" is not evidence, and a local `workerd` run is not an edge
run.
