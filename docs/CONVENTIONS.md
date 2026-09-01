# Mallok engineering conventions

The rules a change to this repository is held to. `CONTRIBUTING.md` covers
mechanical code style; this document covers the boundaries that style cannot
express — what the product is, what the engineering may not do, and how a
claim becomes a fact.

## Reading order

Before changing anything substantial, read in this order:

1. [`docs/PRODUCT_VISION.md`](PRODUCT_VISION.md)
2. [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
3. [`docs/TECH_STACK.md`](TECH_STACK.md)
4. [`docs/CONTENT_FORMAT.md`](CONTENT_FORMAT.md)
5. [`docs/DATA_MODEL.md`](DATA_MODEL.md)
6. [`docs/CLOUDFLARE_RESOURCES.md`](CLOUDFLARE_RESOURCES.md)
7. [`docs/IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — the task sequence
   and where it stands
8. [`docs/tasks/`](tasks/) — per task, the decisions taken and where the
   implementation deviates from the design
9. [`CONTRIBUTING.md`](../CONTRIBUTING.md)

Superseded designs are not a basis for implementation. The abandoned "macOS
desktop Studio plus build-time prerendering" approach survives only in git
commit `2e775cb`, for reference. Anything mentioning a desktop Studio app, a
self-contained Bun distribution, a build-time PublishBundle, or a Worker that
looks up rows without rendering belongs to that dead design.

## Product boundaries

- Mallok is an open-source content website deployed into the user's own
  Cloudflare account. It is not a site generator and not a framework. **The
  first vertical is foreign-trade B2B company sites; 0.1 is accepted when a
  real trade site is running and has received an inquiry.**
- The direct competitors are WordPress and Ghost. Astro is a reference point
  for output quality, not something to be compatible with or match feature for
  feature.
- **Content is standard Markdown with YAML front matter, stored in D1, with
  images referenced by relative path. No private structure.** HTML is not the
  truth: fragments in `render_cache` are derived data and the whole table can
  be dropped at any time.
- **An edit is live immediately — no build, no redeploy.** No design may
  trade this away. The same immediacy applies to site settings, the options a
  theme exposes, and a plugin's enabled switch and settings.
- **People who do not want D1 can still use it** (decided 2026-08-31):
  `mallok build` compiles a complete static site from a local directory —
  categories, tags, articles, multiple languages and the SEO endpoints, all
  through the same `src/core` render functions. The cost is stated plainly in
  `CLI.md §6.7`: **no inquiry form** (that needs a server), no admin, and a
  rebuild after every edit. This is a **second path alongside the first**, not
  a replacement for it.
- **Themes and plugins belong to build time.** They live in the source tree
  and take effect on deployment; switching a theme, installing a plugin or
  upgrading Mallok all require a redeploy. The interface must say so plainly
  and **must not be dressed up as a one-click action.** This rule and the one
  above together define where the product's line sits.
- Content can be exported to bundles (`index.md` plus `images/`) at any time.
  Round-trip fidelity must be covered by tests. Business data such as
  inquiries is equally exportable.
- The admin exposes only what an operator can actually change: content,
  settings, plugin panels. The starter is the repository the user forked, and
  its example content is imported by the setup wizard.
- Content kinds are not a core enumeration. The core builds in `page` and
  `article`; everything else is declared by a theme's `theme.json`.
- Multiple languages are part of the content model — `locale` plus
  `translation_group`, locale-prefixed URLs, automatic `hreflang` — not a
  plugin.
- A theme is a declarative template directory containing no arbitrary
  JavaScript. It lives in `src/themes/` and is **bundled at build time**:
  templates and language packs go into the artifact, `assets/` goes to Static
  Assets, and **neither goes into D1 or R2**. Switching themes changes no
  content id and no URL. The Worker never unpacks an archive or installs a
  package.
- Plugins are real JavaScript, and official and third-party plugins take
  **the same path**: source into `src/plugins/`, bundled at build time.
  Installing, updating or removing one requires a redeploy; the enabled switch
  and the settings take effect immediately. The interface must keep those two
  facts apart and must not pretend plugins are hot-pluggable.
- Visitor pages ship no client-side JavaScript. The one exception in 0.1 is
  the Turnstile widget the inquiry plugin injects.
- The product promises to start on Cloudflare's free plan and to reach
  Workers Paid without an architectural change. Every design is budgeted
  against the free limits; "suggest an upgrade" is not a way around one.
- 0.1 does not build hosting, accounts, billing, multi-tenancy, collaborative
  editing, carts or payments.
- 0.1 targets Cloudflare only and Resend only. No provider or adapter layer is
  abstracted ahead of a second implementation.

## Engineering boundaries

- TypeScript in strict mode. A single repository, not a monorepo. The output
  is one Worker and one CLI published to npm.
- **`src/core/` must not import any Cloudflare type or global.** It has to run
  identically in Node, in a browser and in workerd. Enforced by
  `src/core/tsconfig.json` (which has only `lib.webworker`) and by an override
  in `biome.json`.
- A dependency on the render path must be pure JavaScript, must run in
  workerd, and must fit once bundled — 3 MB gzip on the free plan, 10 MB on
  Paid, with the official plugins counted. Native binaries never enter the
  Worker; the CLI may use `sharp` locally.
- Use mature libraries for Markdown, HTML sanitisation, templating and
  validation. Do not write a parser, a tokenizer or a sanitiser.
- External services — the Cloudflare API, Turnstile, Resend — are called with
  `fetch`. No SDK enters the Worker.
- The Worker does no image processing. Images are processed at upload time in
  the browser or locally by the CLI. The outputs must match in specification,
  not byte for byte.
- Content is untrusted data. Sanitisation happens when a fragment is
  generated and **never modifies the Markdown source**.
- Rendering has two stages. Markdown to a fragment runs on save and is written
  to D1's `render_cache`; relative paths are resolved to R2 addresses at this
  stage, and the cache key includes the assets and the media hostname.
  Fragment to page runs on request. **Every** Worker invocation, the
  management API's save requests included, is budgeted against the free
  plan's 10 ms of CPU. Exceeding it must produce a clear error, never a silent
  failure.
- A single cold render issues one D1 batch, a constant number of queries and a
  bounded number of row reads. **A list page never parses body Markdown.**
- The same Markdown, pipeline version and theme version must render
  byte-identical HTML. Render functions and `beforeRender` hooks may not read
  the clock, a random source, or anything about the request.
- **Cloudflare's own credentials — `CF_API_TOKEN`, `CF_ZONE_ID`,
  `MALLOK_SECRET` — exist only as Worker secrets. Third-party service keys
  are encrypted with `MALLOK_SECRET` using AES-GCM and stored in D1, where the
  admin configures them.** No credential reaches a log or a response body.
- One Cron Trigger per Worker. No KV, no Queues, no Durable Objects.
- One site owns one set of resources. Naming, binding names and the creation
  and deletion order follow [`docs/CLOUDFLARE_RESOURCES.md`](CLOUDFLARE_RESOURCES.md).
  Code refers to binding names only — `DB`, `MEDIA`, `ASSETS`,
  `RATE_LIMITER`.

## Style

- Follow the Google TypeScript Style Guide. What tooling can enforce is in
  `biome.json`; the rest is in `CONTRIBUTING.md`.
- Everything in the repository is written in English: code, comments, JSDoc,
  commit messages, test names and developer documentation. `docs/` is being
  translated — a translated document is authoritative at `docs/<NAME>.md` with
  its Chinese original archived under `docs/zh/`, while an untranslated one is
  still Chinese at its canonical path and marked *(zh)* in
  [`docs/README.md`](README.md). `docs/tasks/` was written in English.
- Named exports only. `import type`. No `any`, no non-null assertions, no
  `namespace`. Filenames are lowercase and hyphenated.
- Database column names and the view objects handed to Liquid templates use
  `snake_case`. Everything else uses `lowerCamelCase`.
- Before a change is done,
  `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size && pnpm admin:size`
  must all pass.
- **The admin build never enters the Worker script.** It builds to
  `dist/assets/_mallok/app/` and is served by Static Assets, with a 150 KB
  gzip budget on first-load JavaScript that `pnpm admin:size` asserts. The
  render pipeline and CodeMirror are always loaded on demand.

## Fact discipline

The open items listed in `docs/ARCHITECTURE.md §18` **are not established
facts** until they have been measured. Any conclusion about Cloudflare's
platform behaviour, its limits, Resend, or what a dependency can do must come
from the current official documentation or from a measurement — never from
memory. When a measurement contradicts a document, the document is corrected
before any code is written. Local benchmarks (`docs/tasks/TASK-01.md §3`)
describe the shape of a curve; they do not stand in for data from a real
account.

## Working rules

- One change implements one demonstrable user path and leaves test evidence
  for the acceptance criteria it claims.
- When something is unclear, stop and state the conflict. Scope is never
  widened by "improving things while I am here".
- Deploying, creating real cloud resources, publishing to npm and pushing to
  git each need explicit authorisation.
- Unrelated files are not modified. Secrets and build output are never
  committed.
- On completion, report the files changed, how it was verified, what is
  unfinished, and the known risks.
