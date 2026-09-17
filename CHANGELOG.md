# Changelog

Notable changes to Mallok. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-rc.5] — unreleased

**rc.4 never left the local release gate.** This candidate turns the failures
found there into enforceable product boundaries: destructive commands identify
the exact resources they may touch, upgrades recover after interruption,
third-party plugins have a public contract, and the one tested tarball is the
one an operator can publish.

### Theme performance

- Atelier 2.3.1 serves its original typefaces from local static assets instead
  of a render-blocking Google Fonts stylesheet. Font licenses and provenance
  ship with the assets. A theme favicon removes the automatic favicon 404.

### Security

- Pin transitive development-tool image processing to patched `sharp@0.35.4`
  in this checkout and generated npm sites (GHSA-rgj7-g3m4-5g8c), while keeping
  the tested Wrangler version. The published CLI already used that patch.

- **Cache hits retain the declared browser lifetime.** The real edge returned
  a four-hour browser TTL from Cache API storage despite a zero-TTL policy.
  The stored entry now retains the original policy separately; outgoing hits
  restore it and remove the internal metadata.

- **D1 identity probes resolve the remote name.** The real deployment gate
  exposed Wrangler trusting the local placeholder UUID before querying the API.
  Probes now use an isolated name-only binding, preserving account selection
  and the original site config. This also prevents stale local UUIDs from
  hiding a database name that has been reused.

- **Cloudflare mutations now fail closed on identity.** `create`, `repair`,
  `setup-key` and `destroy` bind every Wrangler subprocess to one verified
  account; compare the Worker, D1 UUID and R2 binding with the project records;
  and reject missing, conflicting or reused identities before a mutation.
  Resource absence is accepted only when Wrangler returns the locked,
  resource-specific error contract — a generic 404, authentication failure or
  unknown message stops the run.
- **The setup key is required by default and has one delivery path.** A
  deployed site without the key returns 503 instead of opening administrator
  creation to the first visitor. The ledger records delivery only after the
  caller has received the value, and commands that can emit credentials refuse
  `--json` before touching Cloudflare.
- **Browser tests cannot inherit a developer's secrets.** Each run creates a
  private source, configuration, environment, artifact and storage snapshot
  under ignored `.tmp` state, uses a fresh session/encryption secret, and
  removes the snapshot after Wrangler exits.
- **Exports fail closed across plugins and filesystems.** Core and plugin
  paths share one portable validator; aliases, traversal, reserved names and
  core/plugin overwrites are refused. The CLI builds in a private staging
  directory and the browser withholds its ZIP when a plugin or media download
  fails, so neither can report a partial backup as complete.

### Fixed

- **Upgrades are a recoverable transaction.** An exclusive lock and atomic
  journal protect `package.json` and the effective npm lockfile; interrupted
  runs restore on the next invocation, rollback uses `npm ci`, and the command
  verifies the exact installed version rather than semver precedence alone.
- **Browser runs no longer share mutable build output.** The Worker and theme
  accessibility checks use the run's private package and assets, so another
  `build:package` cannot delete a hashed chunk or CLI file while Playwright is
  using it.
- **Production admin chunks are reproducible and private.** Package builds
  force production JSX even when invoked from a test process. Two different
  checkout paths now produce byte-identical assets, with no build-machine path
  or `jsxDEV` metadata in the published tarball.
- **The external release runbook fails closed.** Executable examples are
  syntax-checked Bash, derive and cross-check real resource identities, keep
  cold CPU separate from cache-warm requests, and require machine assertions
  for cache purge, scheduled publishing, media cleanup, migrations and final
  destruction.
- **Colliding translation bundles preserve their real slugs.** `mallok.json`
  records each locale's slug, allowing export directories to receive a stable
  collision suffix without changing a URL when the bundle is imported or
  built statically.

### Added

