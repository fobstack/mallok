# Mallok 0.1 technology stack and dependency boundaries

- Status: 0.1 technical baseline (second revision, 2026-08-28)
- Date: 2026-08-28
- Purpose: to let implementation start without handing selection decisions to
  the implementer

This document supersedes the earlier "self-contained Bun desktop app, Preact
Studio, build-time rendering" stack. That stack's central premise — rendering
happens on a local machine — no longer holds, so the dependency list was
essentially reselected.

## 1. The conclusion in one sentence

Mallok is a TypeScript single repository whose output is one Worker running on
Cloudflare Workers — the public site, the admin, the management API, the
wizard and the official plugins — plus one CLI published to npm. **The hardest
constraint on selection is this: every dependency on the render path must be
pure JavaScript, must run in the Workers runtime, and must be small enough
once bundled. The product promises to start on the free plan, so every piece
of code running in the Worker is budgeted against 10 ms of CPU.** Any library
needing a native binary, a Node built-in module or a filesystem is out
automatically — the CLI's local half excepted.

## 2. Runtime and repository

| Area | The 0.1 choice | Why |
| --- | --- | --- |
| Language | TypeScript strict plus `noUncheckedIndexedAccess` | One set of types across the Worker, the CLI and the admin |
| Production runtime | Cloudflare Workers (`workerd`) | That is the product; no multi-cloud abstraction |
| Development runtime | Node.js 22 LTS | The CLI ships to npm, where Node compatibility matters most. No second runtime |
| Package manager | pnpm with a lockfile | One repository; the lockfile is a release input |
| Modules | ESM only | Workers is natively ESM; no CJS double life |
| Repository layout | A single repository, split under `src/` per ARCHITECTURE §3; **not a monorepo or workspace layout** | One publishable package, built from one tree. (The Deploy to Cloudflare button's dislike of monorepos used to be the reason given; that path is `NOT_AVAILABLE` in 0.1 and is no longer what decides this.) |
| Build and deploy | `wrangler` | Cloudflare's own tool, which also supplies local D1 and R2 simulation and cron testing |

Exact versions are pinned in the first dependency-only commit and are not
bumped opportunistically inside a feature commit.

## 3. Dependency layers and their hard rules

Dependencies are grouped by whether they may enter the Worker. Crossing a
boundary is an architectural violation:

| Layer | Location | Constraint |
| --- | --- | --- |
| **Render** | `src/core/`, used by the Worker, the CLI and the admin preview alike | Pure JS, no Node built-ins, no Cloudflare globals, no DOM dependency, size-sensitive |
| **Worker** | `src/worker/`, `src/db/`, `src/plugins/` | May use Workers runtime APIs; may not use Node built-ins |
| **Upload side** | Image processing in `src/admin/` and `src/cli/` | The browser uses Canvas, the CLI may use `sharp`; the two must match in specification, not byte for byte |
| **Build and development** | Build scripts, tests, the rest of the CLI's local half | Unconstrained, but never present in the Worker artifact |

`src/core/` must not import any Cloudflare type or global. That is the only
mechanism guaranteeing the CLI's local preview, the admin's preview and
production rendering are byte-identical, and lint rules enforce it.

## 4. Render pipeline dependencies

| Capability | Choice | Notes |
| --- | --- | --- |
| Markdown parsing | `unified` + `remark-parse` + `remark-gfm` | Pure JS. An AST approach rather than `marked` or `markdown-it`, because a plugin's `beforeRender` hook operates on the AST |
| Front matter | `yaml` | Aliases, custom tags and duplicate keys are disabled |
| Markdown → HTML | `remark-rehype` + `rehype-stringify` | The same ecosystem as above |
| Inline HTML | `rehype-raw` | Parses the raw HTML `remark-rehype`'s `allowDangerousHtml` hands it into the tree, so `rehype-sanitize` runs over it too, rather than dropping it outright. Settled 2026-09-02 (Gate B', `SECURITY.md §4`) |
| HTML sanitisation | `rehype-sanitize` | Allow-list mode; content is always untrusted. Runs after `rehype-raw`, over the whole tree including what it added |
| Relative-path resolution | An in-repository rehype step | Substitutes R2 URLs for `images/x.jpg` through `content.assets` and adds `srcset` and friends. Attribute substitution only — nothing hand-parsed |
| Markdown serialisation | `mdast-util-to-markdown` + `mdast-util-gfm` | For the visual editor's saves in 0.2, keeping exports standard Markdown |
| Template engine | `liquidjs` (the browser build, `dist/liquid.browser.mjs`) | Verified to provide a build free of Node dependencies. Liquid is the syntax Shopify, Jekyll and 11ty authors already know. `ownPropertyOnly` is enabled and raw-style output is disabled |
| Validation | `zod` | Content fields, `theme.json`, `plugin.json`, API inputs, plugin route inputs |
| Hashing and encryption | WebCrypto, built into the runtime | Content-addressing sha256, PBKDF2, session tokens, AES-GCM for third-party keys, HMAC for preview links. No second crypto library |

