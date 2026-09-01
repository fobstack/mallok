# Changelog

Notable changes to Mallok. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Everything below is written and passes locally. **Nothing has run against a
real Cloudflare account.** See `docs/ACCEPTANCE.md §14` for what is and is
not backed by evidence.

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
