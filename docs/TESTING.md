# The Mallok testing strategy

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: defines the test layers, each layer's tools and responsibilities,
  the coverage gate and the evidence requirements. **"It passed" is not
  evidence; a command and an exit code are.**

## 1. Principles

1. **Test behaviour, not implementation.** Assert against the public contract
   — HTTP responses, rendered HTML, exported files — not how many times a
   private function was called.
2. **The contract is in the documentation; the tests are its executable
   form.** Every hard rule — `CONTENT_FORMAT §9`, the four rules that do not
   bend in `ARCHITECTURE §5` — has a corresponding test.
3. **A test that cannot be reproduced is not a test.** Rendering is
   deterministic, so snapshots are usable; anything depending on time,
   randomness or the network must have it injected explicitly.
4. **The fact discipline in `docs/CONVENTIONS.md` applies to tests too**:
   platform behaviour is either measured or marked unverified, never assumed.

## 2. The layers

| Layer | Tool | Runs in | Covers |
| --- | --- | --- | --- |
| Unit | `vitest` | Node | `src/core/`'s pure functions, `src/db/`'s SQL construction |
| Property and hostile input | `fast-check` | Node | Sanitisation, path normalisation, front-matter parsing |
| Worker integration | `@cloudflare/vitest-pool-workers` | **Real workerd** | Routing, caching, migration, the management API, plugin routes |
| Admin components | `@testing-library/react` + `happy-dom` | Node | The form generator, the editor, media upload |
| End to end | `playwright` | A browser plus `wrangler dev` | The wizard, the publish loop, inquiry submission |
| Accessibility | `@axe-core/playwright` | As above | The admin and the official themes |
| Performance | `@lhci/cli` | A custom domain | The gate in `SEO_PERFORMANCE.md §7` |

The tool choices come from `TECH_STACK §10` and are not re-argued here.

**Worker integration tests must run in real workerd.** Simulating Cloudflare
globals in Node is not accepted — it cannot exercise the real semantics of
`caches.default`, a D1 batch, or the rate-limit binding.

## 3. The current baseline

`pnpm test` runs eight Vitest projects, and what it must do is exit 0. The
count of files and tests is deliberately **not** written here: that number
starts drifting the day it is typed, and the command prints the current one.

```
  core               Node       src/core, src/admin, src/cli
  worker             workerd    routing, cache, migration, the management API, plugins
  worker-setup-key   workerd    the wizard with a one-time key bound
  worker-unclaimable workerd    a site between its first deploy and its secrets
  runtime            Node       the runtime's router, lifecycle and cache semantics
  runtime-workerd    workerd    the same runtime inside the real platform
  runtime-dom        happy-dom  island mounting
  runtime-build      Node       the Vite plugin and the island manifest
```

The two extra worker projects exist because a **binding** is what they differ
in: `worker-setup-key` binds a key, and `worker-unclaimable` binds **nothing**
— which is the point, because refusing a keyless setup is the default rather
than something a configuration requests. The ordinary `worker` project binds
`MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY`, since its tests bootstrap an
administrator through the wizard and there is no `mallok create` behind
`wrangler dev` to mint a secret. Binding a key for every worker test would
make them all exercise the same path instead of the ones they are about.

None of these projects reads `wrangler.jsonc`, and that is deliberate: the
pool loads the `.dev.vars` beside it, so every worker test used to run with
whatever secret happened to be on the developer's laptop — green on one
machine, red on another, and green *because* of a value the repository does
not contain. `vitest.config.ts` declares the whole environment instead, and
`test/worker/environment-isolation.test.ts` is the tripwire.

`pnpm test:release` is a ninth project, run separately because it is minutes
rather than seconds: it builds two real tarballs, serves them from a local
registry, creates a project on the first and upgrades it to the second — the
only test that exercises what `npm install` actually does to a site.

`pnpm test:coverage` runs the Node projects again with coverage and
enforces §5.

