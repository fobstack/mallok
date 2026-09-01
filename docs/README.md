# Mallok documentation

Mallok is an open-source, Cloudflare-native content website: content lives as
Markdown in D1, an edit is live immediately, there is no build step, and the
content can be taken elsewhere at any time. The first vertical is
foreign-trade B2B company sites.

> **Translation is in progress.** English is authoritative for a document
> once it has been translated; the Chinese original then moves to
> [`zh/`](zh/). Documents still marked below as *not yet translated* are
> Chinese at their canonical path, and are the authority until they are.
>
> Translated so far: this index, `CONTENT_FORMAT.md`, `CLOUDFLARE_RESOURCES.md`,
> `CONVENTIONS.md`, `THEME_FORMAT.md`, `PLUGIN_API.md`, `ARCHITECTURE.md`,
> `CLI.md`, `SECURITY.md`, `DATA_MODEL.md`, `TECH_STACK.md`, `TESTING.md`,
> `SEO_PERFORMANCE.md`, `ADMIN.md`.

## Design documents

Read in order. The first six are the product and architecture contract; the
rest are the contracts for individual subsystems.

| Document | Contents |
| --- | --- |
| [PRODUCT_VISION.md](PRODUCT_VISION.md) *(zh)* | What Mallok is, the first vertical, who it is for, the promises, what 0.1 delivers, the cost ladder, the success pictures, the roadmap, the non-goals, the known risks |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Hard constraints, system parts, the request path, two-stage rendering, the three cache layers, the content model, media, multilingual, themes, starters, plugin capabilities, the inquiry path, security boundaries, deployment and migration, what is still unmeasured |
| [TECH_STACK.md](TECH_STACK.md) | Runtime, the four dependency layers and their hard rules, external services, the admin app, the CLI, the dependency gate, what is explicitly forbidden, external sources |
| [CONTENT_FORMAT.md](CONTENT_FORMAT.md) | The content bundle format, relative-path rules, common front-matter fields, the import/export contract, missing-image state |
| [DATA_MODEL.md](DATA_MODEL.md) | The 0.1 D1 schema, indexes, constraints, migration and garbage-collection rules |
| [CLOUDFLARE_RESOURCES.md](CLOUDFLARE_RESOURCES.md) | Account topology and quotas, the per-site resource list and naming, the wrangler template, creation order, how the Deploy button path differs, environments, site registry, backup and deletion |

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
| [ACCEPTANCE.md](ACCEPTANCE.md) *(zh)* | The 0.1 release gate, acceptance criteria grouped and numbered, cross-stage invariants, blockers |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) *(zh)* | The task sequence, the gates, the dependency graph, the definition of done per task |
| [tasks/](tasks/) | One document per task: what was implemented, the decisions taken, deviations from the design, the evidence, and what is left. Already written in English. |

## Status

- **Implementation**: all seventeen tasks are implemented; 344 tests pass;
  the Worker is 232.3 KiB gzip, 7.6% of the free-plan ceiling.
- **Verification**: **nothing has ever run against a real Cloudflare
  account.** See [ACCEPTANCE.md §14](ACCEPTANCE.md) for the criterion-by-criterion
  evidence. `mallok create` and `destroy` are written but never executed.
- **Distribution**: nothing published to npm; the repository is private.
- **Licence**: Apache-2.0.

## Open gates

1. **The nine measurements in [ARCHITECTURE.md §18](ARCHITECTURE.md)** — to be
   taken on a real Cloudflare account following [tasks/TASK-01.md §4](tasks/TASK-01.md).
   Seventeen acceptance criteria are waiting on this.
2. **Whether to keep inline HTML** (whether to add `rehype-raw`) — see
   [tasks/TASK-01.md §6](tasks/TASK-01.md) and [SECURITY.md §4](SECURITY.md).

The Markdown engine question was settled on 2026-08-29: **stay with unified**.
The reasoning and its cost are in [tasks/TASK-01.md §6](tasks/TASK-01.md).

The earlier "macOS desktop Studio plus build-time prerendering" design was
abandoned in full. It survives in git commit `2e775cb` for reference only and
is not a basis for any implementation.
