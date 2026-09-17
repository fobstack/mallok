# Mallok content format: bundles and the import/export contract

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: this document defines what a piece of content *is* in D1 and the
  only format in which it enters or leaves Mallok. It is the executable half
  of the no-lock-in promise. No implementation may introduce a private
  structure that is not described here.

## 1. In one sentence

**Every translation of a piece of content, together with the images and
attachments its body references, is an ordinary folder — a content bundle.
What D1 stores is the text of that bundle's `index.md`; exporting puts the
bundle back on disk unchanged.**

## 2. The bundle

```text
titanium-price-2026-08/          # bundle name; defaults to the default locale's slug
├── index.md                     # the default locale
├── index.en.md                  # other locales, locale in the filename
├── index.de.md
├── images/                      # images, shared by every locale
│   ├── hero.jpg
│   └── chart.png
├── files/                       # non-image attachments (datasheets, …), shared
│   └── datasheet.pdf
└── mallok.json                  # optional; identity written by Mallok, see §6
```

Rules:

1. One bundle is one `translation_group`. Each `index[.<locale>].md` is one
   `content` row with its own Markdown, status, slug and URL.
2. `index.md` is in the site's default locale. When a locale appears in the
   filename, the filename wins. A `locale` field in front matter may override
   the filename; if the two disagree, the import fails rather than guessing.
3. `images/` and `files/` are shared within the bundle — different locales may
   reference the same image.
4. The bundle name is a directory name on disk, not an identity. Identity
   lives in `mallok.json` when present, and is otherwise assigned on import.
5. Content with a single locale and no images may degrade to a single
   `slug.md` file (§7.2). Mallok still exports a full bundle.

## 3. `index.md`

Standard Markdown (CommonMark plus GFM) with a YAML front-matter block.
**D1's `content.markdown` holds the complete text of this file, front matter
included. Import does not rewrite it and export emits it byte for byte.**
Editing front matter through the admin's field forms re-serialises the YAML,
but that is the user deliberately editing, not the import/export path.

### 3.1 Common fields

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Required |
| `description` | string | Summary, used on list pages, in `<meta description>` and in feeds. When absent, stage-one rendering derives it from the body |
| `date` | ISO 8601 | Publication time. A future time means scheduled publishing |
| `updated` | ISO 8601 | Last modification. Defaults to import time |
| `slug` | string | Defaults to the bundle name (default locale) or is generated from `title` |
| `tags` | string[] | Stored, and merged with the aliases in §3.3. **Archives live at `/tags/<tag>`, or `/<locale>/tags/<tag>`, and list across content kinds.** A tag nobody uses returns 404 rather than generating a thin page for an arbitrary string |
| `draft` | boolean | `true` means draft. Defaults to `false` |
| `cover` | relative path | Cover image, e.g. `images/hero.jpg` |
| `kind` | string | Content kind. Defaults to the containing directory or a CLI argument |
| `locale` | string | See §2 rule 2 |

### 3.2 Kind-specific fields

A theme's `theme.json` declares a schema per content kind. The trade
starter's `product`, for example, declares `category` (the slug of a
`category` item), `sku`, `specs` (a key-value table), `gallery` (an array of
relative paths), `datasheet` (a path under `files/`), `moq` and `lead_time`.
Fields typed `image`, `image[]` or `file` must hold relative paths obeying
§4. Fields not declared in the schema are kept as they are — neither an error
nor discarded.

### 3.3 Import aliases

So that front matter exported by Astro, Hugo and common CMSes can be read
directly, import **derives** the table below into `content.frontmatter` JSON
**without rewriting `index.md`**:

| Alias | Canonical field |
| --- | --- |
| `pubDate`, `publishDate`, `published` | `date` |
| `updatedDate`, `lastmod`, `modified` | `updated` |
| `heroImage`, `image`, `featured_image`, `thumbnail` | `cover` |
| `summary`, `excerpt` | `description` |
| `categories` (array of strings) | `tags` (appended) |

### 3.4 The body

