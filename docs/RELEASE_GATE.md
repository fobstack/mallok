# The 0.1 release gate

- Status: runbook. Written 2026-09-09, rewritten 2026-09-11, corrected for
  0.1.0-rc.4 on 2026-09-12 (§3, §5.1, §8, §9, §11, §12, §14, §15.1, §17),
  and updated for the 0.1.0-rc.5 candidate on 2026-09-17 with fail-closed
  checks (§4–§6, §8–§12, §16, §17).
- Scope: everything between "all local work is done" and "0.1.0 is released".

Every step below **except §4** needs something this repository cannot provide:
a real Cloudflare account, a domain, a third-party API key, or a published npm
package. §4 is the local prerequisite; the external dependency is the reason
the later sections remain open. Each one names the exact command, what a pass
looks like, and how to undo it.

**Only the local prerequisite is evidence for this release.** §4 is
`VERIFIED_LOCAL` for the 0.1.0-rc.5 candidate on 2026-09-17. Every external
section remains `NOT_RUN` until an operator records otherwise, and a local
`workerd` result never promotes one of those rows — `docs/ACCEPTANCE.md §14`
explains why that distinction is load-bearing. §15.1 is the one row that is
neither: `NOT_AVAILABLE`, withdrawn rather than pending. The 2026-09-12 rc.4
local run is retained separately as `STALE` history in §4.1.

## Active gate run — 2026-09-17

The status snapshot above and the original §4 evidence describe the first rc.5
artifact, not every subsequent build with that unpublished version. The real
isolated deployment exposed two regressions: D1 name probes resolved a local
placeholder UUID, and cached HTML returned a four-hour browser lifetime instead
of the declared zero. The D1 fix was deployed successfully; the cache-policy
fix must be verified against a new source-bound tarball before release.

The gate site is `rc5-gate.mallok.dev`, Worker `mallok-gate-20260917-rc5`, with
its own D1 and R2 resources. No production resource is part of this run.
Creation, the browser setup wizard, publishing, and credential cache bypass
were exercised on the intermediate artifact. These are diagnostic results,
not a blanket approval of the replacement artifact. The full external gate
remains incomplete. Cloudflare also injects an analytics beacon in browser
responses; the zero-client-JavaScript check has not passed on this hostname.

## 0. Vocabulary

The statuses are `docs/TESTING.md §6`'s and no others — the same set
`docs/ACCEPTANCE.md` uses. Every current gate section is `NOT_RUN` but two:

- **§4** is `VERIFIED_LOCAL` — it needs no account, and the rc.5 local gate,
  source-bound candidate checks and clean-checkout reproducibility check pass;
- **§15.1**, the Deploy to Cloudflare button, is `NOT_AVAILABLE` — withdrawn
  from what this release claims rather than waiting for an operator.

A conclusion about platform behaviour can only reach `VERIFIED_STAGING` or
`VERIFIED_HUMAN`, and only from a run recorded with a command, its output and
a date.

**Gate A's evidence does not carry over.** Five criteria were verified against
a real account on 2026-09-03/04; all five have been `STALE` since rc.4 and
remain stale for rc.5:
`mallok create` was rewritten, the Worker's theme and plugins became an
argument instead of a compiled-in constant, and the package became a framework
rather than a copy of this repository. Those measurements are history worth
keeping (`docs/tasks/TASK-01.md §5`) and they are not evidence for this
release. Everything below is run from scratch.

**Every executable block in this document requires Bash and starts with
`set -euo pipefail`; copy the whole block.** It is not decoration. A later
block can still depend on the directory or variables established earlier in
the same numbered section, as the surrounding prose says.
Without `pipefail`, a failing command on the left of a pipeline can be hidden
by a successful command on the right. Without `-u`, an unset `$PAGE` turns a
URL into a bare `curl`, and without `-e` a failed command is followed by the
next one regardless. Commands that are intentionally expected to fail capture
their status inside `if`; they never disable these checks for the whole block.

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
The operator also has to supply `CF_API_TOKEN` and `CF_ZONE_ID` to the local
shell running §9 and §11, from a secret manager or hidden prompt. Putting them
on the Worker does not make them readable again, and the runbook never prints
them or places their values on a command line.

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

**Status:** `VERIFIED_LOCAL` on 2026-09-17 for 0.1.0-rc.5. The complete local
suite below, exact-candidate tests, source-commit verification and independent
clean-checkout reproduction all exit 0. The seven candidate values live in
the release issue outside this checkout, because committing them here after
packing would change `HEAD` and invalidate `sourceCommit`. The 2026-09-12 rc.4
run is retained as `STALE` history in §4.1; none of its old numbers is evidence
for rc.5.

No account is needed, so this is the one step in this document that can be
closed locally. It must be re-run if `HEAD` changes before publication.

```bash
set -euo pipefail
pnpm lint && pnpm typecheck && pnpm test && pnpm test:release \
  && pnpm build && pnpm bundle:size && pnpm admin:size \
  && pnpm build:site \
  && pnpm test:coverage && pnpm test:e2e && pnpm scan:secrets
pnpm release:pack          # writes the versioned tgz and pack.json under dist/release
```

`pnpm test:release` is its own step because it is minutes rather than
seconds: it builds two real tarballs, serves them from a local registry, and
upgrades a real project from one to the other. `.github/workflows/
release.yml` runs this same list on a tag, in one job, with no step allowed to
be skipped.

**Pass:** every command exits 0 and the tarball exists. **Build once, pack
once.** `dist/pkg` is staging input and tests are allowed to rebuild it;
`dist/release` is the selected-candidate boundary. The pack script refuses to
reuse that directory, so normal tooling cannot silently replace its tarball.
That is not filesystem immutability: a person can still replace both files.
The independent release record below is therefore the trust anchor at §5.

Record all seven values. They must match exactly at §5, or a different artefact
is being published from the one that was tested:

```bash
set -euo pipefail
version=$(node -p "require('./package.json').version")
candidate="$PWD/dist/release/mallok-$version.tgz"
test -f "$candidate"
test -f dist/release/pack.json

# Prove the package-boundary tests consume the selected tarball. Removing the
# staging directory from its expected path makes an accidental fallback fail.
mv dist/pkg dist/package-staging-not-used
MALLOK_CANDIDATE_TARBALL="$candidate" pnpm test:candidate
node scripts/verify-candidate.mjs "$candidate"
node -e 'console.log(JSON.parse(require("fs").readFileSync("dist/release/pack.json","utf8")))'
shasum -a 256 "$candidate"
```

`pack.json` records npm's own `integrity` (the SRI hash it will publish under),
`shasum`, sizes, the independently computed SHA-256 and the clean Git commit
that owns `dist/pkg`. `verify-candidate` recomputes every hash from the file
after the boundary tests and refuses a checkout whose `HEAD` differs from
`sourceCommit`; the separate `shasum -a 256` is also readable without trusting
the script.

Copy the seven displayed values into the release issue **outside this
checkout**: filename, size, unpackedSize, integrity, shasum, sha256 and
sourceCommit. Before §5, export the six non-derived values from that
independent record as
`MALLOK_EXPECTED_SIZE`, `MALLOK_EXPECTED_UNPACKED_SIZE`,
`MALLOK_EXPECTED_INTEGRITY`, `MALLOK_EXPECTED_SHASUM` and
`MALLOK_EXPECTED_SHA256`, plus `MALLOK_EXPECTED_SOURCE_COMMIT`. Do not populate
them by rereading `pack.json`; doing so would let a replaced tarball and a
replaced manifest validate each other.

**Do not commit after selecting the candidate.** `sourceCommit` deliberately
binds the tarball to the exact `HEAD` from which it was built. A documentation
commit, tag-preparation commit or other change after `release:pack` invalidates
that candidate: remove the ignored `dist/release` directory, build and pack
again from the new clean `HEAD`, then repeat every candidate check. A Git tag
does not change `HEAD` and is safe after the checks.

The final local gate also proves whole-package reproducibility from a second
clean checkout of that same commit. The second checkout installs from its
lockfile, builds and packs independently; `cmp` must report byte equality and
both `pack.json` records must be identical:

```bash
set -euo pipefail
repro_root=$(mktemp -d)
git clone --local . "$repro_root/mallok"
git -C "$repro_root/mallok" checkout --detach "$(git rev-parse HEAD)"
(
  cd "$repro_root/mallok"
  pnpm install --frozen-lockfile
  pnpm release:pack
)
version=$(node -p "require('./package.json').version")
cmp "dist/release/mallok-$version.tgz" \
  "$repro_root/mallok/dist/release/mallok-$version.tgz"
cmp dist/release/pack.json "$repro_root/mallok/dist/release/pack.json"
```

`npm publish` from the repository root is **refused** by `prepublishOnly`
(`scripts/refuse-publish.mjs`). `dist/pkg` is never published directly; the
only publish input is the already tested file under `dist/release`.

### 4.1 What the 2026-09-12 run produced — `STALE`

**Kept as a record of a run that happened, not as evidence for this release.**
It is pinned to commit `302ae77`, and the commits after it changed the
Wrangler contract, the absence classification, the ownership checks, the
setup-key default and delivery path, the upgrade command and the browser
suite's configuration. None of the numbers below describes the current tree,
and none of them may be quoted as though it did — not the tarball's SHA, not
the commit, not the stderr size.

Run 2026-09-12 in a **clean clone** of `302ae77`, installed from zero, every
step consecutively. Recorded here because §5 compares against it, and a
number kept in a terminal is a number nobody can check. Test *counts* are
left out on purpose — they drift, and the command prints them (`CLAUDE.md`);
what is worth writing down is that each step exited 0 and what it wrote to
stderr.

| Step | Exit | stderr |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | 0 B |
| `pnpm lint` | 0 | 12 607 B — Biome's own report of 6 warnings, which is its output and not a failure |
| `pnpm typecheck` | 0 | 0 B |
| `pnpm test` | 0 | 616 B |
| `pnpm test:coverage` | 0 | 616 B — 87.53% statements, 78.74% branches, 87.48% lines, all above their floors |
| `pnpm test:release` | 0 | 198 B — the two-real-version upgrade |
| `pnpm build` | 0 | 360 B |
| `pnpm bundle:size` | 0 | 360 B — 1062.0 KiB raw (1.6% of Cloudflare's 64 MiB), 290.0 KiB gzip (9.4% of Mallok's own 3 MiB budget) |
| `pnpm admin:size` | 0 | 0 B — 71.2 KiB gzip first load, budget 150 KiB |
| `pnpm build:site` | 0 | 1584 B — the static build's own warnings about `[[inquiry]]` forms it cannot serve |
| `pnpm test:e2e` | 0 | 402 B — Playwright with axe, against a real `wrangler dev` |
| `pnpm scan:secrets` | 0 | 0 B |