Rendering has two stages (ARCHITECTURE §5): stage one, Markdown to a fragment,
runs on save and is cached in D1; stage two, fragment to page, runs on the
visitor request. Both live in `core/` and both must be pure.

**Size is a first-class constraint.** The remark and rehype ecosystem is
convenient but not small, while Mallok's own render-path budget is 3 MiB gzip (Cloudflare's own limit is 64 MiB uncompressed on either plan, checked 2026-09-12) on the
free plan and 10 MB on Paid, with the official plugins bundled in. The first
implementation task must report the measured bundled size, and when it is over
the order of response is: trim remark plugins first, then evaluate
`markdown-it` — and **never write a Markdown parser or an HTML sanitiser by
hand**.

Equally excluded: `sharp` or any native image library in the Worker (they
cannot run there), and any template loading that depends on `fs`, `path` or
`child_process` — templates reach the engine as strings.

## 5. External services

All called directly through the runtime's `fetch` against their HTTP APIs,
with **no vendor SDK entering the Worker**:

| Service | Purpose | How |
| --- | --- | --- |
| The Cloudflare API | Purging by tag or URL; the wizard's DNS writes | `fetch` with `CF_API_TOKEN` (zone-level Cache Purge and DNS Edit) |
| Turnstile | Inquiry-form abuse protection | The official widget script on the page — the inquiry plugin's only declared client JS — plus the server-side `siteverify` endpoint |
| Resend | Inquiry notifications and auto-acknowledgements | `fetch` against Resend's HTTP API; the key is encrypted in D1 |
| The Workers rate-limit binding | Plugin-route abuse protection | A `ratelimit` binding in the wrangler configuration. It counts per data centre and is eventually consistent, so it deters abuse only |

## 6. The admin

| Area | Choice | Notes |
| --- | --- | --- |
| UI framework | `react` + `react-dom`, state on `@preact/signals-react` | Switched from Preact 2026-09-06: contributor familiarity outweighed the size difference, measured at real ~54 KiB gzip (`ADMIN.md §13`) — still well inside the 150 KB first-load budget. Signals stayed: the app's state is a handful of globals, not enough to justify a store library, and `@preact/signals-react` keeps the same `signal()`/`computed()`/`.value` API the Preact build used |
| Build | `vite` + `@vitejs/plugin-react` (with the `@preact/signals-react-transform` Babel plugin, so a bare `.value` read in JSX still subscribes automatically) | A build-time dependency only |
| Markdown editing | `codemirror` + `@codemirror/lang-markdown` | The only body editor in 0.1. It runs in the browser and never enters the Worker |
| Field forms | Generated in-repository from zod/JSON schemas | Content-kind fields, theme options, plugin settings and plugin panels are all schema-driven; no bespoke forms |
| Live preview | Reuses `src/core/` in the browser | Byte-identical to production |
| Visual editing | `@tiptap/core` + `@tiptap/pm` (**0.2**) | Not in 0.1. Tiptap's DOM is never the truth about content |
| Styling | In-repository CSS variables and components | No Tailwind, no CSS-in-JS, no third-party component library |
| Image processing | The browser's Canvas API | On upload the client computes sha256, converts to WebP and generates width variants; see ARCHITECTURE §8 |

