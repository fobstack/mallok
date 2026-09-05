# Task 01 — Walking skeleton and platform spike

- Status: **code complete, awaiting real-account measurements**
- Scope: one demonstrable loop — publish Markdown through the API, see it on a
  public URL within seconds, serve repeat visits from the edge cache — plus
  the measurements listed in `docs/ARCHITECTURE.md §18`.
- Out of scope: admin UI, media upload, sessions/API tokens, plugins, CLI,
  multi-locale UI, the `trade` theme and starter. Everything here is the
  minimum needed to answer the open platform questions honestly.

## 1. What is implemented

| Area | Files | Notes |
| --- | --- | --- |
| Rendering core | `src/core/*` | Front matter, stage-one fragment (remark → rehype-sanitize → asset resolution), restricted Liquid engine, theme manifest, public path rules. Pure JS; type-checked against `lib.webworker` only, no Cloudflare or Node types. |
| Database | `src/db/*` | Full 0.1 schema (`0001_init.sql`), runtime self-migration with a lock row, hand-written queries. One D1 batch per cold render. |
| Worker | `src/worker/*` | Public path with Cache API + `Cache-Tag`, purge-by-tag client with 2 s coalescing, minimal management API, `/media/*` R2 proxy, cron handler for scheduled publishing, spike endpoints. |
| Theme | `src/themes/journal` | Zero-JS theme seeded into D1 on first boot. |
| Tests | `test/core`, `test/worker` | 72 tests: unit tests in Node for the core pipeline, integration tests inside workerd for the request path (boot concurrency, cache hit/miss, publish → render, drafts/scheduled, redirects, sanitization, error hygiene, spike probes) and for authentication (Task 02). |
| Benchmarks | `scripts/*.mjs` | Fragment CPU curve, PBKDF2 curve, bundle size. |

