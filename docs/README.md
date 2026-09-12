# Mallok documentation

Mallok is an open-source, Cloudflare-native content website: content lives as
Markdown in D1, an edit is live immediately, there is no build step, and the
content can be taken elsewhere at any time. The first vertical is
foreign-trade B2B company sites.

> **English is the primary language of this project and the authoritative
> version of every document here.**

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

## Status

- **Implementation**: all seventeen tasks are implemented and `pnpm test`
  exits 0 — the number of tests is not written here, because it drifts and
  the command prints it. The Worker is 290.0 KiB gzip, well inside Mallok's
  own 3 MiB gzip budget.
  (Cloudflare's own limit is 64 MiB uncompressed on either plan; the
  "free-plan ceiling" this line used to cite does not exist.)
- **Verification**: **Gate A ran for real 2026-09-03/04** — seven of the nine
  `ARCHITECTURE.md §18` measurements against a real Cloudflare account, the
  other two needing a public repository and Turnstile/Resend accounts.
  `mallok create` ran end to end and found a real deploy-breaking bug (fixed).
  See [ACCEPTANCE.md §14](ACCEPTANCE.md) for the criterion-by-criterion
  evidence: 5 criteria are now `VERIFIED_HUMAN` and 10 still need a real
  account for other reasons. Two findings briefly raised a wording or
  implementation question rather than settling one — a content-length safety
  net for `AC-CONTENT-10` (2026-09-05) and a purge-latency reword for
  `AC-CONTENT-02b` (2026-09-06) — both are now closed and no criterion is
  `PENDING_DECISION`.
- **Distribution**: nothing published to npm; the repository is private.
- **Licence**: Apache-2.0.

## Open gates

Gate A is done — see [tasks/TASK-01.md §5](tasks/TASK-01.md) for the full
results and [ARCHITECTURE.md §18](ARCHITECTURE.md) for what they mean. Ten
acceptance criteria remain `NOT_AVAILABLE` for reasons Gate A could never have
closed: a public repository, a second real deployment, elapsed real time or
cron, and Resend/Turnstile/Lighthouse accounts
([ACCEPTANCE.md §14.4](ACCEPTANCE.md)). Both of Gate A's own findings that
raised a wording or implementation question are now settled: stage-one CPU
routinely running past the Free plan's budget was settled 2026-09-05 —
`saveContent` now skips rendering and saves a draft instead, past a
conservative length threshold — and purge latency (≈ 20 s) was settled
2026-09-06, reworded from "within seconds" to "within a minute"
([ACCEPTANCE.md §14.2](ACCEPTANCE.md), items 6–7).

The Markdown engine question was settled on 2026-08-29: **stay with unified**.
The reasoning and its cost are in [tasks/TASK-01.md §6](tasks/TASK-01.md) —
Gate A's real CPU numbers now make this a live decision again (item 7 above).

Whether to keep inline HTML was settled on 2026-09-02: **keep it, sanitised**
— `rehype-raw` was added ([SECURITY.md §4](SECURITY.md),
[TECH_STACK.md §11.1](TECH_STACK.md)).

The earlier "macOS desktop Studio plus build-time prerendering" design was
abandoned in full. It survives in git commit `2e775cb` for reference only and
is not a basis for any implementation.