**The stderr column is the point, not decoration.** A passing run writes 616
bytes: two `!` lines from `destroy`'s refusal tests, which those tests are
about, and Wrangler's own `DEP0040 punycode` deprecation warning, which comes
from the bundled CLI that `@cloudflare/vitest-pool-workers` loads and is not
Mallok's to silence (`docs/TESTING.md §3`). Anything beyond those is a defect.

The artefact, built once and packed once:

```
filename      mallok-0.1.0-rc.4.tgz
size          1259682
unpackedSize  5751960
entryCount    46
integrity     sha512-IlGTbd+uNc9KYPcfV0c4iQuBCt3FQZQsFEcR4oD75Dzcu/U0L7F220oyUWQW5mDeKUSX5EKf5LR8rF3kbcy7IQ==
shasum        05bde77f759478a3b8c3a268b356ddf23e8e59c5
sha256        6394300411cee2cc7bbd77681003d06b631bc5c588aab7423fc0fb665b494115
```

**The build was reproducible at that commit, and that was checked rather than
assumed** — a property of the build, not of any particular artefact, so it is
worth recording even though the tarball above is stale.
Rebuilding from a second clean clone at `c8536e8` — two commits later, both
touching only documentation and one code comment — produced a **byte-identical
tarball**: the same size, the same `entryCount`, the same npm `integrity`, the
same SHA-256. That historical result demonstrates deterministic bytes; it does
**not** make the old candidate eligible at a later commit. rc.5 records
`sourceCommit`, and §5 accepts only a candidate whose recorded commit equals
the publishing checkout's current `HEAD`.

Then that exact file, installed into a directory that had nothing else:
the strict consumer compiled with `skipLibCheck: false`;
`THIRD_PARTY_NOTICES` listed 89 bundled packages; `mallok create` exited 0 and
the generated project passed its own lint, typecheck, test, build and smoke;
`mallok upgrade --to 0.1.0-rc.4` reported `changed: false`; a downgrade was
refused. The tarball's SHA-256 was unchanged afterwards.

**This closed §4 for that commit and nothing else**, and it no longer closes
even that: see the heading. Every step from §6 onwards still needs a real
Cloudflare account, and §5 needs npm publish rights. A green local gate is
the precondition for this document, not a substitute for it.

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

```bash
set -euo pipefail
version=$(node -p "require('./package.json').version")
candidate="$PWD/dist/release/mallok-$version.tgz"
: "${MALLOK_EXPECTED_SIZE:?copy it from the §4 release record}"
: "${MALLOK_EXPECTED_UNPACKED_SIZE:?copy it from the §4 release record}"
: "${MALLOK_EXPECTED_INTEGRITY:?copy it from the §4 release record}"
: "${MALLOK_EXPECTED_SHASUM:?copy it from the §4 release record}"
: "${MALLOK_EXPECTED_SHA256:?copy it from the §4 release record}"
: "${MALLOK_EXPECTED_SOURCE_COMMIT:?copy it from the §4 release record}"
node scripts/verify-candidate.mjs "$candidate"
node - "$version" \
  "$MALLOK_EXPECTED_SIZE" "$MALLOK_EXPECTED_UNPACKED_SIZE" \
  "$MALLOK_EXPECTED_INTEGRITY" "$MALLOK_EXPECTED_SHASUM" \
  "$MALLOK_EXPECTED_SHA256" "$MALLOK_EXPECTED_SOURCE_COMMIT" <<'NODE'
const { readFileSync } = require('node:fs');
const [version, size, unpackedSize, integrity, shasum, sha256, sourceCommit] =
  process.argv.slice(2);
const actual = JSON.parse(readFileSync('dist/release/pack.json', 'utf8'));
const expected = {
  filename: `mallok-${version}.tgz`,
  size: Number(size),
  unpackedSize: Number(unpackedSize),
  integrity,
  shasum,
  sha256,
  sourceCommit,
};
for (const [key, value] of Object.entries(expected)) {
  if (actual[key] !== value) {
    throw new Error(`${key}: candidate has ${actual[key]}, release record has ${value}`);
  }
}
NODE
npm publish "$candidate" --access public --tag next
```

Publishing the **file**, not the directory, is what makes "the same artifact"
checkable rather than a claim: `npm publish .` repacks, and a repack is a new
artefact whose only evidence is that it came from the same directory.

**Pass:** the sha256 above equals §4's, and npm's published `integrity`
matches the one §4 recorded:

```bash
set -euo pipefail
version=$(node -p "require('./package.json').version")
: "${MALLOK_EXPECTED_INTEGRITY:?copy it from the §4 release record}"
: "${MALLOK_EXPECTED_SHASUM:?copy it from the §4 release record}"
: "${MALLOK_EXPECTED_UNPACKED_SIZE:?copy it from the §4 release record}"
registry_dist=$(mktemp)
npm view "mallok@$version" dist --json > "$registry_dist"
node - \
  "$MALLOK_EXPECTED_INTEGRITY" "$MALLOK_EXPECTED_SHASUM" \
  "$MALLOK_EXPECTED_UNPACKED_SIZE" "$registry_dist" <<'NODE'
const { readFileSync } = require('node:fs');
const [integrity, shasum, unpackedSize, file] = process.argv.slice(2);
const actual = JSON.parse(readFileSync(file, 'utf8'));
if (actual.integrity !== integrity || actual.shasum !== shasum ||
    Number(actual.unpackedSize) !== Number(unpackedSize)) {
  throw new Error(`registry metadata differs: ${JSON.stringify(actual)}`);
}
NODE
rm -f "$registry_dist"
```

**Rollback:** `npm unpublish mallok@<version>` within 72 hours, or
`npm deprecate` after that.

### 5.1 The install anybody else gets

**Blocker:** §5. **Status:** `NOT_RUN`.

Everything before this point resolved `mallok` from a local registry. This is
the first and only step that proves the published package installs from
npmjs.com, and it is also where the project's **portable** lockfile comes
from.

```bash
set -euo pipefail
# A new directory and an empty cache: a warm cache can satisfy an install
# from a tarball that was never fetched, and that result would mean nothing.
PUBLIC_INSTALL_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mallok-gate-public.XXXXXX")
cd "$PUBLIC_INSTALL_DIR"
: "${MALLOK_GATE_VERSION:?export the version published in §5}"
npm install "mallok@$MALLOK_GATE_VERSION" --cache "$(mktemp -d)"
installed_version=$(./node_modules/.bin/mallok --version)
[ "$installed_version" = "$MALLOK_GATE_VERSION" ] \
  || { echo "installed $installed_version, expected $MALLOK_GATE_VERSION" >&2; exit 1; }
```

Then regenerate the gate project's lockfile against the public registry and
prove it still runs:

```bash
set -euo pipefail
cd ~/gate/gate-site
rm -rf node_modules package-lock.json
npm install --cache "$(mktemp -d)"          # resolves from npmjs.com
if grep -n '127\.0\.0\.1\|localhost' package-lock.json; then
  echo 'the public-registry lockfile still names a loopback registry' >&2
  exit 1
fi
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

```bash
set -euo pipefail
: "${MALLOK_CANDIDATE_TARBALL:?export the absolute candidate path from §4}"
mkdir ~/gate && cd ~/gate
npm install "$MALLOK_CANDIDATE_TARBALL"
./node_modules/.bin/mallok --version          # exits 0, prints the version
```

In one terminal, serve the candidate under its real name and version. This
process stays in the foreground:

```bash
set -euo pipefail
: "${MALLOK_SOURCE_DIR:?export the absolute Mallok source checkout path}"
: "${MALLOK_CANDIDATE_TARBALL:?export the absolute candidate path from §4}"
node "$MALLOK_SOURCE_DIR/scripts/local-registry.mjs" \
  "$MALLOK_CANDIDATE_TARBALL"
# → serving the candidate on http://127.0.0.1:53017
```

In a second terminal, choose the gate identity once, then generate, install,
build and prove the deploy would work without touching the account. Keep this
terminal open. The machine record written here is the only input the real
create and its idempotency rerun use; neither asks the operator to retype a
slug or hostname:

```bash
set -euo pipefail
cd ~/gate
: "${GATE_SLUG:?export a new 3-32 character lowercase gate slug}"
: "${SITE_DOMAIN:?export the test hostname owned by this account}"
printf '%s' "$GATE_SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' \
  || { echo 'GATE_SLUG is not a valid Mallok slug' >&2; exit 1; }
case "$GATE_SLUG" in
  mallok-*) echo 'leave the mallok- prefix off GATE_SLUG' >&2; exit 1 ;;
esac
[ "${#SITE_DOMAIN}" -le 253 ] &&
  printf '%s' "$SITE_DOMAIN" | grep -Eq \
    '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' \
  || { echo 'SITE_DOMAIN is not a lowercase DNS hostname' >&2; exit 1; }
npm_config_registry=http://127.0.0.1:53017 \
  ./node_modules/.bin/mallok create gate-site \
  --slug "$GATE_SLUG" --no-deploy
