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
mallok create <dir>               Create a project, verify it, then deploy it
mallok upgrade --to <version>     Move a project onto another Mallok release
mallok prepare                    Stage the admin and theme assets for a build
mallok publish <dir>              Publish one or more bundles (published by default)
mallok import <dir>               Import (keeping whatever status the front matter says)
mallok export <dir>               Export the whole site to a directory
mallok build <dir>                Compile a local directory into a static site
mallok preview <dir>              Render bundles locally, offline
mallok media push <dir>           Upload media only, touching no content
mallok setup-key                  Issue a new one-time key for a site nobody owns yet
mallok repair <slug>              Record the Cloudflare account, or adopt a pending resource
mallok destroy <slug>             Delete a site's Worker, database and bucket
```


**Every flag is declared per command, and an undeclared one fails.** A
misspelling used to be accepted and ignored, so `mallok create site
--no-deply` provisioned a real database and a real bucket while its user
believed they had asked it not to. For the same reason a switch is a boolean:
`--dry-run`, `--dry-run=true` and `--dry-run=false` are accepted, and
`--dry-run=yes` is refused rather than guessed at — `--dry-run=true` used to
parse as the string `"true"`, which every check downstream read as false.

Arguments accepted everywhere:

| Argument | Meaning |
| --- | --- |
| `--json` | Machine-readable output, for CI and AI content pipelines |
| `--verbose`, `-v` | Print every request |
| `--help`, `-h` | Usage |
| `--version` | The installed version |

Arguments the site commands (`publish`, `import`, `export`, `media push`) take:

| Argument | Meaning |
| --- | --- |
| `--site <slug>` | The target site from `.mallok/sites.json`. With one site it is implied; with several, omitting it is an error |
| `--url <origin>` | Address the site directly, bypassing the registry |
| `--token <token>` | The API token; defaults to the `MALLOK_TOKEN` environment variable |
| `--dry-run` | Report what would happen and write nothing |

### 3.1 Which package manager

**npm, and only npm.** `mallok create` and `mallok upgrade` install with npm,
write a `package-lock.json`, and refuse to run in a project that carries a
`pnpm-lock.yaml`, `yarn.lock` or `bun.lockb` rather than installing beside
somebody else's lockfile.

There is no `--package-manager`. rc.3 advertised pnpm as a second supported
manager, and nothing in the suite ever created, upgraded or reinstalled a
project with it — so "supported" meant "we believe it would work". One
verified path is worth more than two claimed ones. npm is the one that ships
with Node, and Node 22 is the only documented prerequisite.

Working *on* Mallok itself still uses pnpm (`README.md`); that is this
repository's own toolchain and has nothing to do with the projects the CLI
generates.

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

Follows the order in `CLOUDFLARE_RESOURCES.md §6`, not repeated here.
The essentials:

- It takes a **directory**, and creates a project in it from the shell the
  package carries: `mallok create my-site`. That project holds the site —
  configuration, content, theme choice, plugins and a four-line Worker entry —
  and depends on `mallok` at an **exact** version for everything else
  (`docs/PRODUCT_CONTRACT.md §1`).
- The Cloudflare resource slug defaults to that directory's name and is
  overridden with `--slug`. They are usually the same word and do not have to
  be — a directory can be `.`, and a slug cannot.
- It uses `wrangler login`'s OAuth identity throughout and **never asks the
  user to mint a token by hand**, and it calls the **project's own** Wrangler,
  at the version its lockfile pinned, rather than whatever `npx` would fetch.
- **Nothing on Cloudflare is touched until the generated project has been
  configured, installed, built and passed `wrangler deploy --dry-run`
  locally** — and the configuration that dry-run checks is the *final* one,
  with the real Worker name, bucket, rate-limit namespace and custom domain in
  it. A project that cannot build must not leave resources behind (`§4.1`).
- Before the first change to the account it asks three read-only questions:
  which account is signed in, and whether a Worker, database or bucket of
  these names already exists. **An existing resource this project did not
  create is refused**, not adopted: it may belong to another site.
- `--no-deploy` stops after that local verification; `--dry-run` does the same
  in a temporary directory and removes it.
- `--account-id <id>` names the Cloudflare account to act on, and is checked
  against `wrangler whoami` before anything is created; it is then passed to
  every Wrangler subprocess.
- `--rate-limit-namespace <n>` overrides the namespace derived from the slug.
  The derivation is a 32-bit hash, so it is collision-**resistant**, not
  unique (`docs/CLOUDFLARE_RESOURCES.md §4`); this is the remedy when two
  slugs on one account do collide, and it avoids the alternative of renaming
  the site — which would rename its Worker, database and bucket too. The value
  used is recorded in the ledger, so a resumed run deploys the same limiter.
- Every resource it creates is recorded in `.mallok/create-state.json` before
  the call that creates it — names, ids and the account, and **never a secret
  value**. Running `mallok create . --slug <slug>` from inside the project
  resumes from there: nothing is regenerated, and what already exists is not
  created twice. That is also how a `--no-deploy` project is deployed later.
  A ledger that cannot be read or does not parse **stops the run**; treating
  it as absent is how a resumed run creates a second database beside the one
  it cannot see.
- Running it on a **finished** project does nothing at all and exits 0: no
  deploy, and no new `MALLOK_SECRET`. Rotating that secret signs every user
  out and makes stored plugin keys unreadable, so secrets are reconciled by
  name — Cloudflare will say whether one of that name exists, which is enough.
- It prints a **one-time setup key** and does not store it. The first-run
  wizard will not create the administrator without it, so a deployed site
  cannot be claimed by whoever finds its address first; the key stops working
  the moment setup succeeds.
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

Deletes the Worker, the database and the bucket, in that order
(`CLOUDFLARE_RESOURCES.md §10`). **Every step prints its result, a resource
that is already gone counts as done, and the first failure stops the run with
an explanation rather than being skipped.**

It reads **both** records: `.mallok/sites.json`, written when a create
finishes, and `.mallok/create-state.json`, written before the first resource
is created. A run that died halfway through `create` never reached the
registry, and used to be undeletable by this command — the resources existed,
the ledger named them, and nothing could act on it.

Three refusals:

- `--confirm <slug>` must repeat the slug, or nothing is deleted;
- it stops if the current Cloudflare account is not the one the ledger
  records, because a same-named resource on another account is somebody
  else's site;
- before deleting anything it checks the **database's UUID**. The ledger
  records the id Cloudflare reported when the database was created; a name is
  reusable, so a database of that name today may be one somebody else made
  after a previous site was destroyed. A mismatch stops the run, and so does
  a failure to read the id — "could not check" is not "it matches". (`d1
  delete` in the locked Wrangler takes a name or a binding, not a UUID, so
  the delete is still by name; the check is what makes that name refer to the
  right thing at the moment it is used. R2 and Workers have no such id.)
- it tries the **bucket first** and stops there if Cloudflare refuses because
  it is not empty — before the Worker and the database are gone, because the
  opposite order leaves a site that is down with two resources still billing
  and nothing to serve its pages.

There is **no `--empty-bucket`**. The flag existed, was documented as deleting
every object first, and was built on `wrangler r2 object list` — a subcommand
Wrangler 4.124.0 does not have, so it would have failed the first time anybody
used it. Emptying a bucket is dashboard work until a supported API exists;
`destroy` says so and resumes at the bucket when it is run again.

What it cannot do, and says so at the end: R2 and Worker custom domains, DNS
records, the Turnstile widget and `CF_API_TOKEN` are dashboard work.

## 10.1 `mallok upgrade --to <version>`

Moves a project onto another Mallok release:

1. sets the **exact** version in `package.json` (a range is refused — an
   upgrade is a decision, not something an install does to you);
2. installs it;
3. runs the project's **own** checks — `typecheck`, `test`, `build` and
   `wrangler deploy --dry-run`. They run against the package that was just
   installed, which is what makes them the target version's checks rather
   than the previous version's idea of them;
4. on any failure, restores `package.json` and the lockfile **and reinstalls
   the previous version**, so the files and `node_modules` agree.

Versions are compared with `semver`, which matters more than it sounds:
`0.1.0-rc.10` is newer than `0.1.0-rc.2`, and build metadata does not affect
precedence. A hand-rolled comparison compared pre-release tags as strings and
therefore refused rc.2 → rc.10 as a downgrade — a bug that would have appeared
on the tenth release candidate and not one release earlier. Downgrading is
still refused: a release can migrate a database forward and there is no
general way back.

Running it again on the same version changes nothing and exits 0 — but that
is **checked**, not read off `package.json`. A manifest saying 2.0.0 beside a
lockfile and a `node_modules` holding 1.0.0 is a run that was interrupted
after the manifest was written, and it needs the install it never finished.
The comparison there is exact rather than semver precedence: `1.0.0+build.1`
and `1.0.0+build.2` compare equal under semver — build metadata is explicitly
not precedence — and they are not the same artefact.

### What protects the two files it edits

`package.json` and the lockfile are the only state an upgrade touches, and a
site cannot afford to lose either.

- **A readable `package-lock.json` is required up front.** The rollback
  restores it; a rollback that cannot restore what it never read leaves the
  manifest on the old version beside a tree holding the new one.
- **Another package manager is refused, not worked around**:
  `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, **`bun.lock`** (Bun's newer
  text format), **`npm-shrinkwrap.json`** — which overrides
  `package-lock.json`, so an install would resolve from it and could pin the
  version being upgraded away from — and a `packageManager` field naming
  pnpm, yarn or bun, which is what Corepack reads.
