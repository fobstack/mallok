# Task 17 — Acceptance closeout

- Status: **partially complete — and it cannot be finished from here.**
  The evidence review is done; three things it depends on need the product
  owner.
- Date: 2026-08-30
- Scope: an evidenced status for every acceptance criterion, the D1 budget
  measurement, and the decisions the review surfaced.
- Contract: `docs/ACCEPTANCE.md`.
- **Correction, 2026-09-01**: this document said "all 76 acceptance criteria".
  There were never 76 — counting the unique `AC-` identifiers gives 67, as does
  summing the per-group table. The task also left the count unverifiable:
  statuses were recorded for the `AC-INV` group only, so the totals were
  maintained by hand and drifted into three mutually contradictory figures.
  `ACCEPTANCE.md §14.0` records the reconciliation; every criterion now carries
  a status and a `file:line` pointer, and the totals are counted from those.

## 1. What this task produced

`ACCEPTANCE.md §14` — a line-by-line status with **evidence**, where evidence
means a re-runnable test file, a reproducible manual step, or the words "there
is none".

The result:

| Status | Count |
| --- | --- |
| `VERIFIED_LOCAL` | 48 |
| `NOT_AVAILABLE` | 28 |
| `VERIFIED_HUMAN` | **0** |

The last row is the important one. **Nothing has ever run against a real
Cloudflare account.** Every "verified locally" means workerd's simulation or
`wrangler dev`. Twenty of the 28 unavailable criteria are blocked on exactly
that (`ACCEPTANCE.md §14.4`).

## 2. The one measurement worth doing here

`AC-INV-05` asks for "one D1 batch, at most 3 queries" per cold render. Rather
than reason about it, `test/worker/budget.test.ts` wraps the D1 binding and
counts round trips:

| Page | D1 calls |
| --- | --- |
| Plain article, no media, no relations | **2** — `batch(5)` + `batch(1)` |
| Product with a category reference, siblings and an image reference | **2** — `batch(5)` + `batch(3)` |

Up to 4 when the content has resolved media and the related items have covers.

I had assumed from reading the code that it was worse; measuring showed it is
not. The literal wording is still unmet — it is two batches, not one — and it
**cannot** be one: relations and media both depend on the content row that the
first batch returns, so the second round trip is a data dependency, not
sloppiness. §14.2 proposes the amended wording and leaves the decision where
it belongs.

## 3. What I did not do, and why

**`src/worker/spike.ts` was not deleted**, though this task asks for it. It is
the instrument for the nine measurements in `TASK-01 §4`, and those have not
been taken. Removing the measuring device before the measurement is backwards.
It should go once gate A is closed.

**No Lighthouse or axe run.** `SEO_PERFORMANCE §12` requires Lighthouse on a
custom domain with a warm cache, which needs a real deployment. axe needs a
browser test harness that no task has set up. Three SEO criteria and the
admin's accessibility gate stay `NOT_AVAILABLE` rather than being claimed.

**No English translation of `docs/`.** `CONTRIBUTING.md` asks for it. It is
several thousand lines of design documentation and a mechanical translation
would be worse than none; it needs its own task.

## 4. Three decisions waiting on the product owner

Beyond the six already listed in `ACCEPTANCE.md §12`:

1. **`AC-INV-05`'s wording** — amend to "≤ 4 D1 round trips, constant query
   count, bounded row reads" and record the measured numbers in
   `ARCHITECTURE §4`, or require the code to change. It is an architecture
   invariant, so it is not mine to rewrite.
