# Mallok

**An open-source website framework for Cloudflare, with Markdown content, a web admin, Liquid themes, and plugins.** Built first for multilingual B2B and export-business websites.

[English](README.md) · [简体中文](README.zh-CN.md)

Deploy to your own Cloudflare account. Store content in D1 and media in R2,
edit through the admin or CLI, and export your content when you need it.
Publishing content does not require rebuilding the website. Changes to code,
themes, and installed plugins require a build and deployment.

## Release status

**0.1.0-rc.6 is a release candidate, not the 0.1 stable release.** Real
Cloudflare deployment, publishing, cache invalidation, and performance tests
were run on rc.5; those measurements do not certify the new rc.6 theme. All 60 requests in the latest CPU sample succeeded, but cold
rendering exceeded the project's 10 ms CPU target in 16 requests. This is a
known performance limitation, not a measured 16-request failure rate.

The maintainer has accepted this limitation for opening the source and
sharing an RC. Remaining verification includes real inquiry email delivery,
the natural seven-day media cleanup window, and production upgrade/rollback.
See [release status](docs/RELEASE_STATUS.md) for measured results and gaps.

**[GitHub](https://github.com/fobstack/mallok/releases/tag/v0.1.0-rc.6) and
[npm](https://www.npmjs.com/package/mallok/v/0.1.0-rc.6) are published.**
Create a site with the explicit candidate version:

```sh
npx mallok@0.1.0-rc.6 create my-site
```

This creates resources and deploys to your Cloudflare account; sign in with
Wrangler first. Add `--no-deploy` to generate and validate a local project
without creating cloud resources.

## Features

- Markdown content in D1; original content remains exportable.
- Multilingual content, locale URLs, canonical links, and automatic hreflang.
- Liquid themes with five bundled designs; content kinds declared by themes.
- React admin for content, settings, media, and plugin configuration.
- A B2B starter with products, categories, cases, FAQs, and news.
- An inquiry plugin integrating Turnstile and Resend; real delivery acceptance
  is still pending for this candidate.
- HTML edge caching and reusable rendered fragments in D1.
- CLI tools for creation, publishing, export, and upgrades.
- An optional static build; static output does not include the admin or
  server-backed inquiry handling.

The runtime is internal to Mallok (`src/runtime`). There is no separate
runtime package to install. Site-level functionality extends Mallok through
its theme, plugin, and starter interfaces.

## Try the source locally

Prerequisites: Node.js 22 or newer and pnpm 10.34.5. See `.nvmrc` for the
repository's test version.

```sh
git clone https://github.com/fobstack/mallok.git
cd mallok
pnpm install --frozen-lockfile
# First checkout only: create local secrets without overwriting an existing file.
(umask 077; set -C; printf 'MALLOK_SECRET=%s\nMALLOK_SETUP_KEY=%s\n' \
  "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .dev.vars)
pnpm dev
```

This starts the framework development environment with local Wrangler
resources. It does not deploy a site or create Cloudflare resources. Open the local URL printed by Wrangler and enter the `MALLOK_SETUP_KEY`
from your local `.dev.vars` into the setup wizard. Keep this file private;
it is ignored by Git. See [Testing](docs/TESTING.md) for browser tests. Run `pnpm test` for unit and integration checks.

The npm package and GitHub attachment are the same verified tarball. See the
[release runbook](docs/RELEASE_GATE.md) for the verification procedure.
The Deploy to Cloudflare button is not available yet.

## Framework and site repositories

This repository develops **the Mallok framework**. A generated site is a
separate, small project depending on an exact `mallok` package version. Its
configuration, content, custom themes, and plugins belong to the site owner;
upgrades do not require merging a fork of this framework.

Content bundles use Markdown files and relative media paths. The setup flow
can import the starter content into D1. Admin edits update D1; they do not
write back to Git. Export creates portable content bundles. See
[content format](docs/CONTENT_FORMAT.md) and [CLI](docs/CLI.md).

## Hosting and caching

Mallok is designed to start on Cloudflare's free allowances. Actual cost and
capacity depend on usage, plan limits, domain registration, and optional
services such as email. Free operation is not an unlimited-service promise.

For automatic cache invalidation, configure `CF_API_TOKEN` with Cache Purge
permission scoped to the site's zone, together with `CF_ZONE_ID`, as Worker
secrets. Without them, visitors can see the previous version until its cache
expires. Never commit credentials. Cloudflare or third-party integrations can
inject JavaScript even where Mallok's theme itself emits none.

## Documentation and contributing

- [Documentation index](docs/README.md) · [中文文档导航](docs/zh-CN/README.md)
- [Release status and known limitations](docs/RELEASE_STATUS.md)
- [Theme format](docs/THEME_FORMAT.md) · [Plugin API](docs/PLUGIN_API.md)
- [Contributing](CONTRIBUTING.md) · [中文贡献指南](CONTRIBUTING.zh-CN.md)
- [Security reporting](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

English is the primary documentation language. Chinese translations supplement
it; untranslated technical references remain linked to their English originals.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) and the distribution's generated
third-party notices for bundled dependencies and font attribution.