- **A usable third-party plugin API.** `mallok/worker` exports the manifest,
  settings, route, content, email and hook context types plus `definePlugin`.
  Definitions are schema-normalised and rejected when declared hooks or routes
  disagree with their implementations; an isolated strict consumer compiles
  and executes a plugin using only the packed tarball.
- **One selected release artifact.** `pnpm release:pack` writes a versioned
  candidate and independent hash record outside mutable staging, refuses a
  second pack, and the candidate suites install that exact file. Packaging
  starts from a clean Git commit, removes the complete compiled-asset tree,
  copies the project shell from a reviewed allow-list, and records the source
  commit beside npm's hashes and sizes. The package's `THIRD_PARTY_NOTICES` is
  generated from the Worker, CLI and admin build graphs rather than a declared
  dependency list.

## [0.1.0-rc.4] — unreleased

**rc.3's "local release loop is complete" conclusion is withdrawn.** rc.3 is
`LOCAL_RELEASE_BLOCKED`, and this release is the work of finding out why. Each
item below began as a regression test that failed on rc.3's code — the tests
came first, the fixes second, and the documentation last.

### Fixed

- **A site could not compile against the published types.** The `mallok`
  package shipped a `tsc` emit of the whole source tree, which reached `zod`,
  `mdast` and `hast` through the core barrel — three packages `mallok` does
  not depend on. Any project with `skipLibCheck: false` got five
  `Cannot find module` errors before compiling a line of its own code, and the
  generated shell had `skipLibCheck` on, so nothing noticed. `mallok/worker`
  now publishes one hand-written `types/worker.d.ts` that names nothing it
  does not depend on, and `test/types/public-surface.ts` type-checks the
  implementation against it on every `pnpm typecheck` so the two cannot drift.
  `test/cli/strict-consumer.test.ts` compiles a project that installed only
  the tarball, with `skipLibCheck` off and no path back to this repository.
- **The package redistributed 89 libraries and attributed none of them.**
  `THIRD_PARTY_NOTICES` is now generated from esbuild's own metafiles — what
  was *bundled*, not what was declared, so `sharp` (external by design) is
  absent and transitive packages that ended up inside `worker/index.js` are
  present — and shipped in the tarball.
- **The secret scanner reported one match per line.** It called `exec` once
  per rule per line, so an acknowledged fixture sitting ahead of a real
  credential on the same line was the only value ever fingerprinted: the run
  printed "Acknowledged" and exited 0. Every match on a line is now enumerated
  and fingerprinted individually. Minified output, a collapsed `.env` and an
  array of keys are all one-line shapes.
- **`--empty-bucket` was built on a Wrangler command that does not exist.**
  `wrangler r2 object list` is not in Wrangler 4.124.0, so the documented safe
  way to clean up would have failed the first time anybody used it. The flag is
  gone; `destroy` tries the **bucket first** and stops there if it is not
  empty, before the Worker and the database are deleted.
  `test/cli/wrangler-contract.test.ts` checks every subcommand the CLI and its
  fakes rely on against the locked binary's own `--help`.
- **The cache-purge gate could only pass when purging was broken.** It edited
  an article in the admin — which purges — and then asserted the edge was
  still serving the old copy. `docs/RELEASE_GATE.md §9` now changes the
  rendered fragment in D1 directly (no code path that purges), proves the edge
  still HITs the old copy, purges by tag as a separate act, and tests the
  automatic purge on a save of its own.
- **The Lighthouse gate had quietly dropped half its threshold.**
  `docs/SEO_PERFORMANCE.md §7` asks for a median ≥ 0.95 *and* no run below
  0.90; Lighthouse CI asserts one threshold against the median, so the gate
  asserted the floor alone. `scripts/lighthouse-gate.mjs` reads all three
  reports and asserts both, per URL, and refuses a desktop collection or a
  run count other than three. `@lhci/cli` is pinned at `0.15.1` and run from
  `node_modules`, not `npx --yes`.