- **An exclusive lock**, `.mallok/upgrade.lock`, taken with an
  `O_EXCL` create. Two upgrades in one directory would both read the same
  "before", and the loser would restore a manifest the winner had already
  replaced.
- **A journal**, `.mallok/upgrade-journal.json`, holding the bytes of both
  files, written *before* the manifest changes and removed only when the run
  has finished or been undone. Every write goes through a temporary file in
  the same directory and a rename, so a reader sees one version or the other
  and never half of one. The next `mallok upgrade` in that project recovers
  from it first.
- **The rollback verifies what it restored.** It reinstalls with `npm ci` —
  not `install`, which is free to rewrite the lockfile it just put back — and
  then checks the version that actually landed in `node_modules`.

`.mallok/` is git-ignored, so neither the lock nor the journal reaches a
site's repository.

### What this deliberately does not do

There is **no project-file migration system**, and there is no staging copy.

An earlier version had both. It copied the whole project into a temporary
directory, installed the target there, handed control to that release's own
binary over a small inter-version protocol (`upgrade-finalize`) so it could
apply the migrations *it* carried, ran the checks in the copy, and swapped the
copy over the original with a rename. The reasoning behind it was sound: a
release that has to rewrite a file in somebody's project should be the release
that decides how, and a half-applied rewrite should never reach the real
directory.