**What a passing run writes to stderr.** Two lines from `mallok destroy`'s
refusal tests, which are the CLI warning exactly as it should, and one Node
deprecation warning — `DEP0040`, the `punycode` builtin — emitted by
**Wrangler's own bundled CLI**, which `@cloudflare/vitest-pool-workers` loads.
It is not Mallok's code and cannot be silenced without patching Wrangler.
Anything else is a defect: the CLI tests pass a **quiet** reporter, because a
few hundred lines of "Creating database…" made a real warning invisible and
turned "is stderr clean?" into a question nobody could answer by looking.

## 4. Contracts that must have tests

These are not "recommended coverage" — **failing one means the work is not
done**:

### 4.1 Render determinism (`ARCHITECTURE §5`)

- The same Markdown, pipeline version and theme version produce
  **byte-identical HTML**.
- Render functions read no clock, no random source and nothing about the
  request.
- `beforeRender` hooks are pure.
- Rendering the same input 100 times in a row produces identical output every
  time.

### 4.2 Import/export round trips (`CONTENT_FORMAT §9`)

Each of the seven assertions maps to one test:

1. Export → import into an empty site → export: every `index*.md`, `images/`
   and `files/` is byte-identical, and `id`, `translation_group` and
   `created_at` are unchanged.
2. A hand-written bundle → import → export: `index*.md` is byte-identical.
3. Alias front matter (Astro or Hugo shaped): the derivation is correct and
   the source is unchanged.
4. Two bundles each with a different `images/cover.jpg`: both render correctly
   and both are restored correctly.
5. A bundle referencing a missing file: the import succeeds, the state is
   visible, and the export preserves the reference.
6. Re-importing an unmodified bundle: **no D1 write and no cache purge**.
7. Hostile input: rejected or sanitised per the rules, without crashing and
   without leaking.

### 4.3 Cache correctness (`ARCHITECTURE §6`)

- The first request is a `MISS`, the second a `HIT`.
- Drafts and scheduled content whose time has not come are **never written to
  the cache**.
- Everything under `/_mallok/*` is `private, no-store`.
- The affected tags are purged after a save.
- The fragment cache key covers every input: changing the assets, the media
  hostname or a plugin's settings each invalidates it.

### 4.4 Security (`SECURITY.md`)

- Sanitisation removes `<script>`, `on*` and `javascript:`.
- Relative paths reject `..`, absolute paths and protocol-relative paths.
- Error responses contain no SQL, bucket name, database id or stack trace.
- An unauthenticated request gets a 401, and the timing of a 401 versus a 404
  does not reveal whether a resource exists.
- A secret never appears in a response body or a log.

### 4.5 Migration (`DATA_MODEL §2.10`)

- Concurrent cold starts apply a migration exactly once, and the lock is
  eventually released.
- Migrations are additive only.
- A failed migration does not take the site down.

### 4.6 The D1 budget (`DATA_MODEL §3`)

- A single-page cold render issues **at most 4 D1 round trips**
  (`ARCHITECTURE §4`, `AC-INV-05` — corrected 2026-09-02 from "one batch",
  which a page with both media and related content cannot meet by
  construction).
- A list page **does not query `render_cache` and does not read `markdown`**.
- Pagination **does not run `COUNT(*)`**.

These three are asserted by counting queries, not by human review.

## 5. The coverage gate

`pnpm test:coverage` runs the Node projects with V8 coverage and **fails the
run** when a directory drops below its floor. The floors are the numbers the
suite actually reaches today, so the gate's job is to catch a regression:

| Directory | Line coverage | Branch coverage | Measured 2026-09-10 |
| --- | --- | --- | --- |
| `src/core/` | ≥ 90% | ≥ 82% | 91.3 / 82.5 |
| `src/cli/` | ≥ 83% | ≥ 72% | 84.4 / 73.3 |
| `src/runtime/` | ≥ 88% | ≥ 85% | 89.4 / 85.9 |

### What the gate cannot measure

**`src/worker/`, `src/db/` and `src/plugins/` are not in the table**, and the
earlier version of this section was wrong to give them thresholds: those
directories run inside **workerd**, under `@cloudflare/vitest-pool-workers`,
and V8 coverage cannot instrument code executing there. Asking for it produces
55 unhandled errors and reports 0% for every file, which is worse than no
number at all — a gate that counts thoroughly tested code as uncovered teaches
everyone to ignore the gate.

