# The Mallok product contract

- Status: canonical. Written 2026-09-11.
- Scope: what Mallok is, what belongs to it, and what decides a design
  argument.

This is the document to read first and the one that wins. Where
`CLAUDE.md`, `docs/PRODUCT_VISION.md`, `docs/ARCHITECTURE.md` or
`docs/CONVENTIONS.md` disagree with it, they are out of date and this is the
text to correct them against.

## 1. What Mallok is

**Mallok is a complete, open-source, Cloudflare-native framework for content
websites.** Routing, rendering, the restricted Liquid engine, Markdown, React
islands, SEO, the edge cache, the Cloudflare adapter, the management API, the
admin application, the CLI, the theme format and the plugin system are all
part of it, and they are shipped together as one npm package.

It was described for a year as "a content website product, not a framework".
That was a useful thing to say while the only deployment was this repository,
and it stopped being true the moment a site became a project that *depends on*
Mallok rather than a copy of it. The comparison people reach for is Astro: a
framework you install, with a real product on top of it.

Both halves are the deliverable:

| | What it is | Where it lives |
| --- | --- | --- |
| The framework | The `mallok` package: CLI, framework entry, runtime, admin assets, official themes and plugins, project template | `src/**` in this repository, published as `mallok` |
| A site | Its configuration, content, theme choice and plugins — and a four-line Worker entry | The user's own repository, created by `mallok create` |

A site depends on **an exact version** of the package. Upgrading is
`mallok upgrade --to <version>`: a decision, not something an install does on
its own, and not a merge against a fork.

## 2. What belongs where

- **The page runtime is internal.** It lives at `src/runtime` and is part of
  Mallok. It was briefly planned as a separate repository and an
  `@fobstack/runtime` npm package; that plan is cancelled and is not to be
  revived (`docs/ARCHITECTURE.md §3.1`). One consumer, a high cost to split,
  and the capabilities that would have justified it belong in the starter,
  theme and plugin APIs instead.
- **Nundar is a Mallok starter, theme and plugin set.** A commerce site built
  *on* Mallok, not a second engine beside it. It has no bearing on this
  release and nothing in this repository is shaped for it in advance.
- **Fobly is a separate CRM.** It integrates through stable APIs and events.
  It does not use the page runtime and shares no business model with Mallok.

## 3. The mission

Let a trading company put a real site on the internet, on infrastructure they
own, for as close to nothing as Cloudflare's free tier allows — and have it be
fast, reliable and maintainable rather than merely cheap.

Which means, concretely, and in this order:

1. It starts on the Cloudflare **free tier** and keeps working there. Every
   design is budgeted against free-tier limits; "upgrade to Paid" is never the
   answer to a design problem.
2. The user owns the code, the data and the domain. Content exports to plain
   Markdown at any time, and an export can be carried to a fresh deployment.
3. Upgrading is a version number, and it does not risk the content.
4. Editing content takes effect immediately — no build, no deploy.
5. Growth is a plan change, not a migration: moving to Workers Paid changes no
   architecture.

"Free-tier-first" is not a promise that Cloudflare will be free forever. Where
quotas, prices or limits are discussed, check the current official
documentation and state the free boundary, what happens past it, and the path
beyond.

## 4. About the acquisition thesis

Cloudflare acquiring or investing in Fobstack is a **long-term strategic
hope**. It is not an engineering acceptance criterion, it is not a reason to
adopt a Cloudflare product that does not earn its place, and it never
outranks the things below.

When a decision is contested, this is the order:

1. Real user value, and user trust.
2. Security, correctness, reliability, data integrity.
3. Adoption: how quickly somebody can get a site running and keep it running.
4. Ecosystem compatibility and upgradeability — including the ability to leave.
5. Sustainable maintenance.
6. Strategic alignment with Cloudflare.

A feature that would improve (6) at the cost of (1) through (5) does not get
built, whatever it would look like in a deck.

## 5. Boundaries that have not changed

These survive from `docs/PRODUCT_VISION.md` and `CLAUDE.md` unaltered, and are
repeated here because they are the ones most often argued with:

- Content is standard Markdown with YAML front matter, stored in D1, with
  images referenced by relative path. HTML is derived data.
- Themes and plugins are **build-time**. Switching a theme, installing a
  plugin or upgrading Mallok needs a deploy. Enable switches and settings are
  database state and take effect immediately. The interface must keep those
  two things apart and must not pretend to hot-swap.
- Visitor pages send **no client-side JavaScript** by default. The documented
  exceptions are the inquiry plugin's Turnstile widget and Atelier 2.5’s
  declared homepage-only manual carousel, approved on 2026-09-18. Other
  Atelier pages remain script-free.
- `mallok build` remains a parallel path for sites that do not want D1: a full
  static build from local files, with the documented costs (no inquiry form,
  no admin, rebuild to publish).
- 0.1 targets Cloudflare only, Resend only, and does not do hosting, accounts,
  billing, multi-tenancy, collaborative editing, carts or payments.

## 6. How documents relate

| Document | What it is for |
| --- | --- |
| This file | What Mallok is and what wins an argument |
| `docs/PRODUCT_VISION.md` | Why the product exists, who it is for, what it promises |
| `docs/ARCHITECTURE.md` | How it is built |
| `docs/TESTING.md` | What counts as verified, and the only status vocabulary |
| `docs/RELEASE_GATE.md` | What a release needs from a real account |
| `CLAUDE.md` | Working conventions for this repository |

Counts that drift — how many tests exist, how many criteria are verified — are
not written into prose. Documents name the command and the threshold; the
number comes from running it.