mkdir -p gate-site/.tmp
node - "$GATE_SLUG" "$SITE_DOMAIN" <<'NODE'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const [slug, domain] = process.argv.slice(2);
const target = { slug, domain };
const file = 'gate-site/.tmp/gate-target.json';
if (existsSync(file)) {
  const recorded = JSON.parse(readFileSync(file, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(target)) {
    throw new Error('the recorded gate identity differs from this run');
  }
} else {
  writeFileSync(file, `${JSON.stringify(target)}\n`, { flag: 'wx' });
}
NODE
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

```bash
set -euo pipefail
node -e '
  const p=require("./gate-site/package.json");
  const versions=[p.dependencies?.mallok,p.devDependencies?.mallok]
    .filter(Boolean);
  if(versions.length!==1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(versions[0]))
    throw new Error(`expected one exact mallok dependency, got ${JSON.stringify(versions)}`)
'
src_entries=$(find gate-site/src -mindepth 1 -maxdepth 1 -type d \
  -exec basename {} \; | sort | paste -sd ' ' -)
[ "$src_entries" = 'plugins worker' ] \
  || { echo "unexpected src directories: $src_entries" >&2; exit 1; }
test -s gate-site/src/worker/index.ts

# Nothing but the lockfile may point at this machine. The same scan runs in
# `test/cli/package-release.test.ts`; this is the manual form of it.
if matches=$(grep -rIl --exclude=package-lock.json \
    -e '127\.0\.0\.1' -e 'localhost' -e 'file:' -e 'link:' -e 'workspace:' \
    gate-site --exclude-dir=node_modules --exclude-dir=dist)
then
  printf 'machine-local reference found:\n%s\n' "$matches" >&2
  exit 1
else
  status=$?
  [ "$status" -eq 1 ] || exit "$status"
fi
```

`scripts/smoke.mjs` is the one expected hit if the exclusions are dropped: it
starts `wrangler dev` on a loopback port, which is the reader's own machine
and not a registry.

Then, from inside the generated project, the real thing:

```bash
set -euo pipefail
cd gate-site
test -f .tmp/gate-target.json
GATE_SLUG=$(node -p "require('./.tmp/gate-target.json').slug")
SITE_DOMAIN=$(node -p "require('./.tmp/gate-target.json').domain")
../node_modules/.bin/mallok create . --slug "$GATE_SLUG" \
  --domain "$SITE_DOMAIN"
ledger_slug=$(node -p "require('./.mallok/create-state.json').slug")
ledger_domain=$(node -p "require('./.mallok/create-state.json').domain")
[ "$ledger_slug" = "$GATE_SLUG" ] && [ "$ledger_domain" = "$SITE_DOMAIN" ] \
  || { echo 'create ledger identity differs from the recorded gate target' >&2; exit 1; }
```

The order this runs in is fixed and is a safety property, not an
implementation detail: slug and domain checks, package check, generate, write
the **final** `wrangler.jsonc` (real Worker name, database name, bucket,
rate-limit namespace, custom domain), install, build, `wrangler deploy
--dry-run` against that configuration — and only then `whoami --json`, the
read-only existence checks, `d1 create`, `r2 bucket create`, `deploy`,
`secret put` (`docs/CLOUDFLARE_RESOURCES.md §6`). Each created resource is
recorded in `.mallok/create-state.json` before the call that creates it.

Run that command **directly in an interactive terminal**. It hands the setup
key to that terminal once, through an awaited write, and records delivery only
after the write succeeds. The returned command result and every JSON/file
record omit the value. Redirected stdout is refused before the first
Cloudflare mutation, because a CI log is not a safe delivery channel. Copy the
key into the wizard; it is deliberately not written to disk. If it is lost,
run `mallok setup-key` from this project in an interactive terminal — a manual
`wrangler secret put` would leave the create ledger out of sync.

**Pass:** `.mallok/create-state.json` names the database and bucket that were
created, records the account id, and carries **no secret value**;
`.mallok/sites.json` has the site; the Worker answers on its `.workers.dev`
address.

**Then run it again, directly in the terminal.** A finished project must be a
no-op. `create` deliberately rejects `--json` even on this path because the
command's contract includes one-time credential delivery; that refusal occurs
before it inspects or changes Cloudflare:

```bash
set -euo pipefail
test -f .tmp/gate-target.json
GATE_SLUG=$(node -p "require('./.tmp/gate-target.json').slug")
SITE_DOMAIN=$(node -p "require('./.tmp/gate-target.json').domain")
ledger_slug=$(node -p "require('./.mallok/create-state.json').slug")
ledger_domain=$(node -p "require('./.mallok/create-state.json').domain")
[ "$ledger_slug" = "$GATE_SLUG" ] && [ "$ledger_domain" = "$SITE_DOMAIN" ] \
  || { echo 'ledger changed after the gate target was recorded' >&2; exit 1; }
./node_modules/.bin/mallok create . --slug "$GATE_SLUG" \
  --domain "$SITE_DOMAIN"
```

**Pass:** exit 0, the human report says the site is already complete, and
`wrangler deployments list` shows no new deployment. A second run must not
redeploy, rotate `MALLOK_SECRET`, or issue another setup key — rotating the
first signs every user out and makes stored plugin keys unreadable.

**Every wrangler command from here on is the project's own:**

```bash
set -euo pipefail
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

```bash
set -euo pipefail
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
SITE="https://$SITE_DOMAIN/"
assert_response_headers() {
  expected_cache=$1
  expected_control=$2
  shift 2
  headers=$(mktemp)
  curl -fsS -o /dev/null -D "$headers" "$@" "$SITE"
  cache_status=$(awk '
    tolower($1)=="x-mallok-cache:" { gsub("\\r", "", $2); value=$2 }
    END { print value }
  ' "$headers")
  cache_control=$(awk '
    tolower($1)=="cache-control:" {
      sub(/^[^:]*:[[:space:]]*/, ""); gsub("\\r", ""); value=$0
    }
    END { print value }
  ' "$headers")
  rm -f "$headers"
  if [ "$expected_cache" = MISS_OR_HIT ]; then
    case "$cache_status" in MISS|HIT) ;; *)
      echo "expected MISS or HIT, got ${cache_status:-missing}" >&2; return 1;;
    esac
  else
    [ "$cache_status" = "$expected_cache" ] \
      || { echo "expected $expected_cache, got ${cache_status:-missing}" >&2; return 1; }
  fi
  [ "$cache_control" = "$expected_control" ] \
    || { echo "unexpected cache-control: ${cache_control:-missing}" >&2; return 1; }
}
# GET, not HEAD. A HEAD does not populate the edge cache, so a HEAD/HEAD pair
# reports MISS twice and a HEAD/GET pair reports MISS twice as well — which
# reads exactly like a broken cache.
assert_response_headers MISS_OR_HIT 'public, max-age=0, s-maxage=3600'
assert_response_headers HIT 'public, max-age=0, s-maxage=3600'
```

**Pass:** the first response is `MISS` or an existing `HIT`, the second is
`HIT`, and both carry `cache-control: public, max-age=0, s-maxage=3600`.
Section 10 starts from an explicit tag purge and proves the `MISS` path.

**Note the changed expectation.** Before the runtime migration this header was
`public, max-age=3600`. The browser lifetime is 0 on purpose
(`docs/ACCEPTANCE.md §14.2.2` item 3) — a purge cannot reach a browser, so only
the edge gets a long life.

## 8. Wizard, content, media

**Blocker:** §6's deployment. **Status:** `NOT_RUN`.
**Rows:** `AC-DEPLOY-03`, `AC-CONTENT-01/02b`, `AC-MEDIA-01/04`.

1. Open the setup URL under the exact hostname recorded as
   `.mallok/create-state.json.domain` and complete all four steps. Do not
   transcribe the example hostname in §1. The first step asks for the setup key
   §6 delivered to the interactive terminal; a wrong one is refused, and the
   right one stops working the moment setup succeeds.
2. Confirm the wizard 404s afterwards with the checked command below.
3. Publish a real trade article with at least one image, in two languages.
   Keep the content id; §9 reads its exact locale-aware `content.path` from D1
   and records it instead of reconstructing a URL from a slug.
4. Connect an R2 custom domain owned by the same gate account and re-check an
   image. Export that actual hostname as `MEDIA_DOMAIN`; §17 reuses the machine
   record written here instead of asking the operator to type it again.

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

```bash
set -euo pipefail
cd gate-site
: "${MEDIA_DOMAIN:?export the R2 custom-domain hostname connected above}"
[ "${#MEDIA_DOMAIN}" -le 253 ] &&
  printf '%s' "$MEDIA_DOMAIN" | grep -Eq \
    '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' \
  || { echo 'MEDIA_DOMAIN is not a hostname' >&2; exit 1; }
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
setup_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  "https://$SITE_DOMAIN/_mallok/setup")
[ "$setup_status" = 404 ] \
  || { echo "setup still answers with HTTP $setup_status" >&2; exit 1; }
: "${MEDIA_SHA:?export the uploaded object sha256}"
printf '%s' "$MEDIA_SHA" | grep -Eq '^[0-9a-f]{64}$' \
  || { echo 'MEDIA_SHA is not a lowercase sha256' >&2; exit 1; }
mkdir -p .tmp
DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
./node_modules/.bin/wrangler d1 execute "$DATABASE" --remote \
  --json --command "SELECT sha256, ext, variants FROM media WHERE sha256 = '$MEDIA_SHA'" \
  > .tmp/media-upload-row.json
node - "$MEDIA_SHA" .tmp/media-upload-row.json \
  .tmp/media-upload-target.json <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const [expectedSha, input, output] = process.argv.slice(2);
const batches = JSON.parse(readFileSync(input, 'utf8'));
const rows = Array.isArray(batches)
  ? batches.flatMap(batch => Array.isArray(batch.results) ? batch.results : [])
  : [];
if (rows.length !== 1) throw new Error(`expected one media row, got ${rows.length}`);
const row = rows[0];
const widths = typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants;
if (row.sha256 !== expectedSha || typeof row.ext !== 'string' ||
    !/^[a-z0-9]+$/.test(row.ext) || !Array.isArray(widths) ||
    widths.some(n => !Number.isInteger(n) || n <= 0)) {
  throw new Error(`invalid media identity: ${JSON.stringify(row)}`);
}
writeFileSync(output, `${JSON.stringify({ sha: row.sha256, ext: row.ext, widths })}\n`, {
  flag: 'wx',
});
NODE
SHA=$(node -p "require('./.tmp/media-upload-target.json').sha")
EXT=$(node -p "require('./.tmp/media-upload-target.json').ext")
WIDTHS=$(node -p "require('./.tmp/media-upload-target.json').widths.join(' ')")
BUCKET=$(node -p "require('./.mallok/create-state.json').bucket.name")

# Every key the upload wrote, original and exactly the recorded variants.
# There is no `r2 object list` in Wrangler 4.124.
./node_modules/.bin/wrangler r2 object get \
  "$BUCKET/media/$SHA.$EXT" --file /dev/null