**The admin build is served through Cloudflare Workers Static Assets and is
never bundled into the Worker script.** Static-asset requests are verified to
be free and not billed as Worker invocations, with a free-plan ceiling of
20,000 files at 25 MiB each, so the admin's size never eats into the render
pipeline's script budget.

## 7. Data and storage

- **D1**: content, the fragment cache, media metadata, settings, plugin state,
  sessions and pending work. Schema migration runs inside the Worker
  (ARCHITECTURE §15), while the migration files still follow
  `wrangler d1 migrations`' directory and naming convention for local
  development. No ORM and no migration framework. SQL is hand-written and
  parameterised, kept in `src/db/`, and D1 types do not leak upward.
- **R2**: media bytes under content-addressed keys, served through an R2
  custom domain.
- **The Cache API**: rendered pages, see ARCHITECTURE §6.
- **No Workers KV and no Queues**: KV's free tier allows 1,000 writes a day,
  which is not enough; Queues' free tier allows 10,000 operations a day, but
  0.1's retries need only the `job` table and cron.

## 8. The CLI

- Published to npm, `node >= 22`, usable through `npx mallok`.
- Commands: `create` (the deployment flow), `publish <dir>`, `import <dir>`,
  `export <dir>`, `build <dir>`, `preview <dir>` and `media push`.
- Remote content, media and export commands call the same management endpoints
  the admin uses, authenticated with scoped Bearer tokens. Local preview/build
  and project or Cloudflare resource lifecycle commands remain CLI-specific;
  the CLI is not a Worker subprocess (`AC-CLI-04`).
- Reuses `src/core/` for bundle parsing, local preview and import/export, so
  it matches production rendering.
- Uses `sharp` for images — a CLI-only dependency, never in the Worker —
  producing output to the same specification as the browser.
- Parses arguments with something lightweight; no heavy CLI framework.
- Can read an `image-slots.json` produced by an AI content pipeline to report
  missing images, without depending on one.

## 9. Local development

`wrangler dev` provides local D1 and R2 simulation directly and, from v3
onward, persists data by default (relocatable with `--persist-to`). Cron is
fired with `--test-scheduled`.

**0.1 therefore writes no dev server.** Local development is `wrangler dev`,
running exactly the same code path as production, so theme, starter and plugin
authors develop against what actually ships.

## 10. Quality tooling

| Area | Choice |
| --- | --- |
| Type checking | `typescript` strict |
| Lint and formatting | `@biomejs/biome`, rather than maintaining ESLint and Prettier together |
| Unit tests | `vitest` |
| Worker integration tests | `@cloudflare/vitest-pool-workers`, running in real workerd |
| Admin component tests | `@testing-library/react` + `happy-dom` |
| Property tests and hostile input | `fast-check` |
| End to end | `playwright` + `@axe-core/playwright` |
| Performance gate | `lighthouse` / `@lhci/cli`, pinned, development-only |

Evidence no tool can supply: measured Worker CPU time including save requests,
measured bundle size, measured cache hit rate and purge latency, a verified
deployment on a real Cloudflare account, and one real inquiry email sent and
received.

## 11. The dependency gate

1. The list above is the only approved set of direct dependencies for 0.1.
   Anything else requires revising this document first.
2. Every task begins with a dependency-only diff: exact version, lockfile,
   licence, install scripts, transitive count, size, and which of the render,
   Worker, upload-side or build layers it belongs to.
3. Production dependencies are pinned to exact versions, never a floating tag.
4. A dependency entering the render or Worker layer must come with evidence of
   running in real `workerd` and with its bundled gzip size.
