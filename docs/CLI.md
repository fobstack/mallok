# The Mallok CLI

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: defines the `mallok` command-line tool's commands, arguments,
  authentication and exit codes. The CLI is one of three entry points, and is
  **neither a subset nor a superset of the admin**.

## 1. In one sentence

**`mallok` is a Node command-line tool published to npm. It calls exactly the
same management API over HTTPS that the admin does, and reuses `src/core/` for
bundle parsing and local preview, so the same Markdown produces the same body
fragment as production — the preview's media URLs differ, since it runs
offline with no media table (`AC-CLI-03`, `docs/ACCEPTANCE.md §14.2` item
3).**

## 2. Hard constraints

| Constraint | Source |
| --- | --- |
| `node >= 22`, ESM only, usable directly through `npx mallok` | `TECH_STACK §2`, `§8` |
| **The CLI is not a Worker subprocess, and may not have a capability the admin lacks** | `TECH_STACK §8` |
| Same API and same Bearer tokens as the admin | `PRODUCT_VISION §5.9` |
| Reuses `src/core/`, guaranteeing it matches production rendering | `ARCHITECTURE §3` |
| Image processing uses `sharp` (**a CLI-only dependency; never in the Worker**) | `TECH_STACK §4`, `§8` |
| Argument parsing stays lightweight; **no heavy CLI framework** | `TECH_STACK §8` |

`sharp` is a native dependency, and that is allowed: the CLI is a Node
process, exempt from the no-native-libraries rule, which constrains only what
enters the Worker.

## 3. The commands

```
mallok create                     Deploy a new site into your Cloudflare account
mallok publish <dir>              Publish one or more bundles (published by default)
mallok import <dir>               Import (keeping whatever status the front matter says)
mallok export <dir>               Export the whole site to a directory
mallok build <dir>                Compile a local directory into a static site
mallok preview <dir>              Render bundles locally, offline
mallok media push <dir>           Upload media only, touching no content
mallok destroy <slug>             Delete every resource of a site, in order
```

Global arguments:

| Argument | Meaning |
| --- | --- |
| `--site <slug>` | The target site from `.mallok/sites.json`. With one site it is implied; with several, omitting it is an error |
| `--url <origin>` | Address the site directly, bypassing the registry |
| `--token <token>` | The API token; defaults to the `MALLOK_TOKEN` environment variable |
| `--json` | Machine-readable output, for CI and AI content pipelines |
| `--dry-run` | Report what would happen and write nothing |
| `-v, --verbose` | Print every HTTP request |

## 4. Authentication

The CLI uses a **scoped, revocable API token** (`ARCHITECTURE §14`), generated
in the admin.

```sh
export MALLOK_TOKEN=mlk_live_xxxxxxxx
mallok publish ./articles
```

- The token is shown in cleartext once, when it is created. D1 stores
  `sha256(token)` (`DATA_MODEL §2.8`).
- Scopes are checked per operation: `content:write`, `media:write`, `export`,
  `settings:write`.
- **`create` and `destroy` do not use this token** — they operate on
  Cloudflare resources through `wrangler`'s OAuth identity.

The CLI writes the token to no file. `.mallok/sites.json` **holds no secrets**
(`CLOUDFLARE_RESOURCES.md §9`).

## 5. `mallok create`

Follows the ten-step order in `CLOUDFLARE_RESOURCES.md §6`, not repeated here.
The essentials:

- It takes a **directory**, and creates a complete project in it from the
  template the package carries: `mallok create my-site`.
- The Cloudflare resource slug defaults to that directory's name and is
  overridden with `--slug`. They are usually the same word and do not have to
  be — a directory can be `.`, and a slug cannot.
- It uses `wrangler login`'s OAuth identity throughout and **never asks the
  user to mint a token by hand**, and it calls the **project's own** Wrangler,
  at the version its lockfile pinned, rather than whatever `npx` would fetch.
- **Nothing on Cloudflare is touched until the generated project has been
  installed, built and passed `wrangler deploy --dry-run` locally.** A project
  that cannot build must not leave resources behind (`§4.1`).
- `--no-deploy` stops after that local verification; `--dry-run` does the same
  in a temporary directory and removes it.
- It prints the result of each step and **stops with an explanation on the
  first failure rather than skipping ahead**.