2. **`AC-DEPLOY-03` says the wizard is seven steps; it is four.** The media
   domain and the Resend/DNS steps need an account-scoped Cloudflare API
   token (Task 16's unfinished part). Both are reachable from Settings, so
   nothing is unreachable — but the criterion and the code disagree.
3. **`ARCHITECTURE §13`'s inquiry chain still lists the submission-timing
   check**, which `TASK-08.md §4` explains cannot work with an edge-cached
   form. Ratify the deviation or ask for a different anti-spam measure.

## 5. Gaps closed after the review

The inventory was written first, then four of its `NOT_AVAILABLE` rows were
closed rather than left as future work:

| Criterion | What was missing | What was done |
| --- | --- | --- |
| `AC-EXPORT-01` | The site export had no `inquiries.csv`, and the admin had no export button | Plugins can now contribute files to an export (`exportFiles`), the inquiry plugin ships its CSV, and Settings → Advanced builds the zip in the browser from the same manifest the CLI reads |
| `AC-EXPORT-04` | Asserted nowhere | A test proves the manifest carries no secret, session, `render_cache` or plugin key |
| `AC-CLI-03` | `mallok preview` was written but not routed | Wired with `--theme`; it loads a theme off disk and renders with no network |
| `AC-CLI-04` | `--create-only` was parsed and ignored | Enforced on the server: an existing item returns 409 and is not overwritten |

A second pass closed four more contract requirements that had no acceptance
id of their own but were named in `ADMIN.md`:

| Requirement | What was done |
| --- | --- |
| `ADMIN.md §11` — "clear all caches" and "clear the fragment cache" | Both built, with wording that separates them: the edge cache holds pages, `render_cache` holds fragments, and neither loses anything because both are derived. A test empties all fragments and proves every page still renders. |
| `ADMIN.md §6.4` — a marker on the offending line | The editor now decorates each line that references a missing file, alongside the existing "N images missing" count. |
| `ADMIN.md §8` — drag and drop | The drop zone accepts a real drop, not just a click. |
| Media alt text | Editable in the library. Alt travels with the file, so an image used in three places is described once. |

**And one thing the browser caught that reading could not:** the editor's
preview was rendering **unstyled**. A `sandbox=""` srcdoc iframe has an opaque
origin and fetched nothing — the server log showed zero requests for the
theme's stylesheet. Adding a `<base>` did not help. The fix is
`sandbox="allow-same-origin"` **without** `allow-scripts`: that combination
lets the frame load the stylesheet while script execution stays forbidden,
which is the attack the sandbox exists to stop. Granting both together would
be the dangerous pairing. A preview that does not look like the site
undermines the one reason §6.3 exists.

A third pass added the last two things that could be built without a real
account:

| Item | What was done |
| --- | --- |
| Tag archives | `tags` was a stored field with nowhere to go. `/tags/<tag>` (and `/<locale>/tags/<tag>`) now lists **across kinds** using SQLite's `json_each`, which was verified to work on D1 before the query was written. A tag nobody uses returns 404 rather than producing a thin page for every string. Themes link tags from article pages. |
| `AC-DEPLOY-02` — the Deploy button | The README carries the button, and `package.json` declares `cloudflare.bindings` descriptions for `MALLOK_SECRET`, `CF_API_TOKEN` and `CF_ZONE_ID`. |
| `--verbose` / `--dry-run` | Verbose prints each request with its status and timing (never the token). A dry run now **predicts** `unchanged` / `created` / `updated` by comparing against what the site holds, instead of labelling everything `updated`. |

**A documentation error corrected along the way.**
`CLOUDFLARE_RESOURCES.md §7` said the Deploy-button flow had no entry point
for setting a secret, and listed two workarounds as a spike item. Checking the
current official documentation showed that is wrong: `package.json` accepts a
`cloudflare.bindings` block whose Markdown descriptions the button shows while
prompting for each binding, and it auto-detects the `deploy` script. §7 now
records the correct behaviour with the original text kept beneath it. The
generated-secret fallback stays as a backstop for a user who skips the prompt,
and it never rotates an existing secret — rotating would sign everyone out and
make stored plugin keys undecryptable.

I also wrote and deleted a `deploy.json` in this pass. There is no such file:
the button is a URL pointing at a public repository, and I had invented the
shape from memory before checking. Recorded because the same reflex would
produce the same kind of plausible-looking, wrong artefact elsewhere.

A fourth pass closed the remaining items that did not need a real account:

| Item | What was done |
| --- | --- |
| "Test this key" for plugin secrets | A plugin declares `checkSecrets`, because the core cannot tell a good Resend key from a bad one. The inquiry plugin checks the Resend key against `GET /domains` (a read, so it sends nothing to anyone) and reports **the case that actually bites**: a valid key with no verified sending domain, which a trade site would otherwise discover on its first inquiry. The Turnstile secret is checked by the `invalid-input-secret` code. The stored value never leaves the Worker; only the verdict does, and a test asserts it. |
| `site.json` import | `mallok import --with-settings` applies an export's settings. Opt-in, because it overwrites navigation, kinds and theme options. It warns when the export was made with a different theme. |
| `--verbose` | Prints each request with status and timing, never the token. |
| `--dry-run` | Predicts `unchanged` / `created` / `updated` by comparing against what the site holds. |

Count after these passes: **56 `VERIFIED_LOCAL`, 20 `NOT_AVAILABLE`, 0
`VERIFIED_HUMAN`.** Every remaining `NOT_AVAILABLE` is blocked on a real
Cloudflare account or on a product-owner decision — there is nothing further
that can honestly be closed from here.

Two facts recorded while doing it:

- **`tags` is a stored field with nowhere to go.** It is documented in
  `CONTENT_FORMAT §3.1`, it is stored, and `categories` merges into it — but
  no theme displays it and there is no `/tags/<tag>` archive route. The
  documentation now says so instead of implying a feature exists.
- **`AC-CLI-03`'s "byte-identical" needs a qualifier**, added to §14.2:
  preview and the site run the same functions, but preview is offline and has
  no media table, so images stay relative paths. The body is identical; the
  media URLs are necessarily not.

## 6. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 32 files / 325 tests pass |
| `pnpm build` | pass |
| `pnpm bundle:size` | 229.2 KiB gzip = 7.5 % of the Free limit |
| `pnpm admin:size` | 15.6 KiB gzip first load |

## 7. What "done" would take

In order:

1. The product owner runs `TASK-01 §4` on a real account (gate A). That
   converts most of the 20 blocked criteria and settles the numbers in
   `ARCHITECTURE §18`.
2. The three decisions above, plus the six in `ACCEPTANCE.md §12` — of which
   the licence and the repository are `FobStack`'s alone.
3. Lighthouse and axe, once there is a deployed site on a custom domain.
4. Delete `src/worker/spike.ts` and its route.
5. The English documentation set.