- **`/cdn-cgi/handler/scheduled` is not a route `wrangler dev` answers on.**
  The local scheduled endpoint is `/cdn-cgi/local/scheduled`; anyone following
  the old instruction would have got a 404 and concluded the cron handler was
  broken.
- **R2 object paths in the gate were wrong.** Objects live at
  `media/<sha>.<ext>` with `media/<sha>_<width>.webp` variants, not at the
  bucket root — a check written against the wrong key reads as "not found"
  whether the object is there or not, which in the media-reclaim step would
  have read as success.
- **Shell pipelines in the gate had no `pipefail`**, so
  `wrangler … | tail -1` exited with `tail`'s status and a Wrangler that
  failed on authentication looked exactly like one that found nothing.

### Changed

- **npm only.** rc.3 advertised pnpm as a second supported package manager and
  nothing ever created, upgraded or reinstalled a project with it.
  `--package-manager` is gone, `mallok` installs with npm and refuses to run
  beside a `pnpm-lock.yaml`, `yarn.lock` or `bun.lockb`. One verified path
  beats two claimed ones.
- **The Deploy to Cloudflare button is `NOT_AVAILABLE`, not "untested".** It
  deploys the repository it points at, and since rc.3 this repository is the
  framework — pointing it here would deploy Mallok's own source as somebody's
  website. It needs a separate public starter-site repository that does not
  exist yet, and which is **not** Nundar. The button markup is removed from
  `README.md`; `AC-DEPLOY-02` is marked `NOT_AVAILABLE`.
- **"Upgrading means syncing your fork" is gone from every document.** A site
  depends on `mallok` at an exact version; upgrading is
  `mallok upgrade --to <version>`.
- **Cloudflare's Worker size limit is 64 MiB uncompressed**, the same on Free
  and Paid, and there is no compressed limit at all (checked 2026-09-12).
  Everything here used to say "3 MB gzip, the free plan's hard limit" and
  quote percentages of it. The 3 MiB gzip figure survives as **Mallok's own**
  render-path budget, labelled as such in `pnpm bundle:size` and in the docs.
- **The rate-limit namespace is collision-*resistant*, not unique**, and
  nothing claims otherwise now. `mallok create --rate-limit-namespace <n>`
  sets it outright when two slugs on one account do collide; the value used is
  recorded in the ledger so a resumed run deploys the same limiter.
- **The pre-publish gate is no longer circular.** A candidate is verified
  against a local registry serving the same tarball under its real name, and
  the resulting lockfile is a gate artefact rather than evidence:
  `test/cli/package-release.test.ts` proves that with the registry stopped,
  `node_modules` removed and an empty cache, `npm ci` **fails**. The portable
  lockfile is regenerated from the public registry after publishing
  (`docs/RELEASE_GATE.md §5.1`), and the published file must be the
  byte-identical tarball that was tested.

### Added

- **A release CI workflow** (`.github/workflows/release.yml`) that runs
  everything in one sequential job on a tag: `fetch-depth: 0` with a shallow
  clone refused outright, lint, typecheck, the full unit/workerd suite, the
  coverage floor, the two-real-version upgrade, build and both size budgets,
  the static build, Playwright with axe, the whole-history secret scan, and a
  single `npm pack` whose filename, size, unpackedSize, integrity and shasum
  are recorded. Normal CI may split jobs; a release candidate may not.
- **A leak scan over every text file of a generated project** — not three
  files by name — for `localhost`, `127.0.0.1`, `file:`, `link:`,
  `workspace:` and absolute paths, with the one legitimate loopback
  (`scripts/smoke.mjs`, which starts a local dev server) written down and
  reasoned about rather than skipped by directory.

## [0.1.0-rc.3] — unreleased

**Mallok became a package a site depends on, instead of a repository a site is
a copy of.** That is the whole release; everything else follows from it.

### Changed