- It finishes by opening `/_mallok/setup`, where the wizard takes over.

The default locale and the starter are chosen **in the wizard**, not on the
command line. `--locale` and `--starter` were described here before either was
implemented; there is one place that decision is made, and adding a second
would mean two code paths that can disagree about a site's first state.

**Schema migration runs inside the Worker on its first request; the CLI never
migrates** (`CLOUDFLARE_RESOURCES.md §6`, step 10).

## 6. `mallok publish` and `import`

Both run one pipeline and **differ only in the default status**
(`CONTENT_FORMAT §7.4`):

| | Default status |
| --- | --- |
| `publish` | Published |
| `import` | Whatever the front matter says |

Both accept `--draft` to force a draft.

### 6.1 Input layouts

Three are detected automatically (`CONTENT_FORMAT §7.1`): a Mallok export, a
directory of bundles, and loose `*.md` files.

When a directory name or `--kind` matches no enabled kind, **the import stops
and lists what it could not place. It never guesses, and never quietly files
things under `article`.**

### 6.2 The flow

```
scan the directory → detect the layout → parse each bundle
  → validate front matter against theme.json's field schemas
  → collect relative-path references and hash each file with sha256
  → ask the API which shas already exist
  → for the rest: sharp converts to WebP, generates variants, uploads
  → POST each item, with its assets map
  → print the result table
```

### 6.3 Idempotence

**When a bundle is identical to what is live, the import is a no-op: no D1
write, no cache purge** (`CONTENT_FORMAT §7.2`). The comparison is the text of
each `index*.md` and the sha of every referenced file.

This exists for daily AI content pipelines — an entire directory can be
re-run without consequence.

### 6.4 Identity and conflicts

Handled per the table in `CONTENT_FORMAT §7.2`. With `--create-only`, an
existing item is an error and nothing is overwritten.

### 6.5 Batching

D1 caps a statement at 100 KB and a call at 50 queries (`ARCHITECTURE §2`).
The CLI batches accordingly and **never submits a whole directory at once**.

### 6.6 Reporting missing images, and oversized content

Referencing a file that is not in the bundle is a normal state
(`CONTENT_FORMAT §4`, rule 6). The CLI:

- prints "N items reference M missing files" and lists them;
- reads `image-slots.json` from a bundle, when present, to report which image
  slots have no file yet (`CONTENT_FORMAT §7.5`);
- **warns on publish without blocking**;
- offers `--fail-on-missing` so CI can be strict.

The same "warn, do not block" shape applies to a body past
`MAX_SAFE_RENDER_BYTES` (`ADMIN.md §6.5`, `AC-CONTENT-10`): the item still
publishes into the site as a draft, and the CLI prints the server's warning
against that bundle rather than failing the whole run — a large AI content
pipeline should see the warning, not stop.

Mallok does not interpret other files such as `image-requirements.md`, and
does not upload them.

## 6.7 `mallok build` — the path without D1

```sh
mallok build ./my-site --theme ./src/themes/atelier --origin https://example.com
```

Reads a local directory and produces a complete static site, **touching
neither D1 nor the network**. The layout is the export layout from
`CONTENT_FORMAT §5`, so what `mallok export` produces can be fed straight to
`mallok build`.

```
my-site/
├── site.json          # name, locales, content kinds, navigation, theme options
├── content/
│   ├── article/  product/  category/  faq/ …
└── media/             # optional: media nothing references
```

What it generates: a page per item in every language, a paginated list page
per kind, **tag archives**, a home page and feed per language, `sitemap.xml`
with hreflang and x-default, `robots.txt`, the theme assets, and the images
each bundle references.

**It renders through exactly the same `src/core` functions as the Worker**, so
the same input produces the same bytes. That is precisely why `src/core` may
not import Cloudflare types.

### The repository ships a `content/` that builds as it stands

The `site.json` and `content/` in the repository root **are** this layout —
not a copy of an example:

```sh
pnpm build:site      # → dist/site, 34 pages, two languages
```

Those same files are also the starter's content source:
`src/starters/trade-b2b/index.ts` reads them with
`import … from '../../../content/<kind>/<slug>/index.md'`, and takes its
settings from the root `site.json`. So what the setup wizard imports into D1
and what `mallok build` compiles into a static site are the same files —
editing `content/` changes both paths.