The body is standard Markdown. Images use `![alt](images/hero.jpg)`,
attachments use `[Datasheet](files/datasheet.pdf)`. Inline HTML is allowed
but sanitised against an allow-list when rendered: `<script>`, event
attributes and `javascript:` links are removed. External images
(`![](https://…)`) are emitted as they are — not proxied, not downloaded.

## 4. Relative-path rules

1. Paths are relative to the bundle directory. `images/hero.jpg` and
   `./images/hero.jpg` are the same thing; import normalises to the former as
   the key in `assets` and **leaves `index.md` untouched**.
2. Only the `images/` and `files/` prefixes are allowed. No `..`, no absolute
   paths, no `file:`, no protocol-relative paths.
3. Paths are case-sensitive while rendering, but an export must also survive
   a case-insensitive filesystem. Percent-encoded spaces and non-ASCII
   characters match against the decoded filename; two asset keys that differ
   only by case or canonical Unicode form are therefore refused at save time.
4. Relative paths are resolved wherever they appear: Markdown image and link
   syntax, `<img src>` and `<a href>` in inline HTML that survives
   sanitisation, `cover` in front matter, and any field a schema declares as
   `image`, `image[]` or `file`.
5. Every relative path maps to a media sha256 in `content.assets`. Rendering
   substitutes the R2 URL; export uses the mapping to put files back under
   `images/` and `files/`, named by the `assets` key rather than by R2's hash
   name.
6. Referencing a file that is not in the bundle is a **normal state**, not an
   error. The content saves, `assets` simply has no entry, rendering emits the
   original relative path (the browser shows a broken image), and the admin
   and CLI report "N images missing". Publishing warns but is not blocked.

### 4.1 Accepted media types

| Directory | Accepted in 0.1 | Handling |
| --- | --- | --- |
| `images/` | jpg, png, webp, gif, avif | jpg/png/avif are converted to WebP with multiple width variants; gif and webp are stored as they are and given variants; **svg is not accepted in 0.1** |
| `files/` | pdf, xlsx, docx, zip | Stored as they are, validated against the sniffed type, served with `Content-Disposition: attachment` |

## 5. Site export layout

```text
export-2026-08-28/
├── site.json                    # settings, locales, navigation, SEO defaults, enabled kinds
├── content/
│   ├── article/
│   │   └── titanium-price-2026-08/   # a bundle
│   ├── product/
│   │   └── gr5-titanium-bar/
│   ├── category/
│   ├── page/
│   └── faq/
├── media/                       # media no content references (originals, original filenames, sha prefix on collision)
├── redirects.csv                # from,to,status
└── inquiries.csv                # when the inquiry plugin is enabled
```

`content/<kind>/` holds one directory per content kind; each bundle inside is
one translation group. `site.json` and `redirects.csv` use generic structures
and carry no Worker, D1 or R2 identifiers.

**An export contains no theme directory** (corrected 2026-08-29): a theme is
source code that travels with the deployment, not site data. `site.json`
records only the theme id and version in use, and whoever imports it makes
sure that source is present. An earlier revision of this section drew a
`themes/trade-1.2.0.zip`; that was a leftover from the abandoned
"upload a packaged theme" design.

## 6. `mallok.json`

Written into each bundle on export so that importing it again preserves
identity:

```json
{
  "translation_group": "5c1d…",
  "items": {
    "zh": { "id": "a1b2…", "created_at": "2026-08-28T02:10:00Z", "path": "/news/titanium-price-2026-08", "slug": "titanium-price-2026-08" },
    "en": { "id": "c3d4…", "created_at": "2026-08-28T02:12:00Z", "path": "/en/news/titanium-price-2026-08", "slug": "titanium-price-2026-08" }
  }
}
```

It is optional: a bundle written by hand or by an AI pipeline has no such
file, and import assigns a fresh `id` and `translation_group`. It is also the
only private file Mallok is allowed to put in a bundle; Astro, Hugo and
Obsidian ignore it.