They are not untested. `test/worker/**` is the largest suite in the
repository and runs in real workerd, which is the stricter requirement of the
two (§2). What is missing is an automatic *number*, and pretending otherwise
in this document was the actual defect.

Two more honest limits inside the measured directories:

- `src/cli/index.ts` sits around 41% because the parts below it — `mallok
  build`, `mallok media push`, `prepare` and `upgrade`'s wiring — are covered
  by running the **installed binary as a subprocess**
  (`test/cli/package-release.test.ts`, `test/cli/upgrade.test.ts`), and a
  subprocess reports no coverage to the parent. That is the right test for a
  published package; the number is the price.
- `src/admin/` has no threshold. Its components are exercised through
  `test/admin/**`, but the coverage that matters for the admin is the
  end-to-end and axe run in §7, not a line count.

Coverage is a floor, not a goal. Bad tests at 90% coverage are still bad
tests.

## 6. The evidence format

Every acceptance criterion in a completion report carries copyable evidence:

```
AC-XX-YY  one sentence saying what is being accepted
  Implementation  src/worker/pages/runtime.ts:78  handlePublicPage()
  Test            test/worker/flow.test.ts:118  "serves a cache HIT on the second request"
  Command         pnpm test
  Exit code       0
  Environment     Node 22.22.2 / workerd (vitest-pool-workers 0.22.0) / macOS 24.6.0
```

Only seven statuses are permitted, and **wording such as "should pass" is
not**:

**This table is the project's only status vocabulary.** `docs/ACCEPTANCE.md`
and `docs/RELEASE_GATE.md` use these words and no others; each of them used to
invent its own, so the same row could be "verified" in three senses.

| Status | Meaning |
| --- | --- |
| `NOT_AVAILABLE` | There is no testable implementation yet |
| `NOT_RUN` | An implementation and a test exist, but were not run this time |
| `FAILED` | It ran and failed |
| `VERIFIED_LOCAL` | It passes locally, with a command and an exit code |
| `VERIFIED_STAGING` | It passes on a real Cloudflare account |
| `VERIFIED_HUMAN` | It requires human judgement, such as "the email really arrived" |
| `STALE` | It passed once, against code that has since been replaced |
| `ACCEPTED` | The product owner has confirmed it |

`STALE` is the one added in 0.1.0-rc.3, and it exists because the alternative
is worse. Five rows were `VERIFIED_HUMAN` from Gate A — run for real against
the previous `mallok create`, the previous Worker composition and a package
laid out differently. Leaving them green would mean a release claiming
real-account evidence for code that no longer exists; deleting them would
throw away the knowledge that the run happened and what it found. `STALE`
says both: it was true, and it is not evidence for this release.

**A conclusion about platform behaviour can only be `VERIFIED_STAGING` or
`VERIFIED_HUMAN`** — the Cache API working under local `wrangler dev` says
nothing about `.workers.dev` (`ARCHITECTURE §18`, item 1).

## 7. The browser run

`pnpm test:e2e` drives a real `wrangler dev` — local D1 and R2, the same Worker
code a deployed site runs — through the flows that only exist end to end:

| Spec | What it walks |
| --- | --- |
| `01-wizard` | The first-run wizard, the starter install, and that setup cannot run twice |
| `02-login` | Sign-in, a refused password, the session boundary, sign-out |
| `03-publish` | Writing a page in the admin, publishing it, editing it, and a draft staying private |
| `04-public-pages` | List and detail pages, zero client JavaScript, the second language and hreflang, the SEO endpoints, a themed 404 |
| `05-accessibility` | axe on eight admin screens and on all five official themes |

`pnpm test:a11y` runs the wizard and the axe spec alone.

Three things about this run are worth knowing before changing it:

- **The specs are ordered and share one database.** `01` creates the
  administrator every later spec signs in as, so they run in file order with
  one worker. Running a single spec on its own starts from an empty database
  and will fail at the sign-in.
