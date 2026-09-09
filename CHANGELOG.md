# Changelog

Notable changes to Mallok. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