for width in $WIDTHS; do
  ./node_modules/.bin/wrangler r2 object get \
    "$BUCKET/media/${SHA}_${width}.webp" --file /dev/null
done

# Prove the custom hostname serves this exact original before preserving it as
# the destroy target. A hand-typed but unrelated absent hostname cannot then
# make §17's DNS-absence postcondition pass.
served_media=$(mktemp)
curl -fsS -o "$served_media" "https://$MEDIA_DOMAIN/media/$SHA.$EXT"
served_sha=$(shasum -a 256 "$served_media" | awk '{print $1}')
rm -f "$served_media"
[ "$served_sha" = "$SHA" ] \
  || { echo "media domain returned sha256 $served_sha, expected $SHA" >&2; exit 1; }
node - "$MEDIA_DOMAIN" "$BUCKET" <<'NODE'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const [domain, bucket] = process.argv.slice(2);
const target = { domain, bucket };
const file = '.tmp/media-domain.json';
if (existsSync(file)) {
  const existing = JSON.parse(readFileSync(file, 'utf8'));
  if (JSON.stringify(existing) !== JSON.stringify(target)) {
    throw new Error('the recorded media-domain identity changed');
  }
} else {
  writeFileSync(file, `${JSON.stringify(target)}\n`, { flag: 'wx' });
}
NODE
```

Take the widths from the media library's own record; a theme can ask for a
different set, and narrow images deliberately omit widths that would upscale.

**Also check what provisioning wrote**, because these are new since 0.1.0-rc.2 and
have never run against a real account:

```bash
set -euo pipefail
cd gate-site
DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
MEDIA_DOMAIN=$(node -p "require('./.tmp/media-domain.json').domain")
site_file=$(mktemp)
./node_modules/.bin/wrangler d1 execute "$DATABASE" --remote \
  --json --command "SELECT domain, media_base_url, setup_key_used_at FROM site" \
  > "$site_file"
node - "$SITE_DOMAIN" "$MEDIA_DOMAIN" "$site_file" <<'NODE'
const { readFileSync } = require('node:fs');
const [expectedDomain, expectedMedia, file] = process.argv.slice(2);
const batches = JSON.parse(readFileSync(file, 'utf8'));
const rows = Array.isArray(batches)
  ? batches.flatMap(batch => Array.isArray(batch.results) ? batch.results : [])
  : [];
if (rows.length !== 1) throw new Error(`expected one site row, got ${rows.length}`);
const row = rows[0];
if (row.domain !== expectedDomain ||
    row.media_base_url !== `https://${expectedMedia}` ||
    typeof row.setup_key_used_at !== 'string' || row.setup_key_used_at === '') {
  throw new Error(`provisioned site fields differ: ${JSON.stringify(row)}`);
}
NODE
rm -f "$site_file"
```

`domain` must equal the create ledger — copied from the Worker's own
`MALLOK_DOMAIN` var when setup finished, not typed in. `setup_key_used_at`
must be set. If the R2 custom domain was attached after setup, set it in
Settings → Site before running this assertion.

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

```bash
set -euo pipefail
cd gate-site
: "${CONTENT_ID:?export the content id for that article}"
printf '%s' "$CONTENT_ID" | grep -Eq \
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' \
  || { echo 'CONTENT_ID is not a UUID' >&2; exit 1; }
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
mkdir -p .tmp
article_row=$(mktemp)
./node_modules/.bin/wrangler d1 execute "$DATABASE" --remote --json \
  --command "SELECT id, path, status FROM content WHERE id = '$CONTENT_ID'" \
  > "$article_row"
node - "$CONTENT_ID" "$article_row" .tmp/article-target.json <<'NODE'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const [expectedId, input, output] = process.argv.slice(2);
const batches = JSON.parse(readFileSync(input, 'utf8'));
const rows = Array.isArray(batches)
  ? batches.flatMap(batch => Array.isArray(batch.results) ? batch.results : [])
  : [];
if (rows.length !== 1) throw new Error(`expected one article, got ${rows.length}`);
const row = rows[0];
const path = row.path;
if (row.id !== expectedId || row.status !== 'published' ||
    typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
    /[?#]/.test(path) || path.split('/').includes('..') ||
    new URL(path, 'https://gate.invalid').pathname !== path) {
  throw new Error(`invalid published article identity: ${JSON.stringify(row)}`);
}
const target = { id: row.id, path };
if (existsSync(output)) {
  const recorded = JSON.parse(readFileSync(output, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(target)) {
    throw new Error('the recorded article identity changed');
  }
} else {
  writeFileSync(output, `${JSON.stringify(target)}\n`, { flag: 'wx' });
}
NODE
rm -f "$article_row"
ARTICLE_PATH=$(node -p "require('./.tmp/article-target.json').path")
PAGE="https://$SITE_DOMAIN$ARTICLE_PATH"

assert_cache_status() {
  expected=$1
  url=$2
  headers=$(mktemp)
  curl -fsS -o /dev/null -D "$headers" "$url"
  actual=$(awk '
    tolower($1)=="x-mallok-cache:" { gsub("\\r", "", $2); value=$2 }
    END { print value }
  ' "$headers")
  rm -f "$headers"
  if [ "$expected" = MISS_OR_HIT ]; then
    case "$actual" in MISS|HIT) ;; *)
      echo "expected MISS or HIT, got: ${actual:-missing}" >&2; return 1;;
    esac
  else
    [ "$actual" = "$expected" ] \
      || { echo "expected $expected, got: ${actual:-missing}" >&2; return 1; }
  fi
}

# 1. Cache the current version, and prove it is cached rather than assuming
#    it. GET twice: a HEAD does not populate the edge cache.
assert_cache_status MISS_OR_HIT "$PAGE"
curl -fsS "$PAGE" | grep -q 'OLD MARKER'
assert_cache_status HIT "$PAGE"

# 2. Change what the site *would* render, without any code path that purges.
#    `render_cache.html` is the derived fragment a page is assembled from
#    (src/db/migrations/0001_init.sql); writing it here is a deliberate reach
#    behind the application, and it is the only way to separate "the edge is
#    stale" from "the edge was purged".
update_json=$(./node_modules/.bin/wrangler d1 execute "$DATABASE" --remote \
  --json \
  --command "UPDATE render_cache SET html = REPLACE(html, 'OLD MARKER', 'NEW MARKER') WHERE content_id = '$CONTENT_ID' AND instr(html, 'OLD MARKER') > 0")
printf '%s' "$update_json" | node -e '
let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
  const batches=JSON.parse(s);
  const changed=Array.isArray(batches)
    ? batches.reduce((n,b)=>n+Number(b?.meta?.changes ?? 0),0)
    : 0;
  if(changed<1) throw new Error(`expected at least one changed fragment, got ${changed}`);
})'

# 3. The edge must still serve the old copy — repeatedly, over more than a
#    moment, so that this is not a single lucky request.
for _ in 1 2 3; do
  assert_cache_status HIT "$PAGE"
  body=$(curl -fsS "$PAGE")
  printf '%s' "$body" | grep -q 'OLD MARKER'
  if printf '%s' "$body" | grep -q 'NEW MARKER'; then
    echo 'uncached marker reached the edge before the purge' >&2
    exit 1
  fi
  sleep 5
done
```

**Pass:** every request in step 3 is a `HIT` carrying `OLD MARKER`.

**If step 3 shows `NEW MARKER`,** the page was not cached — check
`x-mallok-cache` and `cache-control` — and §9.2 below would measure nothing.
Stop and find out why before continuing.

### 9.2 A tag purge removes it

```bash
set -euo pipefail
test -f .tmp/article-target.json
CONTENT_ID=$(node -p "require('./.tmp/article-target.json').id")
ARTICLE_PATH=$(node -p "require('./.tmp/article-target.json').path")
PAGE_TAG="c:$CONTENT_ID"
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
PAGE="https://$SITE_DOMAIN$ARTICLE_PATH"
# The tag the Worker set for this page. Cloudflare strips `Cache-Tag` before
# the response leaves the edge, so it cannot be read with curl. The `c:` tag is
# derived from the D1-asserted article identity above, following the tagging
# rule in docs/ARCHITECTURE.md §9; it is never hand-transcribed.
curl_config=$(mktemp)
chmod 600 "$curl_config"
printf 'header = "Authorization: Bearer %s"\nurl = "https://api.cloudflare.com/client/v4/zones/%s/purge_cache"\n' \
  "$CF_API_TOKEN" "$CF_ZONE_ID" > "$curl_config"
trap 'rm -f "$curl_config"' EXIT
purge_response=$(curl -fsS -X POST \
  --config "$curl_config" \
  -H 'Content-Type: application/json' \
  --data "{\"tags\":[\"$PAGE_TAG\"]}")
printf '%s' "$purge_response" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
    const r=JSON.parse(s); if(r.success!==true) process.exit(1)
  })'
rm -f "$curl_config"
trap - EXIT

started=$(date +%s)
until curl -fsS "$PAGE" | grep -q 'NEW MARKER'; do
  [ $(($(date +%s) - started)) -lt 60 ] || { echo 'never purged within 60 seconds' >&2; exit 1; }
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

```bash
set -euo pipefail
test -f .tmp/article-target.json
ARTICLE_PATH=$(node -p "require('./.tmp/article-target.json').path")
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
PAGE="https://$SITE_DOMAIN$ARTICLE_PATH"
assert_cache_status() {
  expected=$1
  url=$2
  headers=$(mktemp)
  curl -fsS -o /dev/null -D "$headers" "$url"
  actual=$(awk '
    tolower($1)=="x-mallok-cache:" { gsub("\\r", "", $2); value=$2 }
    END { print value }
  ' "$headers")
  rm -f "$headers"
  [ "$actual" = "$expected" ] \
    || { echo "expected $expected, got: ${actual:-missing}" >&2; return 1; }
}
# 1. Warm the page again and confirm the HIT.
curl -fsS -o /dev/null "$PAGE"
assert_cache_status HIT "$PAGE"

# 2. Edit the article in the admin — a real save, through the UI — replacing
#    OLD MARKER in the source with SAVED MARKER. The NEW MARKER exists only in
#    the derived fragment changed behind the application's back in §9.1.
#    Purge nothing by hand.
printf '%s\n' 'Save that edit in the admin, then press Enter here.' >&2
read -r _

started=$(date +%s)
until curl -fsS "$PAGE" | grep -q 'SAVED MARKER'; do
  [ $(($(date +%s) - started)) -lt 60 ] || { echo 'save did not purge within 60 seconds' >&2; exit 1; }
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

```bash
set -euo pipefail
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
SITE="https://$SITE_DOMAIN/"
: "${CACHE_TEST_TAG:?export the exact cache tag for the root page}"
printf '%s' "$CACHE_TEST_TAG" | grep -Eq '^[A-Za-z0-9:_-]+$' \
  || { echo 'CACHE_TEST_TAG contains unsafe characters' >&2; exit 1; }