- **The `mallok` npm package now carries the framework**: the CLI, the
  `mallok/worker` entry with `createMallok`, generated type declarations, the
  compiled admin application, the official themes and plugins, and the project
  shell. `docs/PRODUCT_CONTRACT.md` is the new canonical statement of what
  Mallok is — a complete Cloudflare-native framework — replacing "not a
  framework", which was true only while the sole deployment was this
  repository.
- **`mallok create` writes a thin project.** Its configuration, content, theme
  choice, plugins and a four-line Worker entry; nothing of Mallok's own source.
  It depends on `mallok` at an **exact** version — no caret, no `file:`, no
  `workspace:`, no absolute path.
- **A site's theme and plugins are an argument, not a source edit.**
  `createMallok({ theme, plugins })` replaces the `ACTIVE_THEME` and `PLUGINS`
  constants. This repository's own Worker entry is those same four lines.
- **npm is the package manager.** The previous default assumed a global pnpm
  and failed with `pnpm: not found` on a machine that had exactly the
  documented prerequisite. (rc.3 also offered pnpm as a selectable second
  manager; that claim was never verified and was withdrawn in rc.4.)
- Generated projects use `node --test` rather than a test framework: one fewer
  dependency, one fewer version to keep in step, and `npm install vitest@4.1.11`
  crashes npm 10.9.7 outright.

### Added

- **`mallok upgrade --to <exact-version>`** — sets the version, installs,
  applies project migrations once each by id, and re-runs the site's
  typecheck, tests, build and deploy dry-run. Verified between two real
  tarballs: content, settings, theme and plugins survive byte-identical, a
  second run changes nothing, and a failed upgrade leaves the project on the
  version that worked.
- **`mallok prepare`** — stages the compiled admin and theme assets a site
  cannot build for itself.
- **A one-time setup key.** `mallok create` generates `MALLOK_SETUP_KEY`, sets
  it as a Worker secret and prints it once; the wizard will not create the
  administrator without it. Until now, whoever reached `/_mallok/setup` first
  became the administrator of somebody else's site — a race against a scanner
  on every deployment.
- A local npm registry for verifying a candidate package by installing it
  under its real name, and a `STALE` status for evidence that has outlived its
  code.

### Fixed

- **`--dry-run=true` parsed as the string `"true"`**, which every `=== true`
  check downstream read as false: the most explicit way to ask for a dry run
  was the one way that deployed. Switches are booleans now, and an undeclared
  flag such as `--no-deply` is refused instead of ignored.
- **A second `create` on a finished project redeployed and rotated
  `MALLOK_SECRET`**, signing every user out and making stored plugin keys
  unreadable. It now exits 0 having called nothing, and secrets are reconciled
  by name.
- **A half-finished `create` was invisible to `destroy`.** The registry is
  only written at the end; `destroy` now reads the ledger too.
- **A non-empty R2 bucket was reported as deleted.** `destroy` stops and says
  so; `--empty-bucket` is the explicit way to mean it.
- **Every site shared rate-limit namespace `1000`**, so one site's traffic
  throttled another's. Each slug gets a stable namespace of its own.
- **`site.domain` was only set if somebody retyped the domain in the admin**,
  so a site serving a custom domain published canonical links to its
  `.workers.dev` preview. Provisioning writes it; the wizard copies it in.
- `create` and `destroy` refuse to act on a ledger belonging to a different
  Cloudflare account, and a corrupt ledger stops a run instead of being
  treated as absent.
- **The secret scanner** silenced a whole file per acknowledgement, skipped
  lines over 4096 characters (every minified bundle), and could not tell a
  crashed scan from a clean one. All three are fixed, with regression tests
  that plant real credential shapes in real Git histories.
- The accessibility suite built themes with `dist/cli/index.js`, a path the
  build stopped writing — it had been passing against an artifact from an
  earlier release.

### Not carried over

