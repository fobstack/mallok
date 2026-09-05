# Mallok

**An open-source, Cloudflare-native content website. Markdown lives in D1, edits go live within a minute, there is no build step, and your content is always one export away from leaving.** The first vertical is B2B foreign-trade company sites: one-click setup, multiple languages, a product catalog, and inquiries delivered straight to your inbox — starting at $0.

> The editing experience of WordPress, the performance of the edge, open source and never locked in.

## The problem

Content websites today take one of two roads, each with a structural flaw:

- **CMS (WordPress, Ghost)** — great editing, instant publishing. The price is a server, a database and a never-ending stream of security updates.
- **Static generators (Astro, Hugo)** — excellent output and performance. The price is that fixing a typo means a commit, a CI run, a build and a redeploy; non-technical people are locked out.

Foreign-trade company sites concentrate both flaws: several languages, a product catalog, industry news that changes daily and an inquiry form that must not fail — mostly running on dated WordPress templates or yearly-fee site builders. Mallok's bet is that neither price is necessary.

## How it works

Deploy one Worker into your own Cloudflare account. Content is stored as Markdown in D1; images live in R2 behind an R2 custom domain. When you save, the Worker renders the Markdown into an HTML fragment cached in D1; when a visitor arrives, it only applies the theme template and writes the page to the edge cache, so almost every request is served from cache. Saving an article is one database write and one cache purge — live within a minute.

- Three ways in: `npx mallok create`, a Deploy to Cloudflare button, and (in 1.0) a hosted setup assistant

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/FobStack/mallok)

> The button needs a public GitHub or GitLab repository. It reads `wrangler.jsonc` for the database and bucket names, creates them, and prompts for `MALLOK_SECRET` using the description in `package.json`.

- Multilingual content model: every item has a locale and a translation group, URLs are locale-prefixed, `hreflang` is automatic
- Content kinds are declared by the theme; the trade starter ships products, categories, cases, FAQs and news
- Inquiry plugin: native form + Turnstile + database + two-way email via Resend + admin list + CSV export
- Content, settings, theme options and plugin toggles change instantly; themes, plugins and upgrades live in the source tree and take a redeploy — the UI says so rather than pretending otherwise
- A CLI publishes content bundles (`index.md` + `images/`) from disk, ready for AI content pipelines
- Or skip D1 entirely: `pnpm build:site` compiles this repository's `content/` into a static site with the same renderer
- One-click export to plain `.md` folders plus `inquiries.csv` — take it to Astro, Hugo or Obsidian any time
- Every dependency has a free tier; the only upgrade is Workers Paid ($5/month) with no architectural change

## Where your content lives

The repository you fork **is** your site. Its content is real files you edit:

```
site.json               name, languages, content kinds, navigation
content/
├── page/about/index.md         ← one directory per item
├── page/about/index.zh.md      ← its Chinese translation, same directory
├── product/grade-5-titanium-bar/
│   ├── index.md
│   ├── index.zh.md
│   └── images/hero.png         ← images travel with the item
├── category/  case/  faq/  article/
```

Like an Astro collection, one directory per content kind — except each item is
a directory too, so exporting, importing or emailing an article moves its
images with it. The kinds are not a fixed list: they come from `site.json`,
which the theme's declared kinds fill in. Flat `content/article/post.md` files
work as well, and Astro's `pubDate`/`heroImage` and Hugo's `lastmod`/`summary`
front matter are mapped on import.

There is one copy of this. The setup wizard imports `content/` into D1 for the
live site; `pnpm build:site` compiles the same files into a static site. What
the two paths differ on is spelled out in [`docs/CLI.md §6.7`](docs/CLI.md) —
a static build has no inquiry form, no admin, and needs rebuilding after edits.

## Status

**Feature complete locally; Gate A run for real, not yet released.** The rendering core, database schema, Worker request path, edge cache, management API, media pipeline, SEO endpoints, multilingual model, plugin runtime with the official inquiry plugin, five zero-JavaScript themes, the admin app, import/export, the CLI, and the `trade-b2b` starter with its setup wizard all exist and are covered by 357 tests.

**Gate A ran for real 2026-09-03/04** — seven of the nine `ARCHITECTURE.md §18` measurements against a real Cloudflare account, including `mallok create` end to end (which found and fixed a real deploy-breaking bug). [`docs/ACCEPTANCE.md §14`](docs/ACCEPTANCE.md) is the honest status: of 66 acceptance criteria — split into 74 rows where a criterion bundled a testable half with an untestable one — 59 are verified locally, 5 are verified on a real account, and 10 still need a real account for reasons Gate A itself could not close (a public repository, a second real deployment, elapsed real time or cron, and Resend/Turnstile/Lighthouse accounts). No criterion is waiting on a product decision. `mallok create` is proven; the release-gate walkthrough — deploy, wizard, real content, a real inquiry received — has not. Nothing is published to npm, and the repository is private. Treat this as a codebase to try, not a product to deploy.

```sh
pnpm install
pnpm test          # unit tests in Node + integration tests inside workerd
pnpm dev           # wrangler dev on http://127.0.0.1:8787
```

Design documents, starting with [the product vision](docs/PRODUCT_VISION.md)
and [the architecture](docs/ARCHITECTURE.md) — the full set is indexed in
[docs/README.md](docs/README.md).

Contributing guidelines, including the code style, are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). Chosen over MIT for its explicit patent grant and
patent-retaliation clause — the same reason a company's legal review tends to
prefer it.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the code style and the checks a
change has to pass. Report security problems privately through
[a security advisory](https://github.com/FobStack/mallok/security/advisories/new),
never a public issue — see [`SECURITY.md`](SECURITY.md).
