# Mallok documentation

Mallok is an open-source, Cloudflare-native content website: content lives as
Markdown in D1, content edits require no rebuild; cache invalidation controls visibility, and the
content can be taken elsewhere at any time. The first vertical is
foreign-trade B2B company sites.

> **English is the primary language of this project and the authoritative
> version of every document here.**

## Start here

[Create your first site](GETTING_STARTED.md): install, deploy, finish setup,
publish a product and configure inquiries.

## Design documents

Read in order. The first six are the product and architecture contract; the
rest are the contracts for individual subsystems.

| Document | Contents |
| --- | --- |
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | What Mallok is, the first vertical, who it is for, the promises, what 0.1 delivers, the cost ladder, the success pictures, the roadmap, the non-goals, the known risks |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Hard constraints, system parts, the request path, two-stage rendering, the three cache layers, the content model, media, multilingual, themes, starters, plugin capabilities, the inquiry path, security boundaries, deployment and migration, what is still unmeasured |
| [TECH_STACK.md](TECH_STACK.md) | Runtime, the four dependency layers and their hard rules, external services, the admin app, the CLI, the dependency gate, what is explicitly forbidden, external sources |
| [CONTENT_FORMAT.md](CONTENT_FORMAT.md) | The content bundle format, relative-path rules, common front-matter fields, the import/export contract, missing-image state |
| [DATA_MODEL.md](DATA_MODEL.md) | The 0.1 D1 schema, indexes, constraints, migration and garbage-collection rules |
| [CLOUDFLARE_RESOURCES.md](CLOUDFLARE_RESOURCES.md) | Account topology and quotas, the per-site resource list and naming, the wrangler template, creation order, how the Deploy button path would differ once it exists (`NOT_AVAILABLE` in 0.1), environments, site registry, backup and deletion |

## Subsystem contracts

| Document | Contents |
| --- | --- |
| [THEME_FORMAT.md](THEME_FORMAT.md) | Theme package structure, `theme.json`, content kinds and field schemas, the view contract, the restricted Liquid subset, language packs, install and switch semantics |
| [PLUGIN_API.md](PLUGIN_API.md) | `plugin.json`, the hooks, the capabilities, the context objects, lifecycle, size budget, the official `inquiry` plugin |
| [ADMIN.md](ADMIN.md) | Admin information architecture, the setup wizard, the content editor, the schema-driven form generator, the media library, the quality gates |
| [CLI.md](CLI.md) | Commands, arguments, authentication, idempotence rules, exit codes, error-message rules |
| [SEO_PERFORMANCE.md](SEO_PERFORMANCE.md) | The SEO output built into the core, hreflang, structured data, the performance budget and how it is measured |
| [SECURITY.md](SECURITY.md) | Trust levels, credential handling and the encryption format, authentication, sanitisation, upload validation, error hygiene, and **what is deliberately not defended against** |

## Process documents

| Document | Contents |
| --- | --- |
| [CONVENTIONS.md](CONVENTIONS.md) | The boundaries a change is held to: what the product is, what the engineering may not do, style, fact discipline, working rules |
| [TESTING.md](TESTING.md) | Test layers, the checklist for hard contracts, the coverage gate, the evidence format and its status values |
| [ACCEPTANCE.md](ACCEPTANCE.md) | The 0.1 release gate, acceptance criteria grouped and numbered, cross-stage invariants, blockers |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | The task sequence, the gates, the dependency graph, the definition of done per task |
| [tasks/](tasks/) | One document per task: what was implemented, the decisions taken, deviations from the design, the evidence, and what is left. Already written in English. |

## Current release status

See [RELEASE_STATUS.md](RELEASE_STATUS.md) for the September 18, 2026 RC
snapshot, measured results, accepted CPU limitation, and remaining work.
Older task reports are historical evidence, not the current release summary.

## Translations

English is primary. [Chinese documentation](zh-CN/README.md) supplements the
English references; its index identifies which pages are translated.