assert_response_headers() {
  expected_cache=$1
  expected_control=$2
  shift 2
  headers=$(mktemp)
  curl -fsS -o /dev/null -D "$headers" "$@" "$SITE"
  cache_status=$(awk '
    tolower($1)=="x-mallok-cache:" { gsub("\\r", "", $2); value=$2 }
    END { print value }
  ' "$headers")
  cache_control=$(awk '
    tolower($1)=="cache-control:" {
      sub(/^[^:]*:[[:space:]]*/, ""); gsub("\\r", ""); value=$0
    }
    END { print value }
  ' "$headers")
  rm -f "$headers"
  [ "$cache_control" = "$expected_control" ] \
    || { echo "unexpected cache-control: ${cache_control:-missing}" >&2; return 1; }
  [ "$cache_status" = "$expected_cache" ] \
    || { echo "expected $expected_cache, got ${cache_status:-missing}" >&2; return 1; }
}

# Establish the mutation precondition first. Without this confirmed HIT, a
# cold or evicted entry would produce a natural MISS and make a wrong tag look
# like a successful purge.
started=$(date +%s)
until assert_response_headers HIT 'public, max-age=0, s-maxage=3600'; do
  [ "$cache_status" = MISS ] \
    || { echo "unexpected cache status while warming: ${cache_status:-missing}" >&2; exit 1; }
  [ $(($(date +%s) - started)) -lt 30 ] \
    || { echo 'root page did not become a HIT within 30 seconds' >&2; exit 1; }
  sleep 1
done

# Purge only after the HIT is observed. The API's JSON success flag is checked;
# HTTP 200 alone does not prove the purge was accepted.
curl_config=$(mktemp)
chmod 600 "$curl_config"
printf 'header = "Authorization: Bearer %s"\nurl = "https://api.cloudflare.com/client/v4/zones/%s/purge_cache"\n' \
  "$CF_API_TOKEN" "$CF_ZONE_ID" > "$curl_config"
trap 'rm -f "$curl_config"' EXIT
purge_response=$(curl -fsS -X POST --config "$curl_config" \
  -H 'Content-Type: application/json' \
  --data "{\"tags\":[\"$CACHE_TEST_TAG\"]}")
printf '%s' "$purge_response" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
    const r=JSON.parse(s); if(r.success!==true) process.exit(1)
  })'
rm -f "$curl_config"
trap - EXIT

# Wait for that known HIT to become a MISS, accepting only the pre-purge HIT
# while invalidation propagates. The first MISS also fills the cache.
started=$(date +%s)
until assert_response_headers MISS 'public, max-age=0, s-maxage=3600'; do
  [ "$cache_status" = HIT ] \
    || { echo "unexpected cache status while waiting: ${cache_status:-missing}" >&2; exit 1; }
  [ $(($(date +%s) - started)) -lt 60 ] \
    || { echo 'tag purge did not produce a MISS within 60 seconds' >&2; exit 1; }
  sleep 2
done
assert_response_headers HIT 'public, max-age=0, s-maxage=3600'

# Credentialed: each must bypass the cache entirely.
assert_response_headers BYPASS 'private, no-store' \
  -H 'Authorization: Bearer x'
assert_response_headers BYPASS 'private, no-store' -H 'Cookie: a=1'

# HEAD: use Fetch so response headers and body bytes are separate. `curl -I`
# writes the headers to its output file, so testing that file for zero bytes
# falsely reports a body even when the server obeyed HEAD.
node --input-type=module - "$SITE" <<'NODE'
const response = await fetch(process.argv[2], {
  method: 'HEAD',
  redirect: 'manual',
});
const bytes = await response.arrayBuffer();
if (response.status !== 200 || bytes.byteLength !== 0 ||
    response.headers.get('x-mallok-cache') !== 'HIT' ||
    response.headers.get('cache-control') !== 'public, max-age=0, s-maxage=3600') {
  throw new Error(`bad HEAD response: ${JSON.stringify({
    status: response.status,
    bytes: bytes.byteLength,
    cache: response.headers.get('x-mallok-cache'),
    control: response.headers.get('cache-control'),
  })}`);
}
NODE
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

There are three different meanings of “cold” here. They must not be collapsed:

- a **cache-cold `MISS`** invokes Mallok and renders the page;
- a **cache-warm `HIT`** still invokes Mallok, because `caches.default.match`
  is called inside the Worker; it skips `locals`, D1 and rendering and should
  therefore use very little Worker CPU;
- an **isolate cold start** is runtime startup. The current Observability
  telemetry model has an optional `$metadata.coldStart` field. Group by it
  when this deployment emits it; if the field is absent, report that startup
  classification as unavailable rather than guessing from the first or
  slowest sample.

The locked Wrangler's real-time `tail` JSON is useful for seeing invocations,
but it is **not the CPU source for this gate**: its current documented JSON
shape does not promise a CPU field. CPU and wall time are indexed on the
persisted Workers invocation log as `$workers.cpuTimeMs` and
`$workers.wallTimeMs`. Read them with Workers Observability Query Builder.
`wallTimeMs` includes D1 waits and is recorded as latency, not substituted for
CPU.

Before collecting samples, make the disposable gate deployment's telemetry
complete and redeploy it. The default trace rate is currently 1, but this gate
states both rates explicitly so a copied project setting cannot silently make
the sample incomplete:

```jsonc
"observability": {
  "enabled": true,
  "logs": {
    "enabled": true,
    "invocation_logs": true,
    "head_sampling_rate": 1
  },
  "traces": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

Run `./node_modules/.bin/wrangler deploy`, then select only telemetry produced
by that deployment. Restore the project's normal observability settings after
the gate if full tracing is not wanted in ordinary use.

Use one published article with an image at
`GET /<locale>/news/<slug>`. Collect two named populations, one request at a
time:

| Population | n | What is recorded | Statistics |
| --- | ---: | --- | --- |
| cache-cold | 30 confirmed `MISS` responses, purged by the page's exact tag before each sample | Workers Logs `$workers.cpuTimeMs`; client `time_total` as a separate latency measure | CPU and latency p50, p95, max |
| cache-warm | 30 confirmed `HIT` responses after one warm-up request | Workers Logs `$workers.cpuTimeMs`; client `time_total` separately | CPU and latency p50, p95, max |

Use the page tag established in §9.2. The query parameter is only a sample id:
Mallok's cache key deliberately removes the query string, so it neither makes
a new cache entry nor turns a `HIT` into a `MISS`.

```bash
set -euo pipefail
cd gate-site
test -f .tmp/article-target.json
CONTENT_ID=$(node -p "require('./.tmp/article-target.json').id")
ARTICLE_PATH=$(node -p "require('./.tmp/article-target.json').path")
PAGE_TAG="c:$CONTENT_ID"
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
PAGE="https://$SITE_DOMAIN$ARTICLE_PATH"
mkdir -p .tmp/cpu-gate
: > .tmp/cpu-gate/cold-http.tsv
: > .tmp/cpu-gate/warm-http.tsv
curl_config=$(mktemp)
chmod 600 "$curl_config"
printf 'header = "Authorization: Bearer %s"\nurl = "https://api.cloudflare.com/client/v4/zones/%s/purge_cache"\n' \
  "$CF_API_TOKEN" "$CF_ZONE_ID" > "$curl_config"
trap 'rm -f "$curl_config"' EXIT