It guarded zero migrations. `PROJECT_MIGRATIONS` was empty in every published
release, so the machinery protected nothing while contributing failure modes
of its own — most obviously a failure between the two renames, which leaves no
project at all. It also wrote a tracked `mallok.json` at the project root,
which is already the name of the per-bundle sidecar in
`docs/CONTENT_FORMAT.md §6`.

When the first real project migration exists, this gets designed again with
that migration in front of us. A mechanism built for a migration nobody has
written is a guess about what that migration will need.

## 10.2 `mallok prepare`

Copies the compiled admin application and the official themes' assets out of
the installed `mallok` package into the project's `dist/assets`, and validates
and stages a theme in `src/theme/` if the project has one. It runs before
every build and every deploy, and rebuilds the directory each time so a stale
asset from an older version cannot survive an upgrade.

### 10.2.1 Why neither `create` nor `setup-key` takes `--json`

Both print a one-time setup key, and there is no safe place for a credential
in machine-readable output: `--json` is what gets piped into a file or a CI
log, and a key that lands there outlives its single use by however long that
log is kept. Printing it *beside* the JSON would be worse — it corrupts the
document and leaks the key.

So the combination is **refused**, and refused before anything remote happens.
A refusal after `secret put` would have rotated a key nobody then received.
These two commands need an interactive terminal.