5. When a dependency cannot meet the contract, return BLOCKED and explain.
   Do not route around it by hand-writing a parser or a sanitiser.
6. **"Adding no dependency" is not a reason to override rule 5.** Where a
   mature ecosystem has solved something — compression, parsing, sanitisation
   — take the existing implementation, revising this document to add it to
   rule 1's list when needed, rather than writing one into the repository.

### 11.1 Registered dependencies

| Package | Version | Licence | Layer | Transitive | Bundle delta (gzip) | Install scripts | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rehype-raw` | `7.0.0` | MIT | Render | 9 new: `entities` (BSD-2-Clause), `hast-util-from-parse5`, `hast-util-parse-selector`, `hast-util-raw`, `hast-util-to-parse5`, `hastscript`, `parse5`, `vfile-location`, `web-namespaces` (all MIT). None carry an `install`/`postinstall`/`preinstall` script | +53.2 KiB (Worker: 232.3 → 285.5 KiB gzip, 7.6% → 9.3% of Mallok's own 3 MiB render-path budget — not of a Cloudflare limit; theirs is 64 MiB uncompressed on either plan) | None, across all 10 packages | Gate B', settled 2026-09-02: makes `CONTENT_FORMAT §3.4`'s promise true — inline HTML is sanitised and kept, not dropped outright (`SECURITY.md §4`) |

Before this, the table had no rows: `fflate` was briefly added to unpack theme zips and removed when themes moved to build-time bundling (`tasks/TASK-04.md`).

## 12. Explicitly forbidden

- Site frameworks — Astro, Next.js, Nuxt, SvelteKit, Gatsby, Eleventy. Mallok
  is an alternative to them, not a wrapper around one.
- Any native binary dependency in the Worker (`sharp`, `better-sqlite3`,
  native Argon2 bindings).
- Any library requiring a Node built-in in the Worker or render layer.
- An ORM, a general CMS runtime, a second template engine, a second render
  pipeline.
- Dynamic `import` of remote code at runtime, and `eval` in any form.
- A React compatibility layer, or a general UI component library.
- Any vendor SDK in the Worker — Cloudflare, Resend, Stripe — where `fetch`
  will do.
- Workers KV, Queues, Durable Objects and Cloudflare Images; 0.1 needs none of
  them.
- A provider or adapter layer abstracted in advance for a cloud that might be
  supported one day.

## 13. External sources

The platform facts cited here come from the following official documentation,
checked on 2026-08-28:

- Worker script size, CPU time, startup time, memory, subrequests, cron count
  and static-asset limits: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Workers Free and Paid pricing and inclusions: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- D1 database size, row read/write and query limits: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- R2 free allowance, pricing, custom domains and caching: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- Where the Cache API is available and `cache.delete`'s data-centre locality: [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- Purge rate limits and how Cache API entries can be purged: [Purge cache](https://developers.cloudflare.com/cache/how-to/purge-cache/), [Purge cache key](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-cache-key/)
- KV free-tier write limits: [KV limits](https://developers.cloudflare.com/kv/platform/limits/)
- Queues free tier: [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- Static-asset requests being free and unbilled: [Static assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- The Deploy to Cloudflare button's requirements and capabilities: [Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- Turnstile's free tier: [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)
- The semantics of the Workers rate-limit binding: [Rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- Email Workers' send binding being Paid-only: [Send emails from Workers](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
- Resend's free tier and Pro pricing: [Resend pricing](https://resend.com/pricing)
- Local D1 persistence and the migration commands: [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- That `liquidjs` provides a browser build: the npm package `liquidjs@10.29.0` maps its `browser` field to `dist/liquid.browser.mjs`

These links establish only that a platform or dependency has the capability in
question. They do not establish that Mallok has pinned a version, bundled
successfully, or run hostile input against it. The open items in
ARCHITECTURE §18 remain a hard gate.