# Each accepted sample must say MISS. A successful purge API response is
# checked as JSON; HTTP 200 with {"success":false} is a failure, not a purge.
for i in $(seq 1 30); do
  purge_response=$(curl -fsS -X POST \
    --config "$curl_config" \
    -H 'Content-Type: application/json' \
    --data "{\"tags\":[\"$PAGE_TAG\"]}")
  printf '%s' "$purge_response" | node -e '
    let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
      const r=JSON.parse(s); if(r.success!==true) process.exit(1)
    })'

  # Do not probe with HEAD: a MISS on HEAD still runs locals, D1 and render,
  # which would warm the very code path this sample is meant to measure.
  # Give tag invalidation time to propagate, then accept exactly one request.
  # If it is still HIT, abort and repeat the whole run in a fresh log window;
  # do not add an uncounted retry to this population.
  sleep 5

  headers=$(mktemp)
  elapsed=$(curl -fsS -o /dev/null -D "$headers" -w '%{time_total}' \
    "$PAGE?mallok_cpu_sample=cold-$i")
  cache_status=$(awk '
    tolower($1)=="x-mallok-cache:" { gsub("\\r", "", $2); value=$2 }
    END { print value }
  ' "$headers")
  rm -f "$headers"
  [ "$cache_status" = MISS ] \
    || { echo "expected tagged MISS, got: $cache_status" >&2; exit 1; }
  printf '%s\t%s\n' "$i" "$elapsed" >> .tmp/cpu-gate/cold-http.tsv
  sleep 1
done

# The first request fills the cache. Every measured request must then be HIT.
curl -fsS -o /dev/null "$PAGE"
for i in $(seq 1 30); do
  headers=$(mktemp)
  elapsed=$(curl -fsS -o /dev/null -D "$headers" -w '%{time_total}' \
    "$PAGE?mallok_cpu_sample=warm-$i")
  cache_status=$(awk '
    tolower($1)=="x-mallok-cache:" { gsub("\\r", "", $2); value=$2 }
    END { print value }
  ' "$headers")
  rm -f "$headers"
  [ "$cache_status" = HIT ] || { echo "expected HIT, got: $cache_status" >&2; exit 1; }
  printf '%s\t%s\n' "$i" "$elapsed" >> .tmp/cpu-gate/warm-http.tsv
  sleep 1
done

node -e '
  const fs=require("fs");
  for(const name of ["cold-http","warm-http"]){
    const a=fs.readFileSync(`.tmp/cpu-gate/${name}.tsv`,"utf8").trim()
      .split("\n").map(x=>Number(x.split("\t")[1])*1000).sort((a,b)=>a-b);
    const at=q=>a[Math.ceil(q*a.length)-1];
    console.log(name,{n:a.length,p50_ms:at(.5),p95_ms:at(.95),max_ms:a.at(-1)});
  }
'
rm -f "$curl_config"
trap - EXIT
```

After Workers Logs has ingested the run, open the gate Worker's Observability
Query Builder and select the exact run window. For the cold population filter
`$metadata.type = cf-worker-event`, require `$workers.cpuTimeMs` to exist,
filter `$metadata.url` for `mallok_cpu_sample=cold-`, and require the invocation
outcome `$workers.outcome` to be `ok`; calculate `Count`, `Median`, `P95`, and `Max` over
`$workers.cpuTimeMs`. Repeat with `$metadata.url` filtered for
`mallok_cpu_sample=warm-`. Filtering to the invocation event is essential:
console rows from the same request are separate log events and would make
`Count` exceed the number of requests. Each count must be exactly 30: both
paths invoke the Worker, while only the `MISS` builds locals and renders. If
Workers Logs sampling or retention makes either count inconclusive, this gate
remains `NOT_RUN`; do not fill the gap with `wrangler tail` or client latency.
When `$metadata.coldStart` exists on these invocations, also group each CPU
distribution by that field; when it does not, record it as unavailable.

**Pass (CPU):** record the path and time window; cache-cold and cache-warm
n=30 CPU p50/p95/max; both populations' client-latency p50/p95/max; and cold
max ≤ 10 ms. The architecture applies its 10 ms budget to **every**
invocation, so a 50 ms outlier is a failure even when p95 is below 10 ms.
Compare warm CPU with the architecture's under-1 ms target and record the
result; do not rewrite a measured value as 0 or N/A.
Record the `$metadata.coldStart` grouping when present, or “field unavailable”
when absent; never assign a slow sample to startup by guesswork. A report that
says only “within budget” has not run this step.

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
immediately record the target while it is still `scheduled`. This precondition
is mandatory: the `scheduled_publish` log carries a count, not content ids, so
an already-published target plus an unrelated publish event would otherwise
look green.

```bash
set -euo pipefail
cd gate-site
: "${SCHEDULED_CONTENT_ID:?export the scheduled article content id}"
printf '%s' "$SCHEDULED_CONTENT_ID" | grep -Eq \
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' \
  || { echo 'SCHEDULED_CONTENT_ID is not a UUID' >&2; exit 1; }
mkdir -p .tmp
DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
scheduled_file=$(mktemp)
./node_modules/.bin/wrangler d1 execute "$DATABASE" --remote --json \
  --command "SELECT id, status, published_at, updated_at FROM content WHERE id = '$SCHEDULED_CONTENT_ID'" \
  > "$scheduled_file"
node - "$SCHEDULED_CONTENT_ID" "$scheduled_file" \
  .tmp/scheduled-publish-target.json <<'NODE'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const [expectedId, input, output] = process.argv.slice(2);
const batches = JSON.parse(readFileSync(input, 'utf8'));
const rows = Array.isArray(batches)
  ? batches.flatMap(batch => Array.isArray(batch.results) ? batch.results : [])
  : [];
if (rows.length !== 1 || rows[0].id !== expectedId ||
    rows[0].status !== 'scheduled' ||
    !Number.isFinite(Date.parse(rows[0].published_at)) ||
    !Number.isFinite(Date.parse(rows[0].updated_at))) {
  throw new Error(`target is not one scheduled article: ${JSON.stringify(rows)}`);
}
const target = {
  id: rows[0].id,
  publishedAt: rows[0].published_at,
  beforeUpdatedAt: rows[0].updated_at,
};
if (existsSync(output)) {
  const recorded = JSON.parse(readFileSync(output, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(target)) {
    throw new Error('the recorded scheduled target changed');
  }
} else {
  writeFileSync(output, `${JSON.stringify(target)}\n`, { flag: 'wx' });
}
NODE
rm -f "$scheduled_file"
```

In another terminal run `./node_modules/.bin/wrangler tail --format=json`,
wait for the exact `scheduled_publish` event and record its timestamp, then
stop tail. Before making any public request, prove the same machine-recorded
row crossed from `scheduled` to `published` at or after its scheduled time:

```bash
set -euo pipefail
test -f .tmp/scheduled-publish-target.json
SCHEDULED_CONTENT_ID=$(node -p "require('./.tmp/scheduled-publish-target.json').id")
DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
scheduled_file=$(mktemp)
./node_modules/.bin/wrangler d1 execute "$DATABASE" --remote --json \
  --command "SELECT id, status, published_at, updated_at FROM content WHERE id = '$SCHEDULED_CONTENT_ID'" \
  > "$scheduled_file"
node - .tmp/scheduled-publish-target.json "$scheduled_file" <<'NODE'
const { readFileSync } = require('node:fs');
const [targetFile, resultFile] = process.argv.slice(2);
const target = JSON.parse(readFileSync(targetFile, 'utf8'));
const batches = JSON.parse(readFileSync(resultFile, 'utf8'));
const rows = Array.isArray(batches)
  ? batches.flatMap(batch => Array.isArray(batch.results) ? batch.results : [])
  : [];
const row = rows[0];
if (rows.length !== 1 || row.id !== target.id || row.status !== 'published' ||
    row.published_at !== target.publishedAt ||
    row.updated_at === target.beforeUpdatedAt ||
    !Number.isFinite(Date.parse(row.updated_at)) ||
    Date.parse(row.updated_at) < Date.parse(target.publishedAt)) {
  throw new Error(`scheduled article was not published: ${JSON.stringify(rows)}`);
}
NODE
rm -f "$scheduled_file"
```

**Pass:** the before-record says `scheduled`; the after-row for the same id and
unchanged `published_at` says `published` with a later `updated_at`; the tail
contains the tick between those observations; and no visitor request arrived
before the D1 assertion.

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

   ```bash
   set -euo pipefail
   cd gate-site
   : "${MEDIA_SHA:?export the uploaded object sha256}"
   printf '%s' "$MEDIA_SHA" | grep -Eq '^[0-9a-f]{64}$' \
     || { echo 'MEDIA_SHA is not a lowercase sha256' >&2; exit 1; }
   mkdir -p .tmp
   DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
   ./node_modules/.bin/wrangler d1 execute "$DATABASE" --remote \
     --json \
     --command "SELECT sha256, ext, variants, ref_count, unreferenced_since FROM media WHERE sha256 = '$MEDIA_SHA'" \
     > .tmp/media-reclaim-row.json
   node - "$MEDIA_SHA" .tmp/media-reclaim-row.json \
     .tmp/media-reclaim-target.json <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const [expectedSha, input, output] = process.argv.slice(2);
const batches = JSON.parse(readFileSync(input, 'utf8'));
const rows = Array.isArray(batches)
  ? batches.flatMap(batch => Array.isArray(batch.results) ? batch.results : [])
  : [];
if (rows.length !== 1) throw new Error(`expected one media row, got ${rows.length}`);
const row = rows[0];
const widths = typeof row.variants === 'string'
  ? JSON.parse(row.variants)
  : row.variants;
if (row.sha256 !== expectedSha || Number(row.ref_count) !== 0 ||
    typeof row.unreferenced_since !== 'string' || row.unreferenced_since === '' ||
    typeof row.ext !== 'string' || !/^[a-z0-9]+$/.test(row.ext) ||
    !Array.isArray(widths) || widths.some(n => !Number.isInteger(n) || n <= 0)) {
  throw new Error(`media row is not a reclaimable target: ${JSON.stringify(row)}`);
}
writeFileSync(output, `${JSON.stringify({ sha: row.sha256, ext: row.ext, widths })}\n`, {
  flag: 'wx',
});
NODE
   ```

   The script refuses anything except one matching 64-character SHA, a zero
   `ref_count`, a set `unreferenced_since`, a safe extension and an integer
   `variants` array. It writes that normalized identity once to
   `.tmp/media-reclaim-target.json`: after reclaim the row is gone, so later
   checks must use this pre-reclaim evidence rather than hand-transcribed keys.
3. Age that one row past the grace period — this gate's own database, this
   object only, never a blanket update:

   ```bash
   set -euo pipefail
   test -f .tmp/media-reclaim-target.json
   MEDIA_SHA=$(node -p "require('./.tmp/media-reclaim-target.json').sha")
   DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
   update_json=$(./node_modules/.bin/wrangler d1 execute \
     "$DATABASE" --remote --json \
     --command "UPDATE media SET unreferenced_since = datetime('now','-8 days') WHERE sha256 = '$MEDIA_SHA'")
   printf '%s' "$update_json" | node -e '
let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
  const batches=JSON.parse(s);
  if(!Array.isArray(batches) || batches.length!==1 ||
      Number(batches[0]?.meta?.changes)!==1){
    throw new Error(`expected exactly one aged row, got ${JSON.stringify(batches)}`)
  }
})'
   ```

   The `WHERE` clause is not optional. Without it every object in the bucket
   is collected on the next tick.
4. Wait for a **real** cron tick. Keep
   `./node_modules/.bin/wrangler tail --format=json` open in a separate
   terminal until the exact `media_collected` event appears, record it, and
   then stop tail.

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

   ```bash
   set -euo pipefail
   # Local only. Never against a deployed site — there is no such route there.
   mkdir -p .tmp
   ./node_modules/.bin/wrangler dev --test-scheduled --port 8787 \
     > .tmp/local-scheduled.log 2>&1 &
   dev_pid=$!
   trap 'kill "$dev_pid" 2>/dev/null || true' EXIT
   ready=0
   for _ in $(seq 1 60); do
     if curl -fsS -o /dev/null \
          'http://127.0.0.1:8787/_mallok/api/setup/status'; then
       ready=1
       break
     fi
     sleep 1
   done
   [ "$ready" = 1 ] || { cat .tmp/local-scheduled.log >&2; exit 1; }
   curl -fsS 'http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*'
   kill "$dev_pid"
   wait_status=0
   wait "$dev_pid" || wait_status=$?
   case "$wait_status" in 0|130|143) ;; *) exit "$wait_status";; esac
   trap - EXIT
   ```
5. Confirm both halves are gone — the row and the object:

   ```bash
   set -euo pipefail
   test -f .tmp/media-reclaim-target.json
   MEDIA_SHA=$(node -p "require('./.tmp/media-reclaim-target.json').sha")
   MEDIA_EXT=$(node -p "require('./.tmp/media-reclaim-target.json').ext")
   MEDIA_WIDTHS=$(node -p "require('./.tmp/media-reclaim-target.json').widths.join(' ')")
   DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
   count_json=$(./node_modules/.bin/wrangler d1 execute \
     "$DATABASE" --remote --json \
     --command "SELECT COUNT(*) AS n FROM media WHERE sha256 = '$MEDIA_SHA'")
   printf '%s' "$count_json" | node -e '