Run everything locally:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm bundle:size
pnpm bench:fragment
pnpm bench:pbkdf2
cp .dev.vars.example .dev.vars   # then edit MALLOK_SECRET
pnpm dev                          # http://127.0.0.1:8787
```

Publish something against the dev server. Since Task 02 the management API
uses real credentials, so first create the administrator, sign in and mint a
scoped token; only `/_mallok/spike/*` still accepts `MALLOK_SECRET`.

```sh
BASE=http://127.0.0.1:8787
EMAIL=owner@example.com
PASSWORD='a sufficiently long password'

# One-off: create the single administrator. Returns 409 once one exists.
curl -s -X POST "$BASE/_mallok/api/auth/bootstrap" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"

# Sign in: keep the cookie jar and the CSRF token the body returns.
CSRF=$(curl -s -c /tmp/mallok-cookies -X POST "$BASE/_mallok/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["csrf"])')

# Mint a token for the command line. The plaintext is shown exactly once.
TOKEN=$(curl -s -b /tmp/mallok-cookies -X POST "$BASE/_mallok/api/tokens" \
  -H "x-mallok-csrf: $CSRF" -H 'content-type: application/json' \
  -d '{"name":"spike","scopes":["content:write","settings:write"]}' | \
  python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
echo "TOKEN=$TOKEN"
```

```sh
curl -X POST "$BASE/_mallok/api/content" \
  -H "authorization: Bearer $SPIKE_SECRET" \
  -H 'content-type: application/json' \
  -d '{"kind":"article","markdown":"---\ntitle: Hello\ndate: 2026-08-28T00:00:00Z\n---\n\nIt **works**."}'
curl -i "$BASE/news/hello"
```

## 2. Deliberate spike shortcuts

These are not the 0.1 design and must not be mistaken for it:

1. ~~**Management API auth is `Authorization: Bearer <MALLOK_SECRET>`.**~~
   **Resolved in Task 02**: the management API now uses sessions with CSRF and
   scoped API tokens (`SECURITY.md §3`). `MALLOK_SECRET` still guards
   `/_mallok/spike/*` only, and that route group disappears with this task.
2. **No media upload.** `assets` in the API accepts hashes that must already
   exist in the `media` table; there is no way to put them there yet, so every
   image reference renders as "missing" (a normal state per
   `CONTENT_FORMAT.md §4`).
3. **Inline HTML in Markdown is stripped**, not sanitized-and-kept, because
   `rehype-raw` is not in the approved dependency list. Keeping it costs a
   parse5-based HTML parser in the bundle; decide with the Markdown engine
   question below.
4. **Theme CSS is inlined** into every page from `theme_file`; 0.1 serves
   theme assets from R2.
5. `/_mallok/spike/*` exists only for this task and is deleted once the
   results are written back.

## 3. Measurements already taken locally

Environment: Node 22.22 on the development container. Node's V8 is the same
engine workerd uses, so the *shape* of these curves transfers; absolute
numbers on Cloudflare must come from step 4.

### 3.1 Bundle size (§18 item 4)

```
worker bundle: 753.2 KiB raw, 198.8 KiB gzip   (minified, official theme included)
  of Free limit (3 MB):  6.5%
  of Paid limit (10 MB): 1.9%
```

Largest contributors (unminified): zod 545 KiB, yaml 200 KiB, liquidjs
159 KiB, the micromark/remark/rehype family ≈ 350 KiB combined. Comfortable
headroom for the admin API, plugins and the `trade` theme. `zod/mini` would
roughly halve the zod share if it is ever needed.

### 3.2 Stage-one fragment CPU (§18 item 2) — the important finding

`pnpm bench:fragment`, warm JIT, median of 15:

| Markdown | HTML | CPU (Node) |
| --- | --- | --- |
| 2 KB | 4 KB | 6.1 ms |
| 8 KB | 12 KB | 19.7 ms |
| 32 KB | 45 KB | 117 ms |
| 128 KB | 177 KB | 463 ms |
| 512 KB | 707 KB | 1.66 s |
| 1 MB | 1.4 MB | 3.78 s |

Cold first render of 2 KB in a fresh process (JIT warm-up included):
**≈ 60 ms CPU**.

The cost is linear at roughly **3.5 ms per KB** of Markdown, and a bare
`remark-parse` already accounts for about a third of it (the micromark state
machine is the bottleneck, not our plugins). For comparison, on the same
synthetic input:

| Engine | 8 KB | 32 KB | 128 KB |
| --- | --- | --- | --- |
| unified (current) | 19.7 ms | 117 ms | 463 ms |
| markdown-it 14 | 1.8 ms | 6.5 ms | 14 ms |
| marked 16 | 2.8 ms | 3.7 ms | 9.9 ms |

Consequences:

- The architecture decision to keep stage one **out of the visitor path** is
  confirmed as necessary, not just nice.
- On the Free plan (10 ms CPU per invocation) the **save request** itself is
  at risk for anything beyond a short article with the unified pipeline, and
  the cold-isolate JIT cost alone exceeds the budget. Real-account numbers
  decide, but the local data already points at `TECH_STACK.md §4`'s fallback:
  evaluate `markdown-it`. That trade changes the plugin hook surface (token
  stream instead of mdast) and how inline HTML is sanitized; it is an
  architecture decision for the product owner, not for this task.

### 3.3 PBKDF2 (§18 item 5)

`pnpm bench:pbkdf2`, WebCrypto in Node, median of 5:

| iterations | CPU |
| --- | --- |
| 50 000 | 7.8 ms |
| 100 000 | 15.4 ms |
| 200 000 | 28.6 ms |
| 600 000 | 88 ms |
| 1 000 000 | 143 ms |

If workerd is in the same range, a Free-plan login can afford roughly
50 000 iterations of PBKDF2-SHA256. That is below the OWASP 2023 guidance of
600 000, so the real-account number decides whether the admin login must be
documented as "Paid plan recommended" or protected differently.

### 3.4 Cache API and purge (§18 items 1 and 3)

Works in `wrangler dev` and in the workerd test pool (`cacheApiWorks: true`,
`HIT` on the second request). Says nothing about `.workers.dev` or the purge
API — that is what step 4 is for.

## 4. Real-account measurements (run on your Mac)

Prerequisites: a Cloudflare account, a domain whose DNS is on that account,
Node 22, `pnpm`. Nothing below is scripted yet; `mallok create` will do this
later.

### 4.1 Deploy

```sh
npx wrangler login
npx wrangler d1 create mallok-spike-db          # copy the database_id
npx wrangler r2 bucket create mallok-spike-media

mkdir -p .mallok/sites
cp wrangler.jsonc .mallok/sites/spike.jsonc
# edit .mallok/sites/spike.jsonc: name → mallok-spike, database_name/id, bucket_name
```

`.mallok/` is already in `.gitignore`, which the repository-root
`.mallok-spike.jsonc` of earlier drafts was not; the per-site config path also
matches `CLOUDFLARE_RESOURCES.md §5`.

Deploy first, then set the secret: `wrangler secret put` needs the Worker to
exist. Capture the secret in a variable before piping it, otherwise it is
consumed by the pipe and never seen; strip the trailing newline `openssl`
emits, because the bearer comparison is exact.

```sh
CONFIG=.mallok/sites/spike.jsonc
pnpm build
npx wrangler deploy -c "$CONFIG"

SPIKE_SECRET=$(openssl rand -base64 32 | tr -d '\n')
echo "SPIKE_SECRET=$SPIKE_SECRET"     # needed for every /_mallok/spike/* call
printf '%s' "$SPIKE_SECRET" | npx wrangler secret put MALLOK_SECRET -c "$CONFIG"
```

Then run the bootstrap/login/token sequence from section 1 against the
`.workers.dev` URL to obtain `$TOKEN`, and publish a few articles of different
sizes (2 KB, 8 KB, 32 KB). Keep both values: `$TOKEN` for the management API,
`$SPIKE_SECRET` for the spike probes.

### 4.2 Cache API on `.workers.dev` (§18 item 1)

```sh
curl -s https://mallok-spike.<account>.workers.dev/_mallok/spike/cache-probe -H "authorization: Bearer $SPIKE_SECRET"
curl -si https://mallok-spike.<account>.workers.dev/news/<slug> | grep -i x-mallok-cache   # twice
```

Record `cacheApiWorks` and whether the second request says `HIT`.

### 4.3 Bind a custom domain and repeat

Add to `.mallok/sites/spike.jsonc`:

```jsonc
"routes": [{ "pattern": "spike.<your-domain>", "custom_domain": true }]
```

Redeploy, wait for the certificate, repeat 4.2 against the custom domain.

### 4.4 CPU time (§18 item 2)

Workers Logs (dashboard → Workers → mallok-spike → Logs) show CPU time per
invocation. Trigger each of these several times and note the CPU time of the
**first** (cold) and a **warm** invocation:

```sh
# stage one at several sizes (save-time cost)
for kb in 2 8 32 128; do curl -s "https://spike.<domain>/_mallok/spike/fragment?kb=$kb" -H "authorization: Bearer $SPIKE_SECRET"; done
# stage two only (visitor cold render, cache bypassed)
curl -s "https://spike.<domain>/_mallok/spike/render?path=/news/<slug>" -H "authorization: Bearer $SPIKE_SECRET"
# cache hit
curl -s -o /dev/null https://spike.<domain>/news/<slug>
# login cost candidates
for n in 50000 100000 200000 600000; do curl -s "https://spike.<domain>/_mallok/spike/pbkdf2?iterations=$n" -H "authorization: Bearer $SPIKE_SECRET"; done
```

Also note whether any invocation is cancelled with error 1102 (CPU limit).

### 4.5 Purge by tag (§18 item 3)

Create a token in the dashboard (My Profile → API Tokens → Create Custom
Token) with **Zone → Cache Purge → Purge** on the spike zone, then:

```sh
printf '%s' "<token>"   | npx wrangler secret put CF_API_TOKEN -c "$CONFIG"
printf '%s' "<zone id>" | npx wrangler secret put CF_ZONE_ID  -c "$CONFIG"
```

Warm the cache (`curl` the article until `HIT`), publish an edit to the same
article through the API, and time how long until a fresh `curl` shows the
new text. Then call the purge endpoint directly and read the API response:

```sh
curl -s "https://spike.<domain>/_mallok/spike/purge?tags=site" -H "authorization: Bearer $SPIKE_SECRET"
```

Record: HTTP status, whether the cached article was actually invalidated,
observed propagation delay, and what the API returns after six calls in one
minute (the Free-plan rate limit).

### 4.6 R2 custom domain (§18 item 6)

Dashboard → R2 → mallok-spike-media → Settings → Custom Domains →
`media.<domain>`. Upload any file with `npx wrangler r2 object put
mallok-spike-media/media/test.txt --file=README.md`, fetch it through the
domain twice and record the `cf-cache-status` header.

### 4.7 Migration concurrency (§18 item 8)

This needs an **empty** database, and steps 4.1–4.6 have filled the first one.
Create a second one and point the config at it for this test only:

```sh
npx wrangler d1 create mallok-spike2-db      # copy the database_id
# edit $CONFIG: database_name/database_id → the new database
npx wrangler deploy -c "$CONFIG"
```

Point the config back at `mallok-spike-db` afterwards if you want to re-run
any earlier step; delete `mallok-spike2-db` whenever you clean up (§6).

Then fire ten parallel first requests:

```sh
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code}\n" https://spike.<domain>/ & done; wait
npx wrangler d1 execute mallok-spike2-db -c "$CONFIG" --remote --command "SELECT * FROM migration; SELECT * FROM migration_lock;"
```

All responses must be 200, exactly one `migration` row must exist and the
lock must be released.

## 5. Results

**Run 2026-09-03, real account (`jasoon.yee@gmail.com`), zone `mallok.dev`.**
Spike Worker `mallok-spike` on `spike.mallok.dev` plus `.workers.dev`; two
extra empty databases (`mallok-spike2-db`, `mallok-spike3-db`) for the
migration-concurrency test. Full command transcript is not preserved (the
resources are deleted per §6); this table is the record.

| # | Question | Result | Conclusion |
| --- | --- | --- | --- |
| 1 | Cache API on `.workers.dev` | First request `MISS`, second `HIT` | Works with no custom domain bound |
| 1 | Cache API on custom domain | Same `MISS` → `HIT` pattern on `spike.mallok.dev` | Works identically; a custom domain is not a precondition for the Cache API itself |
| 1 | Cloudflare Access on `/_mallok/*` | **Not tested** | Needs a Zero Trust application configured in the dashboard; out of scope for this run |
| 2 | Stage-two cold render CPU | 75 ms CPU / 281 ms wall (cache bypassed); a cache hit measured 25 ms CPU / 176 ms wall | The cache-hit figure is higher than expected for a bare `cache.match()` and likely includes isolate start-up rather than the lookup itself — not isolated further this run |
| 2 | Stage-one CPU at 2 / 8 / 32 / 128 KB | 60 ms / 150 ms / 528 ms / 726 ms (`wrangler tail`, real workerd) | Far above the 10 ms budget at every size tested, and far above the local warm-JIT numbers in §3.2 too (2 KB: 60 ms real vs 6.1 ms local warm, though the local **cold**-process estimate was also ≈60 ms). **This is the load-bearing number**: even a short article's save request cannot fit the Free plan's CPU budget with the current `unified` pipeline. The `markdown-it` fallback in `TECH_STACK.md §4` needs a real decision, not just a local recommendation |
| 2 | Any 1102 (CPU-limit) errors | None observed directly | The PBKDF2 failures below are a **different**, harder platform limit, not a CPU-time kill (`cpuTime` was 1 ms on those, not near any budget ceiling) |
| 3 | Purge by tag: status | `{"attempted":true,"ok":true,"status":200}` from the purge endpoint | Works |
| 3 | Purge by tag: propagation delay | ≈ 20 s from save (`purgeQueued:true`) to the edit being visible on a fresh request | Real, but not "seconds" in the sense of "one or two" — `AC-CONTENT-02b`'s wording should be checked against this number by the product owner |
| 3 | Purge by tag: rate-limit behaviour | 6 calls 2 s apart, then 10 calls back-to-back with no delay — **all 16 succeeded**, no throttled or error response seen | Contradicts `cache.ts`'s own comment ("the Free plan allows only five tag purges per minute"); that comment is corrected below. Does not by itself prove there is no limit — only that it is not hit at this volume |
| 4 | Bundle gzip size | 285.5 KiB (was 232.3 KiB before `rehype-raw`, added 2026-09-02) | 9.3% of the Free plan's 3 MB; the `198.8 KiB` this row previously carried was stale — see `docs/ACCEPTANCE.md AC-INV-04` |
| 5 | PBKDF2 iterations within 10 ms | 50 000 → 10 ms CPU; 100 000 → 35 ms CPU | 50 000 (the current default, `PBKDF2_ITERATIONS`) sits right at the 10 ms edge on real hardware, not comfortably under it as the 7.8 ms local Node estimate suggested |
| 5 | PBKDF2 hard ceiling | **`iteration counts above 100000 are not supported`** — 200 000 and 600 000 both fail instantly (workerd's WebCrypto, not a Mallok check) | This is a **platform ceiling**, independent of the CPU budget question. `PBKDF2_RECOMMENDED_ITERATIONS = 600_000` (OWASP's figure, shown to users as a disclosure) is **unreachable on this runtime** — the honest ceiling to disclose is 100 000, and even that is well over the CPU budget. `credentials.ts`'s comment is corrected below; whether to change the constant itself is for the product owner |
| 6 | R2 custom domain: works | 200, bytes byte-identical to the uploaded file | Works |
| 6 | R2 custom domain: cached | `cf-cache-status: DYNAMIC` on both the first and second fetch | **Not cached by Cloudflare's edge by default.** Serving media efficiently through `media.<domain>` needs an explicit Cache Rule (or equivalent) that this run did not configure — flagged, not fixed, here |
| 7 | Deploy to Cloudflare button | **Not tested** | Needs a public repository; `FobStack/mallok` is currently private, so this is unchanged by this run |
| 8 | Concurrent first boot | Two independent runs against fresh empty databases: exactly 2 rows in `migration` (core + the `inquiry` plugin), lock released (`locked_by`/`locked_at` both `NULL`) both times | Confirms `ensureMigrated`'s lock design holds under real concurrent cold starts across isolates, not just in simulated workerd. One run's 10 parallel requests returned 9× `200` + 1× `404`; a second, independently-monitored run on a third fresh database returned 10× `200`. The `404` did not reproduce and is recorded as an unexplained, likely transient anomaly rather than a confirmed defect |
| 9 | Turnstile + Resend latency | **Not tested** | Needs a Turnstile site key and a Resend account with a verified sending domain; out of scope for this run |
| — | `mallok create`'s per-site config (found while setting up this spike, not one of the nine) | Copying `wrangler.jsonc` into `.mallok/sites/<slug>.jsonc` and deploying with `-c` fails: `main`/`assets.directory` are relative paths, and wrangler resolves them **relative to the config file**, not the working directory. `buildSiteConfig` (`src/cli/provision.ts`) never adjusts them | **Confirmed bug** — `mallok create` would fail at the deploy step on a real account. Fixed in this session; see the code changes below |

The two remaining unmeasured items (7, 9) need a public repository and Turnstile/Resend accounts respectively — neither is a CLI-only step like the rest of this list.

## 6. Clean-up after the spike

- Delete the spike resources (`docs/CLOUDFLARE_RESOURCES.md §10` order),
  including `mallok-spike2-db` and `mallok-spike3-db` from step 4.7, and
  `mallok-spike2`/`mallok-spike3` (the two extra Workers created for that
  test), and the `media.mallok.dev` R2 custom domain and the
  `CF_API_TOKEN`/`CF_ZONE_ID` secrets' backing API token — **done 2026-09-03**.
- ~~Remove `src/worker/spike.ts` and its route once §18 is updated.~~ **Done
  2026-09-03**, alongside this results table.
- ~~Decide the Markdown engine question before Task 02 starts.~~
  **Decided 2026-08-29**: keep `unified`. The instruction was to follow
  Astro's Markdown engine, and Astro's default processor is still
  `unified()` on remark/rehype (`@astrojs/markdown-remark`). Astro's other
  processor, the Rust-based Sätteri, is disqualified by `TECH_STACK.md §12`,
  which bars native binaries from the Worker. The consequence stands and is
  not resolved by this decision: Astro parses Markdown at build time on Node,
  while Mallok runs stage one inside a save request under a 10 ms CPU budget,
  so §3.2's curve caps article length on the Free plan until §4.4 says
  otherwise. `PLUGIN_API.md §5.2` binds `beforeRender` to mdast accordingly.
- ~~**Still open**: whether to keep inline HTML by adding `rehype-raw`~~
  **Settled 2026-09-02**: keep it, sanitised. See `docs/ACCEPTANCE.md §12`
  blocker 3 and `SECURITY.md §4`. This was decided before this spike ran and
  is unrelated to its measurements.
- **New, from this run**: `markdown-it` vs `unified` for stage one is no
  longer just a local recommendation — §5 row 2 above measured the current
  pipeline at 6–73× the CPU budget on real hardware. This is now a decision
  the product owner needs to make, not a "local data suggests" note.
