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
| Admin components | `@testing-library/preact` + `happy-dom` | Node | The form generator, the editor, media upload |
| End to end | `playwright` | A browser plus `wrangler dev` | The wizard, the publish loop, inquiry submission |
| Accessibility | `@axe-core/playwright` | As above | The admin and the official themes |
| Performance | `@lhci/cli` | A custom domain | The gate in `SEO_PERFORMANCE.md §7` |

The tool choices come from `TECH_STACK §10` and are not re-argued here.

**Worker integration tests must run in real workerd.** Simulating Cloudflare
globals in Node is not accepted — it cannot exercise the real semantics of
`caches.default`, a D1 batch, or the rate-limit binding.

## 3. The current baseline

Established and passing since Task 01:

```
6 test files, 44 tests
  test/core/fragment.test.ts      stage-one rendering, sanitisation, cache keys
  test/core/frontmatter.test.ts   YAML splitting and its errors
  test/core/hash.test.ts          sha256 and stable serialisation
  test/core/liquid.test.ts        the restricted template engine, escaping, the raw filter
  test/core/paths.test.ts         building and parsing public paths
  test/worker/flow.test.ts        inside workerd: concurrent startup, cache hit/miss,
                                  publish-then-render, drafts and scheduling, redirects,
                                  sanitisation, error hygiene, the spike probes
```

The command is `pnpm test`, with exit code 0.

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

| Directory | Line coverage | Branch coverage |
| --- | --- | --- |
| `src/core/` | ≥ 90% | ≥ 85% |
| `src/db/` | ≥ 90% | ≥ 85% |
| `src/worker/` | ≥ 85% | ≥ 80% |
| `src/plugins/` | ≥ 85% | ≥ 80% |
| `src/admin/` | ≥ 75% | ≥ 70% |
| `src/cli/` | ≥ 80% | ≥ 75% |

Branch coverage in the four modules covering sanitisation, path resolution,
authentication and encryption is **≥ 90%**, with no exceptions.

Coverage is a floor, not a goal. Bad tests at 90% coverage are still bad
tests.

## 6. The evidence format

Every acceptance criterion in a completion report carries copyable evidence:

```
AC-XX-YY  one sentence saying what is being accepted
  Implementation  src/worker/public.ts:42  handlePublic()
  Test            test/worker/flow.test.ts:118  "serves a cache HIT on the second request"
  Command         pnpm test
  Exit code       0
  Environment     Node 22.22.2 / workerd (vitest-pool-workers 0.22.0) / macOS 24.6.0
```

Only seven statuses are permitted, and **wording such as "should pass" is
not**:

| Status | Meaning |
| --- | --- |
| `NOT_AVAILABLE` | There is no testable implementation yet |
| `NOT_RUN` | An implementation and a test exist, but were not run this time |
| `FAILED` | It ran and failed |
| `VERIFIED_LOCAL` | It passes locally, with a command and an exit code |
| `VERIFIED_STAGING` | It passes on a real Cloudflare account |
| `VERIFIED_HUMAN` | It requires human judgement, such as "the email really arrived" |
| `ACCEPTED` | The product owner has confirmed it |

**A conclusion about platform behaviour can only be `VERIFIED_STAGING` or
`VERIFIED_HUMAN`** — the Cache API working under local `wrangler dev` says
nothing about `.workers.dev` (`ARCHITECTURE §18`, item 1).

## 7. What needs a real account

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

## 8. Test data

- Fixed corpora live in `test/fixtures/`, including a set of genuine
  foreign-trade content — several products, categories and news items.
- Hostile corpora live separately in `test/fixtures/hostile/`; the list is in
  `SECURITY.md §14`.
- **Never snapshot randomly generated content** — a snapshot has to be stable.
- Time is always injected; `Date.now()` is never called.

## 9. CI

Everything must be green before a change is done (`docs/CONVENTIONS.md`):

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size
```

End-to-end and Lighthouse need a browser and a custom domain, so they stay out
of that chain, run separately, and their evidence goes in the task report.

## 10. Deliberately not done

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