Gate A's five real-account rows are `STALE`. The code they tested — `mallok
create`, the Worker's composition, the package layout — has been replaced, and
no row is `VERIFIED_STAGING` in this release.

## [0.1.0-rc.2] — unreleased

`mallok create` became a product contract rather than a script, and the two
gates the documentation had always claimed — a browser run and a coverage
floor — started actually running. Both found real defects on their first run.

### Fixed

- **`mallok create` created Cloudflare resources before checking the project
  could build.** It signed in, created a D1 database, created an R2 bucket,
  wrote a config and only then attempted a deploy, so a project that could not
  build left two real resources behind, named after a site that did not exist,
  recorded nowhere — and the next run refused the slug it had itself
  half-provisioned. Nothing on Cloudflare is now touched until the generated
  project has been installed, built and passed `wrangler deploy --dry-run`
  locally, and every resource created after that is written to
  `.mallok/create-state.json` before the next step runs.
- **`mallok create` assumed it was being run inside a checkout.** It now takes
  a directory, generates a complete project into it from a template the
  package carries, and takes the Cloudflare slug separately (`--slug`).
  `--no-deploy` stops after local verification; `--dry-run` does the same in a
  temporary directory and removes it.
- **A stopped run could not be resumed.** The ledger recorded what existed and
  nothing could act on it, because `create` refused any non-empty directory.
  `mallok create . --slug <slug>` now resumes from inside a generated project.
- **The admin was broken in the shipped build.** `@vitejs/plugin-react` has
  been oxc-only since v6 and silently ignores `babel.plugins`, so the signals
  transform stopped running and no component subscribed to anything: the app
  rendered "Loading…" and stayed there. The transform runs as its own Vite
  plugin now, and the build fails if it ever produces zero subscriptions.
- **Serious colour-contrast failures across the admin and four themes** —
  between 2.69:1 and 4.44:1 where WCAG AA requires 4.5:1, in both light and
  dark. The Markdown editor also had no accessible name once CodeMirror
  replaced its textarea.
- **`mallok destroy` pointed at a config file that no longer exists** and
  shelled out to `npx wrangler` — an unpinned binary deleting a Worker, a
  database and a bucket. It uses the project's own `wrangler.jsonc` and its
  own pinned Wrangler, and `create` now registers the site it deployed so
  `destroy` and `publish` can find it.

### Added

- `pnpm test:e2e` — 24 Playwright tests driving a real `wrangler dev` through
  the wizard, sign-in, the publish loop and the public site, including axe on
  eight admin screens and on all five official themes.
- `pnpm test:coverage` — an enforced coverage floor for the directories V8 can
  instrument. `src/worker`, `src/db` and `src/plugins` run inside workerd and
  cannot be measured; docs/TESTING.md §5 now says so instead of listing
  thresholds that never ran.
- `pnpm scan:secrets` — scans every blob on every ref for credential shapes
  and never prints a suspected value.
- The release tarball is built and tested before it is published, and the
  sha256 recorded at build time is rechecked at publish time
  (docs/RELEASE_GATE.md §4, §5).

## [0.1.0-rc.1] — unreleased

The release candidate: every criterion that can be closed without a Cloudflare
account, a domain, or a third-party key is closed. **Fifteen rows still need a
real account**, itemised with commands in
[`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md); the per-criterion status is in
`docs/ACCEPTANCE.md §14`.

Gate A ran for real on 2026-09-03/04 and closed five rows on a real account.
Local `workerd` results are never recorded as edge results — that distinction
is the point of the four statuses in `docs/ACCEPTANCE.md §14`.

### Changed since the last local milestone

- **Mallok is the framework.** The page runtime — file routing, the page
  lifecycle, the restricted Liquid engine, React islands, cache semantics, the
  Cloudflare adapter and the Vite plugin — lives at `src/runtime` and is part
  of this repository. It was briefly a separate package; that is over, and
  `docs/ARCHITECTURE.md §3.1` records why so it is not re-attempted. A clone
  now builds, tests and deploys with no sibling checkout and no dependency to
  pin.