let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
  const batches=JSON.parse(s);
  const rows=Array.isArray(batches)
    ? batches.flatMap(batch=>Array.isArray(batch.results) ? batch.results : [])
    : [];
  if(rows.length!==1 || Number(rows[0].n)!==0){
    process.stderr.write(`expected reclaimed media count 0, got ${JSON.stringify(rows)}\n`);
    process.exit(1);
  }
})'

   # These come from the asserted row recorded before the cron tick. Do not
   # assume all four default widths exist: narrow images have fewer.
   SHA=$MEDIA_SHA
   EXT=$MEDIA_EXT
   WIDTHS=$MEDIA_WIDTHS
   BUCKET=$(node -p "require('./.mallok/create-state.json').bucket.name")

   # Wrangler 4.124.0 turns an absent R2 object into exactly this UserError:
   # "The specified key does not exist." Anything else — an expired token,
   # denied permission, network error, missing bucket or ordinary 404 — is a
   # gate failure, never evidence that reclaim succeeded.
   assert_r2_object_absent() {
     object_path=$1
     error_file=$(mktemp)
     if ./node_modules/.bin/wrangler r2 object get \
          "$object_path" --file /dev/null 2>"$error_file"
     then
       echo "$object_path is still present" >&2
       return 1
     fi
     node - "$error_file" <<'NODE'
const { readFileSync } = require('node:fs');
const plain = readFileSync(process.argv[2], 'utf8')
  .replace(/\x1b\[[0-9;]*m/g, '');
const errors = plain.split('\n')
  .filter((line) => line.includes('[ERROR]'))
  .map((line) => line.slice(line.indexOf('[ERROR]')).trim());
if (errors.length !== 1 ||
    errors[0] !== '[ERROR] The specified key does not exist.') {
  process.stderr.write(`Wrangler failed for another reason:\n${plain}`);
  process.exit(1);
}
NODE
   }

   # The original key uses the recorded SHA and extension; variants add width.
   assert_r2_object_absent "$BUCKET/media/$SHA.$EXT"
   for width in $WIDTHS; do
     assert_r2_object_absent "$BUCKET/media/${SHA}_${width}.webp"
   done
   ```

**Pass:** the count is 0; the original and every variant recorded in the row
produce Wrangler 4.124.0's exact key-absence error; and `media_collected`
appeared in the tail. Record the tick's timestamp. A generic `404`,
`Not Found`, `NoSuchKey`, or “does not exist” grep is not accepted: each can
describe a different resource or a failed gateway and used to make this gate
fail open.

**Free plan ceiling:** five cron triggers per account, one per Mallok site. A
gate site occupies one of them for as long as it exists, which is another
reason for §17.

## 13. Turnstile, Resend, a real inquiry

**Blocker:** Turnstile and Resend accounts. **Status:** `NOT_RUN`.
**Rows:** `AC-PLUGIN-02b`, `AC-PLUGIN-03b`, `AC-PLUGIN-05b`.

Enter both key pairs in Admin → Plugins → Inquiry. Keep the full-rate logs and
traces configured in §11; the trace is what makes the exact fetch and binding
operations of one submission countable. Then, from a browser (not curl — the
widget must render):

1. Submit the inquiry form on a product page.
2. With autoreply enabled, confirm both the owner notification and buyer
   acknowledgement arrive at addresses the operator controls.
3. Confirm the inquiry appears in the admin and in an export.
4. Keep `wrangler tail` open for immediate exceptions and the invocation
   outcome. It is diagnostic evidence, not the CPU counter.
5. In Workers Observability, find that exact invocation. Record
   `$workers.cpuTimeMs`, then open its trace and count the outbound `fetch`
   spans and every binding span. With autoreply enabled, the code path has
   exactly three outbound fetches: one Turnstile verification and two Resend
   sends. Record the D1 spans separately, then count all fetch and binding
   spans for the platform subrequest ceiling. Do not use an account-wide graph
   as though it described this one submission.

**Pass:** both real emails received; the widget rejects a submission with no token;
the successful submission has `$workers.cpuTimeMs ≤ 10`; it has exactly three
outbound fetch spans; and all fetch plus binding spans total at most 50, the
free-plan per-invocation ceiling in `docs/ARCHITECTURE.md §2`. Any missing
trace or sampled-out invocation leaves this row `NOT_RUN`; “within budget”
without the numbers is not a result.

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

```bash
set -euo pipefail
test -f .tmp/article-target.json
ARTICLE_PATH=$(node -p "require('./.tmp/article-target.json').path")
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
# Warm the edge first: a cold cache fails this for reasons that say nothing
# about the code.
curl -fsS -o /dev/null "https://$SITE_DOMAIN/"
curl -fsS -o /dev/null "https://$SITE_DOMAIN$ARTICLE_PATH"

rm -rf .tmp/lighthouse
./node_modules/.bin/lhci autorun \
  --config=./lighthouserc.json \
  --collect.url="https://$SITE_DOMAIN/" \
  --collect.url="https://$SITE_DOMAIN$ARTICLE_PATH"

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

```bash
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

**Row:** `AC-DEPLOY-02`, **withdrawn from 0.1.0-rc.4's claimed capability and
still unavailable in the 0.1.0-rc.5 candidate.**

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
follow-up work after 0.1.0-rc.5**, on a clean account, and it is tracked
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
The later version chosen for this row must introduce a known migration; a
pair with no schema change can test package replacement but cannot close
`AC-DEPLOY-08`'s migration claim.

```bash
set -euo pipefail
cd gate-site
: "${MALLOK_NEXT_VERSION:?export the next published Mallok version}"
: "${EXPECTED_MIGRATION_ID:?export the migration introduced by that version}"
printf '%s' "$EXPECTED_MIGRATION_ID" | grep -Eq '^[A-Za-z0-9:_-]+$' \
  || { echo 'EXPECTED_MIGRATION_ID contains unsafe characters' >&2; exit 1; }
test -f .tmp/article-target.json
ARTICLE_PATH=$(node -p "require('./.tmp/article-target.json').path")
SITE_DOMAIN=$(node -p "require('./.mallok/create-state.json').domain")
DATABASE=$(node -p "require('./.mallok/create-state.json').database.name")
PAGE="https://$SITE_DOMAIN$ARTICLE_PATH"

assert_migration_count() {
  expected=$1
  migration_json=$(./node_modules/.bin/wrangler d1 execute \
    "$DATABASE" --remote --json \
    --command "SELECT COUNT(*) AS n FROM migration WHERE id = '$EXPECTED_MIGRATION_ID'")
  printf '%s' "$migration_json" | node -e '
let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
  const expected=Number(process.argv[1]);
  const batches=JSON.parse(s);
  const rows=Array.isArray(batches)
    ? batches.flatMap(batch=>Array.isArray(batch.results) ? batch.results : [])
    : [];
  if(rows.length!==1 || Number(rows[0].n)!==expected){
    throw new Error(`expected migration count ${expected}, got ${JSON.stringify(rows)}`)
  }
})' "$expected"
}

# 1. Prove this really is a new migration, then preserve a page body from the
#    version this gate deployed. An existing migration id cannot close the row.
assert_migration_count 0
before_body=$(mktemp)
curl -fsS -o "$before_body" "$PAGE"
grep -q 'MARKER' "$before_body"
rm -f "$before_body"

# 2. Move the site to the next release. This is `mallok upgrade`, the same
#    command a user runs — not a merge, and not an edit of the manifest.
./node_modules/.bin/mallok upgrade --to "$MALLOK_NEXT_VERSION"

# 3. Deploy it.
./node_modules/.bin/wrangler deploy

# 4. Force the new Worker to boot, migrate and render without consulting the
#    anonymous edge entry warmed in step 1. A cached pre-upgrade body is not
#    evidence that the new release can read the old content.
after_headers=$(mktemp)
after_body=$(mktemp)
curl -fsS -H 'Authorization: Bearer x' \
  -D "$after_headers" -o "$after_body" "$PAGE"