A machine-readable path for them is a real gap. It needs a design — a file at
an explicit path with restrictive permissions, say — rather than a field in a
document whose whole purpose is to be collected, and that design is not part
of 0.1.

Both commands hand the key over through the same awaited write (`src/cli/
deliver.ts`) and record `setupKeyDeliveredAt` **only once the stream has
accepted it**. An interrupted hand-over therefore leaves the site marked
undelivered, and the next run rotates and shows a new key rather than leaving
a site whose key exists on the Worker and is known to nobody.

## 10.3 `mallok setup-key`

Issues a new `MALLOK_SETUP_KEY` for the site in this directory and prints it
once.

The key `mallok create` prints exists only in a terminal — it is deliberately
written to no file, because a credential in a committed file outlives its one
use. The cost of that is that it can be lost: a closed window, a killed
process, a scrolled-off buffer. Cloudflare never gives a secret's value back,
so without this command a lost key means a deployed site that can never be
set up and never be recovered.

What makes issuing a new one safe is a single question, asked rather than
assumed: **does this site already have an administrator?**

| Answer | What happens |
| --- | --- |
| Yes | Refused. The key is spent; whoever is asking is either the owner, who should sign in, or somebody who should not be here |
| No | A new key is set and printed once |
| **Cannot tell** | **Refused.** An unreachable site is not a site with no administrator, and treating the two alike would let anyone who can reach the Cloudflare account claim a site that is already owned |

It also refuses when the ledger records a different Cloudflare account from
the one signed in, and reports a failed `secret put` rather than returning a
key the Worker does not have — a key that does not work is worse than no key,
because it is tried and refused with nothing saying why.

`--account-id <id>` is checked against `wrangler whoami` first, as everywhere
else.

## 10.4 `mallok repair <slug>`

Nothing in this CLI acts on a Cloudflare resource it cannot prove belongs to
the project, and the proof is the **account id** recorded when the resource
was created. That default is right, and it leaves a gap: a project whose
records lost their account id — an old registry, a hand-edited file, a
half-finished `create` — becomes undeletable and unrecoverable by the checks
meant to protect it. This is the deliberate way out.

It never creates or deletes anything on Cloudflare. It does two things:

**Record the account.** It asks `wrangler whoami`, and writes that id into the
ledger and `.mallok/sites.json`. With `--account-id <id>` the id must match
what Wrangler reports, so this cannot be used to *assert* an account the
current login cannot reach. A record that already names a **different**
account is refused rather than overwritten — that record is a statement, and
overwriting it would reopen the hole this closes.

The account check is **not** relaxed by `--adopt`. A record that names a
different account is refused whatever else was asked for: adopting is the
operation that points a site at a resource, so it is the last one that should
skip it.

Filling in a *missing* account id takes more than `whoami`. If the records
already name a D1 UUID, the database of that name on the signed-in account
must report the same one; otherwise the records describe a different site and
nothing is written.

**Adopt a pending resource, by name.** `--adopt database,bucket,worker`
(comma separated; an unknown name is refused rather than silently skipped).

Adopting a **database** also needs `--expect-id <uuid>`: the id the operator
read, repeated back. Between `create` printing what it found and somebody
running this command, the resource under that name can be replaced, and an
adoption that cannot tell the difference adopts whatever is there now.

**R2 buckets and Workers have no comparable id**, and this is not pretended
otherwise. Wrangler reports nothing stable for either, so the evidence is the
account plus the name — weaker than a UUID. Those adoptions are listed under
`unverifiable` in the JSON output so that the difference is visible rather
than implied away.

A `create` interrupted between "about to make the database" and "made it"
leaves a `pending` record, and possibly a real resource. Earlier versions
reconciled that pair automatically — same account, same name, so it must be
ours. It is a guess: on a shared account a same-named database belongs to
whoever made it, and pointing a site at it means running that site's
migrations against their data. `create` now stops and prints both halves —
what Cloudflare reports, including the id, and what the ledger believes — and
this is how a person says *yes, that one is mine*:

```sh
mallok repair my-site --adopt database
mallok create .              # resumes, and does not create a second one
```

Adoption is refused when the resource is not actually on the account, so a
stale `pending` cannot be claimed into existence.

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