`slug` lets an export use a suffixed directory when two translation groups
would otherwise have the same portable folder name. Re-import takes the slug
from this identity before falling back to the directory name, so collision
avoidance never changes a public URL. Older identity files without `slug`
remain valid.

## 7. The import contract

### 7.1 Input

Three layouts are accepted and detected automatically:

1. **A Mallok export** (§5). When `site.json` is present, importing the
   settings is opt-in.
2. **A directory of bundles**. The content kind comes from `--kind` or from
   matching the parent directory name against an enabled kind.
3. **Flat files**: `*.md` in a directory, each treated as a single-locale
   bundle, with image paths resolved relative to that file's directory.
   Astro's `src/content/<collection>/` layout is handled this way, with
   `<collection>` mapped to a content kind.

When a directory name or `--kind` matches no enabled content kind, the import
stops and lists what it could not place. It never guesses, and never quietly
files things under `article`.

### 7.2 Identity and conflicts

| Case | Behaviour |
| --- | --- |
| The bundle has `mallok.json` and that `id` exists | Update that item; `id`, `translation_group` and `created_at` are unchanged |
| No `mallok.json`, but `(kind, locale, slug)` already exists | Update the existing item — this is what makes republishing idempotent |
| No match | Create, assigning `id` and `translation_group` |
| `--create-only` | An existing item is an error; nothing is overwritten |

**Idempotence**: when a bundle's content (the text of every `index*.md` and
the sha of every referenced file) is identical to what is live, the import is
a no-op — no D1 write, no cache purge. A daily AI pipeline can run repeatedly
without consequence.

### 7.3 Media

Every referenced file is hashed with sha256. If the `media` table already has
it, it is reused; otherwise variants are generated on the upload side and
pushed to R2. Image processing happens in the CLI (`sharp`) or the browser
(Canvas); the Worker does none. Files upload one at a time, and D1 writes are
batched against D1's 100 KB per-statement and per-call query limits.

### 7.4 Status

`draft: true` gives a draft; a `date` in the future gives `scheduled`;
otherwise `published`. The CLI's `publish` and `import` differ only in
defaults: `publish` publishes, `import` keeps whatever the front matter says.
Both accept `--draft` to force a draft.

### 7.5 AI pipeline convention (optional)

When a bundle contains `image-slots.json`, the CLI reads it to report which
image slots have no file yet. Without it, missing images are reported per §4
rule 6. Mallok does not interpret other files such as
`image-requirements.md`, and does not upload them.

## 8. The export contract

- Export is a single operation producing the §5 layout. The CLI writes it to
  disk; the admin packages it as a zip download.
- Each `index*.md` is byte-identical to `content.markdown`.
- `images/` and `files/` are fetched from R2 as **originals** through the
  `assets` mapping — or, when a maximum-edge limit was configured, the
  already-resized original that was uploaded. Filenames are the mapping keys.
- Media nothing references goes into the top-level `media/`.
- An export contains no `render_cache`, no sessions, no tokens, no secrets
  and nothing encrypted from plugin settings.

## 9. Round-trip assertions (mandatory)

These are regression tests that must pass:

1. Export → import into an empty site → export: every `index*.md`, `images/`
   and `files/` is byte-identical across the two exports, and `id`,
   `translation_group` and `created_at` in `mallok.json` are unchanged.
2. Any hand-written bundle → import → export: `index*.md` is byte-identical
   (import does not rewrite the source).
3. A bundle whose front matter uses aliases (Astro or Hugo shaped): the
   derivation into `content.frontmatter` is correct and the source text is
   unchanged on export.
4. Two bundles each containing a different `images/cover.jpg`: both render
   correctly after import and both are restored correctly on export.
5. A bundle referencing a missing file: the import succeeds, the state is
   visible, and the export preserves the reference as it was.
6. Re-importing an unmodified bundle: no D1 write and no cache purge.
7. Hostile input (`..` paths, `javascript:` links, inline `<script>`, a body
   over 2 MB): rejected or sanitised per the rules, without crashing and
   without leaking.