The starter previously kept a second copy under
`src/starters/trade-b2b/content/`, which left anyone forking the repository
unable to see a content directory at all, let alone edit one. That copy is
gone.

`test/cli/content-dir.test.ts` holds the two readings together: a directory
name must be a kind `site.json` declares, the starter's entries must
correspond one-to-one with the bundles on disk, and a translation's `slug`
front matter must equal the one the wizard uses — otherwise the same page
would get two different URLs on the two paths.

### What a static build cannot do

Stated plainly, rather than left for the user to discover:

| Not possible | Why |
| --- | --- |
| **The inquiry form** | A form needs a server to receive it. On encountering `[[inquiry]]` the build **removes the marker and reports it**, rather than leaving a form that does nothing when submitted |
| The admin editor | There is nowhere to write to |
| Instant publishing | Changing content means rebuilding and redeploying |
| Scheduled publishing | The build's own clock decides what counts as published; nothing appears later on its own |

**Broken references are reported**: `category: some-slug-that-does-not-exist`
is caught by the content picker on a site with an admin, and a static build
has no such protection — so it errors explicitly rather than quietly dropping
a link.

## 7. `mallok export`

Produces the directory layout in `CONTENT_FORMAT §5`, with hard guarantees:

- each `index*.md` is **byte-identical to** `content.markdown`;
- `images/` and `files/` are fetched from R2 as originals through the `assets`
  map, named by the map's keys rather than R2's hash names;
- media nothing references goes into the top-level `media/`;
- **the export contains no** `render_cache`, sessions, tokens or anything
  encrypted.

`--include-inquiries` controls `inquiries.csv`, included by default because
being able to take your data with you is a product promise.

## 8. `mallok preview`

Renders locally, **entirely offline**.

```sh
mallok preview ./articles/titanium-price-2026-08 --theme ./src/themes/atelier
```

- Runs both stages through `src/core/`, writing HTML to stdout or `--out <dir>`.
- Reads the theme from a local directory.
- Exists so theme authors and content authors can check before publishing.

Because it runs the same `src/core/`, **the same Markdown produces the same
body fragment** as production (`test/cli/preview.test.ts` asserts this
directly) — which is the entire point of `core/` being forbidden to import
Cloudflare or Node APIs (`CONTRIBUTING.md`, the layering rule). The rendered
page is not byte-for-byte identical, though: with no media table to resolve
against, images stay relative paths (`images/hero.png`) instead of the R2
URLs production emits.

## 9. `mallok media push`

Uploads media and creates `media` rows without creating or modifying content.
For the workflow of preparing images first and publishing later.

## 10. `mallok destroy <slug>`

Follows the nine-step order in `CLOUDFLARE_RESOURCES.md §10`. **Every step is
idempotent, every step prints its result, and the first failure stops the run
with an explanation rather than being skipped.**

The first step is confirming an export exists. `--yes` skips the interactive
confirmation but **does not skip the export check** — that additionally
requires `--i-have-a-backup`.

## 11. Output and exit codes

| Exit code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | User error (arguments, a missing file, failed validation) |
| 2 | Authentication failure (invalid token, insufficient scope) |
| 3 | Remote error (an API 5xx, an exhausted quota) |
| 4 | Partial success (some items in a batch failed) |

With `--json`, a single JSON object goes to stdout and human-readable progress
goes to stderr, so `mallok publish --json | jq` works.

D1 becomes unavailable for the rest of the day when the free tier is exceeded
(`ARCHITECTURE §2`). On that error the CLI must give a **clear, non-technical**
explanation rather than passing a SQL error through.

## 12. Error-message rules

- Never pass through SQL, a bucket name, a database id or a stack trace
  (`CONTRIBUTING.md`).
- A validation failure names **which field of which file**, never
  "invalid input".
- A network failure distinguishes "could not connect" from "the server
  refused", and the latter carries the server's message.

## 13. Deliberately not done

- No local dev server — `wrangler dev` already is one (`TECH_STACK §9`).
- No interactive content editor; that is the admin's job.
- No capability that exists only in the CLI (`TECH_STACK §8`).
- No heavy CLI framework.
- No caching a token to disk.
- No WordPress import (0.2, `ARCHITECTURE §16`).
- No product CSV/Excel import (0.2).