- **The state directory is deleted by the web-server command**, not by a
  global setup: Playwright starts the server before global setup runs, so
  deleting it afterwards pulled the SQLite file out from under a wrangler that
  had already migrated it.
- **The accessibility gate is "no serious or critical".** Moderate and minor
  findings are printed and do not fail the run. The five themes are scanned
  from a real `mallok build` of this repository's content, one build per
  theme, served over HTTP so the stylesheets load — only one theme can be
  compiled into a Worker at a time (`ACTIVE_THEME`), so there is no other way
  to scan all five.

The browser is not installed by `pnpm install`. Once per machine:
`npx playwright install chromium`.

## 8. The history scan

`pnpm scan:secrets` reads **every blob reachable from any ref** — not the
working tree, which says nothing about what a public repository would carry —
and matches credential *shapes*: private-key blocks, provider key formats,
JWTs, and long literals assigned to a name like `MALLOK_SECRET`.

It never prints a suspected value. Echoing a match copies the secret into a
terminal, a CI log and whatever screenshot follows; the report gives the path,
the line and the rule, which is enough to go and look. Findings a person has
reviewed are listed in the script with their reason and still appear in the
output — they just do not fail the run.

## 9. What needs a real account

The things no tool replaces (`TECH_STACK §10`):

| Item | How |
| --- | --- |
| Worker CPU time, save requests included | Workers Logs, or `wrangler tail --format=json` |
| Bundle size | `pnpm bundle:size` plus wrangler's Total Upload |
| Cache hit rate and purge latency | Timed against a real account |
| All three deployment paths | Walk each one |
| One real inquiry email, sent and received | Confirm the inbox by hand |

`TASK-01 §4` is the first batch of these, with the conclusions written back
into `ARCHITECTURE §18`.

## 10. Test data

- Fixed corpora live in `test/fixtures/`, including a set of genuine
  foreign-trade content — several products, categories and news items.
- Hostile corpora live separately in `test/fixtures/hostile/`; the list is in
  `SECURITY.md §14`.
- **Never snapshot randomly generated content** — a snapshot has to be stable.
- Time is always injected; `Date.now()` is never called.

## 11. CI

Everything must be green before a change is done (`docs/CONVENTIONS.md`):

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size
```

`pnpm test:coverage` runs the enforced floors of §5. It is a separate command
because it re-runs the Node projects on their own; `pnpm test` runs all six
projects, workerd included.

The full local gate, in the order worth running it:

```sh
set -euo pipefail
pnpm lint && pnpm typecheck && pnpm test && pnpm test:release \
  && pnpm build && pnpm bundle:size && pnpm admin:size \
  && pnpm build:site \
  && pnpm test:coverage && pnpm test:e2e && pnpm scan:secrets
```

`pnpm test:e2e` needs a browser (`npx playwright install chromium`, once).
Lighthouse still needs a custom domain, so it stays out of the chain; its
thresholds are asserted by `pnpm lighthouse:gate` over the reports `lhci`
writes, and that script's own behaviour is covered by
`test/cli/lighthouse-gate.test.ts`.

`.github/workflows/release.yml` runs this same list in one sequential job on a
tag. `ci.yml` may split it across jobs and leave the slow half to a separate
one; a release candidate may not.

## 12. Deliberately not done

- No mutation testing.
- No visual regression testing; screenshot comparison is too noisy across
  platforms.
- No pursuit of 100% coverage outside `src/core/`.
- No tests written only to raise a coverage number without asserting
  behaviour.
- No test connects to a real Resend or Turnstile. The HTTP layer is stubbed,
  and real calls belong to the `VERIFIED_HUMAN` category.
  How it is done (measured 2026-08-29): from `@cloudflare/vitest-pool-workers`
  0.22 onward, `cloudflare:test` no longer exports `fetchMock`, and the
  official migration guidance is to mock `globalThis.fetch` directly or move
  to MSW. This repository does the former — `SELF` shares an isolate with the
  test, so the Worker's subrequests hit the stub — which avoids adding a
  dependency.