grep -q 'MARKER' "$after_body"
cache_status=$(awk '
  tolower($1)=="x-mallok-cache:" { gsub("\\r", "", $2); value=$2 }
  END { print value }
' "$after_headers")
cache_control=$(awk '
  tolower($1)=="cache-control:" {
    sub(/^[^:]*:[[:space:]]*/, ""); gsub("\\r", ""); value=$0
  }
  END { print value }
' "$after_headers")
rm -f "$after_headers" "$after_body"
[ "$cache_status" = BYPASS ] && [ "$cache_control" = 'private, no-store' ] \
  || { echo 'post-upgrade page did not bypass the old edge entry' >&2; exit 1; }
assert_migration_count 1
```

There is no `mallok.json` to read: 0.1 has no project-file migration system,
so an upgrade leaves nothing in the site's own directory to inspect
(`docs/CLI.md §10.1`).

**Pass:** the named migration moves from count 0 to count 1; step 4 renders the
recorded locale-aware page through a confirmed `BYPASS` with its content
intact; and `wrangler tail` during step 3 shows no window of failed requests.

Until a second version exists, this step is `NOT_RUN` for a reason nobody can
fix on the day: **it needs two published releases.** The local half is
`VERIFIED_LOCAL` in `test/cli/upgrade.test.ts` — two real tarballs, a local
registry, a project created on the first and upgraded to the second, with its
content, settings, theme and plugins compared before and after.

**Rollback:** `wrangler rollback` returns the previous Worker version. It does
**not** undo a D1 migration, so an upgrade whose migration is destructive needs
its down-path written before the upgrade, not after it.

## 17. Delete everything the gate created

**Status:** `NOT_RUN`. This is a step, not a courtesy: a gate site holds one of
five free cron triggers and keeps a database and a bucket alive.

The order is **bucket, Worker, database** — the step that can refuse runs
first, while everything else is still intact, so a refusal costs nothing and
the site keeps serving. Before any of it, `destroy` compares the **database's
UUID** against the one the ledger recorded: a name is reusable, so a database
of that name today may be one somebody else created after a previous site was
destroyed (`docs/CLI.md §10`). A mismatch stops the run, and so does a failure
to read the id.

An R2 bucket cannot be deleted while it holds objects or has a custom domain
attached; both refusals are recognised from what Cloudflare actually says, and
anything else stops rather than being read as "already gone". Before those
calls, `destroy` also reads this project's `wrangler.jsonc`, checks its Worker
name and `DB` binding against the slug and recorded D1 UUID, and checks the
active account against both ledger and registry. The runbook preflight below
also parses `wrangler.jsonc` and requires its Worker, `DB`, `MEDIA`, site var and
custom-domain route to match both the ledger and the names derived from the
slug. That extra R2 binding comparison matters because `destroy` itself does
not currently expose it in its project-identity parser. The final D1 delete
addresses the verified `DB` binding, not a reusable database name. R2 and
Worker expose no comparable stable id through this Wrangler, so their proof is
explicitly weaker: checked account plus checked name.

```bash
set -euo pipefail
cd gate-site
mkdir -p .tmp
test -f .tmp/media-domain.json
node - <<'NODE'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');

function parseJsonc(source) {
  let uncommented = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) {
      uncommented += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      uncommented += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index++;
      if (index < source.length) uncommented += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length &&
             !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') uncommented += '\n';
        index++;
      }
      if (index >= source.length) throw new Error('unclosed JSONC comment');
      index++;
      continue;
    }
    uncommented += char;
  }

  let json = '';
  inString = false;
  escaped = false;
  for (let index = 0; index < uncommented.length; index++) {
    const char = uncommented[index];
    if (inString) {
      json += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      json += char;
      continue;
    }
    if (char === ',') {
      let next = index + 1;
      while (/\s/.test(uncommented[next] ?? '')) next++;
      if (uncommented[next] === '}' || uncommented[next] === ']') continue;
    }
    json += char;
  }
  return JSON.parse(json);
}

function validHostname(value) {
  return typeof value === 'string' && value.length <= 253 &&
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);
}

const ledger = JSON.parse(readFileSync('.mallok/create-state.json', 'utf8'));
const media = JSON.parse(readFileSync('.tmp/media-domain.json', 'utf8'));
const config = parseJsonc(readFileSync('wrangler.jsonc', 'utf8'));
const resources = [ledger.worker, ledger.database, ledger.bucket];
if (typeof ledger.slug !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(ledger.slug) ||
    ledger.slug.startsWith('mallok-') || !validHostname(ledger.domain) ||
    typeof ledger.accountId !== 'string' || ledger.accountId === '' ||
    resources.some(r => r === null || typeof r !== 'object' ||
      typeof r.name !== 'string' || r.name === '') ||
    typeof ledger.database.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ledger.database.id) ||
    media === null || typeof media !== 'object' ||
    media.bucket !== ledger.bucket.name || !validHostname(media.domain)) {
  throw new Error('the create ledger lacks the resource identities destroy must verify');
}
const expectedNames = {
  worker: `mallok-${ledger.slug}`,
  database: `mallok-${ledger.slug}-db`,
  bucket: `mallok-${ledger.slug}-media`,
};
const database = Array.isArray(config.d1_databases)
  ? config.d1_databases.find(item => item?.binding === 'DB')
  : undefined;
const bucket = Array.isArray(config.r2_buckets)
  ? config.r2_buckets.find(item => item?.binding === 'MEDIA')
  : undefined;
const routeMatches = Array.isArray(config.routes) && config.routes.some(route =>
  route !== null && typeof route === 'object' &&
  route.pattern === ledger.domain && route.custom_domain === true);
if (ledger.worker.name !== expectedNames.worker ||
    ledger.database.name !== expectedNames.database ||
    ledger.bucket.name !== expectedNames.bucket ||
    config.name !== expectedNames.worker ||
    (config.account_id !== undefined && config.account_id !== ledger.accountId) ||
    database?.database_name !== expectedNames.database ||
    database?.database_id !== ledger.database.id ||
    bucket?.bucket_name !== expectedNames.bucket ||
    config.vars?.MALLOK_SITE !== ledger.slug ||
    config.vars?.MALLOK_DOMAIN !== ledger.domain || !routeMatches) {
  throw new Error('ledger, slug and wrangler.jsonc identify different resources');
}
const target = {
  accountId: ledger.accountId,
  slug: ledger.slug,
  worker: expectedNames.worker,
  database: expectedNames.database,
  databaseId: ledger.database.id,
  bucket: expectedNames.bucket,
  domain: ledger.domain,
  mediaDomain: media.domain,
};
const file = '.tmp/destroy-target.json';
if (existsSync(file)) {
  const recorded = JSON.parse(readFileSync(file, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(target)) {
    throw new Error('the ledger identity changed after the destroy target was recorded');
  }
} else {
  writeFileSync(file, `${JSON.stringify(target)}\n`, { flag: 'wx' });
}
NODE
TARGET_SLUG=$(node -p "require('./.tmp/destroy-target.json').slug")
CLOUDFLARE_ACCOUNT_ID=$(node -p "require('./.tmp/destroy-target.json').accountId")
export CLOUDFLARE_ACCOUNT_ID
./node_modules/.bin/mallok destroy "$TARGET_SLUG" --confirm "$TARGET_SLUG"
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

Bucket cleanup is therefore manual, and happens before a successful destroy:

- if the refusal says a custom domain is attached, inspect it with the exact
  `wrangler r2 bucket domain list ...` command printed by `destroy`, detach it
  with the printed `domain remove` command, and rerun;
- if the refusal says the bucket is not empty, remove the objects from the R2
  dashboard (Buckets → the bucket → Objects → select all → delete), then
  rerun.

The ledger keeps the completed steps, so every rerun resumes safely.

Then, by hand, because no Wrangler command does them:

| Resource | Where |
| --- | --- |
| Worker custom domain (the ledger's `domain`) | Workers → the Worker → Settings → Domains & Routes |
| DNS records the wizard wrote | DNS → the zone |
| Turnstile widget | Turnstile → the widget |
| `CF_API_TOKEN` created for purging | My Profile → API Tokens |

The Deploy-button row that used to end this table is gone with §15.1: that
path is `NOT_AVAILABLE` in 0.1, so it provisions nothing to clean up.

**Pass, checked rather than assumed:**

```bash
set -euo pipefail
test -f .tmp/destroy-target.json
CLOUDFLARE_ACCOUNT_ID=$(node -p "require('./.tmp/destroy-target.json').accountId")
export CLOUDFLARE_ACCOUNT_ID
WORKER_NAME=$(node -p "require('./.tmp/destroy-target.json').worker")
DATABASE_NAME=$(node -p "require('./.tmp/destroy-target.json').database")
BUCKET_NAME=$(node -p "require('./.tmp/destroy-target.json').bucket")
SITE_DOMAIN=$(node -p "require('./.tmp/destroy-target.json').domain")
MEDIA_DOMAIN=$(node -p "require('./.tmp/destroy-target.json').mediaDomain")

# A failed probe proves absence only when the locked Wrangler reports the
# resource-specific absence contract. Authentication, permission, network and
# generic 404 errors must fail this postcondition.
assert_resource_absent() {
  expected=$1
  shift
  error_file=$(mktemp)
  if "$@" >"$error_file" 2>&1; then
    echo "resource still exists: $*" >&2
    return 1
  fi
  node - "$expected" "$error_file" <<'NODE'
const { readFileSync } = require('node:fs');
const [expected, file] = process.argv.slice(2);
const plain = readFileSync(file, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
const errors = plain.split('\n').filter((line) => line.includes('[ERROR]'));
if (errors.length !== 1 || !errors[0].includes(expected)) {
  process.stderr.write(`Unexpected Wrangler failure:\n${plain}`);
  process.exit(1);
}
NODE
}

assert_resource_absent '[code: 10007]' \
  ./node_modules/.bin/wrangler deployments list \
  --name "$WORKER_NAME" --json
assert_resource_absent "Couldn't find a D1 DB named" \
  ./node_modules/.bin/wrangler d1 info "$DATABASE_NAME" --json
assert_resource_absent 'The specified bucket does not exist.' \
  ./node_modules/.bin/wrangler r2 bucket info \
  "$BUCKET_NAME" --json

assert_dns_absent() {
  host=$1
  for record_type in A AAAA CNAME; do
    dns_result=$(dig +noall +comments +answer "$host" "$record_type")
    dns_status=$(printf '%s\n' "$dns_result" \
      | awk -F'status: |,' '/status:/ { print $2; exit }')
    case "$dns_status" in
      NOERROR|NXDOMAIN) ;;
      *) echo "DNS $record_type lookup failed for $host: $dns_status" >&2; return 1 ;;
    esac
    dns_answers=$(printf '%s\n' "$dns_result" | awk '!/^;/ && NF')
    [ -z "$dns_answers" ] \
      || { echo "$host still has $record_type records: $dns_answers" >&2; return 1; }
  done
}
assert_dns_absent "$SITE_DOMAIN"
assert_dns_absent "$MEDIA_DOMAIN"
```

Every probe must match its resource-specific absence contract; a merely
non-zero exit is insufficient. The A, AAAA and CNAME queries for both hostnames
must all return no answers.

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
| Tarball name, size, unpackedSize, npm integrity, shasum, sha256 and sourceCommit | The release issue, from §4, re-checked at §5 |
| Lighthouse min/median per category | `pnpm lighthouse:gate` output, §14 |
| CPU/latency distribution (path; cold and warm CPU n/p50/p95/max; cold and warm latency n/p50/p95/max) | `docs/tasks/TASK-01.md §5`, §11 |
| The setup key `create` delivered to the interactive terminal | Nowhere. It is absent from the result, JSON and files, and is used once by the wizard |

A criterion moves to `VERIFIED_STAGING` only with a command, its output, and a
date. "Looked fine" is not evidence, and a local `workerd` run is not an edge
run.