- **The public site runs on that runtime.** Mallok supplies the routes, the
  per-request state and the document; the runtime owns the lifecycle, cache
  semantics and the response. Routing is data-driven, so the manifest is
  written by hand rather than scanned from a file tree, and the theme still
  owns the `<html>`.
- **A missing page renders the theme's own 404** — status 404, `noindex`,
  `no-store` — instead of `{"error":"Not found."}`. `/_mallok/*` still answers
  JSON.
- **Public pages no longer sit in a visitor's browser cache.**
  `Cache-Control` is now `public, max-age=0, s-maxage=<ttl>`: purging
  Cloudflare cannot reach a browser, so only the edge gets a long lifetime.
  Hashed assets are unaffected.
- **A request carrying `Cookie` or `Authorization` is never served from, or
  written to, the shared cache**, and such a response leaves with
  `private, no-store` and no `Cache-Tag`.
- The admin moved from Preact to React 19. First load is 73.4 KiB gzip against
  a 150 KiB budget — the reason Preact was originally chosen turned out not to
  hold once it was measured.

### Fixed in the CLI

- The published CLI **did nothing when installed**. Its entry-point guard
  compared `argv[1]` against `cli/index.js`, which npm's
  `node_modules/.bin/mallok` symlink is not — so it exited 0 with no output
  and no error. It now compares real paths.
- `mallok --help` exited **1**, so any script checking the status read a
  working install as broken. An explicit help request now succeeds.
- The published manifest claimed **MIT** while the project is Apache-2.0, and
  shipped neither the licence, the notice, nor a readme. All four are fixed,
  and `test/cli/packaging.test.ts` checks the built artifact rather than the
  source, because every one of these bugs was invisible in the source.

### Not in 0.1

Static pre-rendering, streaming, and moving `sitemap.xml` / `robots.txt` /
`feed.xml` onto the runtime's router. The SEO endpoints work and are tested;
moving them would be churn.

## [Unreleased]

Everything below is written and passes locally.

### Added

- Two-stage rendering: Markdown to a sanitised fragment on save, fragment to
  a page on request. Deterministic — the same Markdown, pipeline version and
  theme version produce byte-identical HTML.
- D1 schema with self-migration on first request, and a migration lock so
  concurrent cold starts cannot race.
- Worker request path with an edge cache keyed by origin, purged by cache tag.
- Authentication and the full management API under `/_mallok/`.
- Media pipeline: browser-side and CLI-side image processing, R2 storage,
  responsive `srcset` output. No image work happens in the Worker.
- SEO endpoints: `sitemap.xml` with `hreflang` and `x-default`, feeds,
  `robots.txt` that refuses indexing on any host but the bound domain.
- Multilingual content model — `locale` plus `translation_group`,
  locale-prefixed URLs, automatic `hreflang`.
- Plugin runtime with `onRequest`, `beforeRender`, `afterRender`,
  `onContentSave`, `scheduled`, `exportFiles` and `checkSecrets` hooks, and
  the official `inquiry` plugin (Turnstile, Resend, admin panel, CSV export).
- Five themes with no client-side JavaScript: `atelier`, `gazette`,
  `manual`, `folio`, `journal`.
- Admin single-page app served from Static Assets, 16.9 KB gzip first load.
- Import and export of content bundles (`index.md` plus `images/`), with
  round-trip assertions.
- CLI: `publish`, `import`, `export`, `media push`, `create`, `destroy`,
  `preview`, `build`.
- `mallok build` — a complete static site from a local directory, with no D1
  and no network. Same `src/core` renderer as the Worker.
- `content/` and `site.json` in the repository root as the single content
  source: the setup wizard imports them into D1, and `mallok build` compiles
  the same files into a static site.
- `trade-b2b` starter and a four-step setup wizard.

### Known gaps

- No acceptance criterion is verified against real infrastructure.
- `mallok create` and `mallok destroy` have never been executed.
- Setup wizard steps for the media domain and Resend DNS are not built.
- Lighthouse and axe have never been run.
- `docs/` is written in Chinese; English versions are outstanding.
