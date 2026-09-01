# The Mallok admin

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: defines the admin's information architecture, its pages, the form
  generation mechanism and the delivery boundary. The admin is the only
  interface a non-technical user ever touches, so **its usability is the
  product's usability**.

## 1. In one sentence

**The admin is a Preact single-page application running in the browser, served
through Workers Static Assets, calling exactly the same management API the CLI
does.**

It exposes only what an operator can change: **content, settings and plugin
panels**. Installing a theme or a plugin is a deployment and is not in the
admin (`PRODUCT_VISION §4`) — the admin shows what is installed and offers the
options those things expose.

## 2. Hard constraints

| Constraint | Source | Consequence |
| --- | --- | --- |
| The admin build goes through Static Assets and **never into the Worker script** | `TECH_STACK §6` | Its size never eats the render pipeline's 3 MB budget |
| Static-asset requests are free and are not billed as Worker invocations | `TECH_STACK §6` | The admin can be substantial, but still within 20,000 files at 25 MiB each |
| Everything lives under `_mallok/app/` | `CLOUDFLARE_RESOURCES.md §5` | No public-site path can ever collide with it |
| A user need not understand Workers, D1, R2, caching or migrations | `PRODUCT_VISION §4` | Those words do not appear in the main interface, only under Advanced and Diagnostics |
| The admin installs neither themes nor plugins | `PRODUCT_VISION §4` | There is no upload screen; anything needing a deployment gets instructions instead |
| The admin and the CLI have identical capability | `PRODUCT_VISION §5.9` | Every admin action has a corresponding API endpoint |
| Image processing happens in the browser | `ARCHITECTURE §8` | Canvas converts to WebP; the Worker never touches an image |

## 3. Technology

From `TECH_STACK §6`, not re-argued here:

| Area | Choice |
| --- | --- |
| UI | `preact` + `@preact/signals`, **with no React compatibility layer** |
| Build | `vite` + `@preact/preset-vite` |
| Markdown editing | `codemirror` + `@codemirror/lang-markdown` |
| Forms | The in-repository schema-driven generator (§7) |
| Preview | Reuses `src/core/`, rendering in the browser |
| Styling | In-repository CSS variables and components; **no Tailwind, no CSS-in-JS, no component library** |
| Image processing | The browser's Canvas API |

**0.1 does not include Tiptap.** Visual editing belongs to 0.2
(`PRODUCT_VISION §9`). The only body editor in 0.1 is Markdown source in
CodeMirror.

## 4. Information architecture

Three top-level sections plus a user menu. **A new feature must fit one of
them**; when it does not, the first question is whether it is internal
complexity that should not be surfaced at all.

```
Content     ├ All content (filter by kind, filter by language, search)
            ├ The editor (source + field form + preview)
            └ The media library

Settings    ├ Site details (name, tagline, SEO defaults)
            ├ Languages (which are enabled, which is default)
            ├ Navigation (one per language)
            ├ Appearance (what the current theme is, and its options form)
            ├ Domain and media domain
            ├ Email (Resend)
            └ Advanced (cache TTL, usage, backup export, diagnostics)

Plugins     ├ Installed plugins (switch, version, what each affects)
            ├ Each plugin's settings and secrets form
            └ Each panel a plugin declares, such as Inquiries

User menu   ├ Change password
            ├ API token management
            └ Sign out
```

### 4.1 What Appearance does not contain

No theme list, no upload, no switch button. The page shows:

- the current theme's name, version and which content kinds it supports;
- the `clientScripts` it declares — **stated honestly as "this theme injects N
  scripts"**, which is always zero for the official themes;
- the options form it exposes (`theme.json`'s `options`), which takes effect
  immediately;
- one sentence: **changing themes requires editing source and redeploying**,
  with a link to the documentation.

The line comes from `PRODUCT_VISION §4`: content and settings belong to the
operator; themes and plugins belong to the deployment. Making a theme switch
into a button would be a lie.

## 5. The setup wizard

At `/_mallok/setup`, and **permanently closed** once complete — a non-null
`site.setup_completed_at` makes it a 404. The steps come from
`ARCHITECTURE §15`:

| Step | What | Skippable |
| --- | --- | --- |
| 1 | Administrator email and password | No |
| 2 | Site name, default language, enabled languages | No |
| 3 | Choose a starter | Yes; skipping gives an empty site |
| 4 | Domain: detect whether a custom domain is bound | Yes |
| 5 | Media domain `media.<domain>`, creating the DNS record | Yes |
| 6 | Email: the Resend key, sending domain, writing the DNS records | Yes |
| 7 | Done | — |

Every step can be completed later in Settings. Two things **must be stated
honestly**:

- **Step 4**: with no custom domain bound, say plainly that caching is not in
  effect and `.workers.dev` is preview only (`ARCHITECTURE §2`). This is not
  an optional soft hint — it determines the site's performance.
- **With no `CF_API_TOKEN`**: the wizard sets `site.cache_ttl` to 60 seconds
  and the admin carries a standing notice that configuring a token restores
  instant publishing (`CLOUDFLARE_RESOURCES.md §6`). **This is an honest
  degradation, not a fault**, and the wording must distinguish the two.

## 6. The content editor

### 6.1 Layout

Three collapsible columns:

```
┌─────────────┬────────────────────────┬──────────────┐
│ Field form  │ Markdown source        │ Live preview │
│ (schema)    │ (CodeMirror)           │ (core)       │
├─────────────┴────────────────────────┴──────────────┤
│ Status: draft/published/scheduled  language  group   │
│ translation  Save  View                              │
└─────────────────────────────────────────────────────┘
```

### 6.2 Markdown is the truth

**`content.markdown` is the only truth** (`CONTENT_FORMAT §3`). The field form
edits front matter, and saving re-serialises the YAML block and splices it
back into the source. That is the user deliberately editing, not an
import/export path, so rewriting the source's formatting is allowed there.

The editor must not rewrite Markdown the user has not edited. Opening an item
and closing it again must leave `markdown` byte-identical.

### 6.3 Preview

Preview calls `src/core/`'s `renderFragment` and `renderPage` — **the same
functions production runs** (`ARCHITECTURE §5`, rule 3). That is the only
trustworthy way to implement what-you-see-is-what-you-get.

Preview needs the theme templates, which live in the Worker's artifact
(`THEME_FORMAT.md §3.1`). The admin fetches the current theme's templates and
manifest once through `GET /_mallok/api/theme` and caches them in memory.

### 6.4 A missing image is a normal state

When a relative path is not in `assets` (`CONTENT_FORMAT §4`, rule 6):

- the editor marks the line;
- the header shows "N images missing";
- **publishing warns without blocking**;
- the preview shows a placeholder rather than a broken-image icon.

**The preview iframe uses `sandbox="allow-same-origin"` and deliberately does
not grant `allow-scripts`**: a fully sandboxed `srcdoc` document has an opaque
origin and cannot fetch the theme stylesheet, so the preview would render
unstyled — losing the entire point. Withholding `allow-scripts` means nothing
executes inside the frame, which is what the sandbox is actually for. Granting
both together is the dangerous combination.

### 6.5 Size limits

A `markdown` over 2 MB fails to save with a clear error
(`DATA_MODEL §2.2`).

When stage-one rendering exceeds the CPU budget — 10 ms on the free plan,
`ARCHITECTURE §5` — the save request stores the Markdown as a draft and
returns a clear error: "this item is too long to render within the free plan's
time budget. Split it, or move to Workers Paid." **It does not fail silently,
and it does not pretend to have succeeded.**

### 6.6 Multiple languages

- The language switcher sits at the top of the editor, and switching to a
  translation that does not exist yet offers "create the `<language>`
  version".
- A translation is an independent content row with its own Markdown, status
  and slug (`ARCHITECTURE §9`).
- Members of one `translation_group` are visible to each other in the editor
  and can be jumped between.
- **0.1 does no automatic translation**; that is a 0.2 `onContentSave` plugin.

## 7. The schema-driven form generator

This is the one admin component worth designing on its own. Four places share
it:

| Use | Schema source |
| --- | --- |
| A content kind's specific fields | `theme.json`'s `kinds[kind].fields` (`THEME_FORMAT.md §5.2`) |
| Theme options | `theme.json`'s `options` (`THEME_FORMAT.md §6`) |
| Plugin settings and secrets | `plugin.json`'s `settings` and `secrets` (`PLUGIN_API.md §4`) |
| A plugin panel's filters | `plugin.json`'s `panels[].filters` |

**The consequence: neither theme authors nor plugin authors write admin
code.** The moment they can, the admin's size budget and its security boundary
are both gone.

The field-type-to-control mapping is the table in `THEME_FORMAT.md §5.2`.
Three cases are special:

- `image`, `image[]` and `file` open the media picker and write back a
  **relative path** (`images/x.jpg`), never a URL.
- `reference` opens the content picker and writes back the target's **slug**.
- A `secrets` field shows "set" or "not set" with a Replace button, and
  **never echoes the value** (`PLUGIN_API.md §7.3`).

## 8. The media library and uploads

Uploading happens in the browser (`ARCHITECTURE §8`):

```
pick a file
  → validate against the sniffed real type, not the extension; accept only the allow-list (CONTENT_FORMAT §4.1)
  → compute the original's sha256
  → ask the API whether that sha exists; if so, reuse it and upload nothing
  → otherwise: Canvas converts to WebP and generates the variants theme.json's imageWidths declares
  → PUT each to R2, through the management API
  → write the media row (dimensions, variants, original filename)
```

- **svg is not accepted in 0.1** (`CONTENT_FORMAT §4.1`).
- Originals are limited to 2560 px on the longest edge by default
  (`site.max_image_edge`), which can be turned off in settings to keep true
  originals.
- The library shows reference counts, and anything at `ref_count = 0` appears
  under "unused media".
- Deleting unreferenced media is immediate. Referenced media cannot be
  deleted; the admin says to change the content first.

**Variants produced in the browser and by the CLI's `sharp` match in
specification but are not guaranteed byte-identical** (`ARCHITECTURE §8`).
Deduplication keys on the original's sha, so correctness is unaffected.

## 9. The Appearance page

See §4.1. Two additions:

- The options form is rendered by §7's generator from `theme.json`'s
  `options`, sharing one component with content fields and plugin settings.
- When the current theme does not know a content kind the site already has,
  the content list marks those items "the current theme does not support this
  kind; rendered as an ordinary page" (`THEME_FORMAT.md §5.3`), and says that
  this affects neither URLs nor data.

## 10. The plugin interface

- An installed plugin has a switch, **immediate**, and settings and secrets
  forms, **immediate**.
- **Installing, updating and removing plugins are not in the admin.** The top
  of this page says honestly that plugins ship with the source and that
  installing one means changing the repository and redeploying, with the
  concrete steps (`PLUGIN_API.md §2`). **It must not be dressed up as a
  one-click install.**
- Each plugin shows its version, which hooks it uses, whether it injects
  client-side JavaScript, and whether it affects the cache.
- A plugin declaring `onRequest` carries the extra note that it runs on every
  visitor request (`PLUGIN_API.md §5.1`).
- Panels render from `plugin.json`'s `panels` (`PLUGIN_API.md §7.5`).

## 11. Advanced, under Settings

This is the only place lower-level vocabulary is allowed:

- **Usage**: D1 rows read and written today against the limits, R2 storage,
  Worker request count. **Exceeding D1's free tier makes it unavailable for
  the day** (`ARCHITECTURE §2`), so approaching the limit must be prominently
  flagged.
- **Cache**: the `cache_ttl` setting, "purge all cached pages" (the edge
  cache) and "rebuild all pages" (empty `render_cache`). Neither loses
  anything — pages and fragments are both derived data, regenerated on the
  next request, at the cost of that one render. **Without a purge token, say
  honestly that nothing was purged and the cache will expire on its own.
  Never claim success.**
- **Backup**: one-click export (`CONTENT_FORMAT §5`), with a prompt to export
  before upgrading the Worker (`ARCHITECTURE §15`).
- **Diagnostics**: whether a custom domain is bound, whether caching is in
  effect, whether `CF_API_TOKEN` is configured, whether Resend is configured,
  and the schema version.

**"Needs a deployment" and "does not" must be stated in one place**
(`ARCHITECTURE §15`). Diagnostics carries the table: content, settings, theme
options, plugin switches and settings are immediate; changing theme,
installing a plugin and upgrading Mallok need a redeploy.

## 12. The authentication interface

The complete rules are in `SECURITY.md`. On the interface side:

- The sign-in page takes an email and a password. **The PBKDF2 cost is bound
  by the free plan's 10 ms of CPU** (`ARCHITECTURE §18`, item 5); if the
  measured iteration count falls below the OWASP recommendation, the sign-in
  page and the documentation must say so honestly and offer the hardening
  option (Cloudflare Access).
- The session cookie is `HttpOnly; Secure; SameSite=Strict`.
- Every write carries a CSRF token.
- API token management: create (**shown once**), name, scopes, revoke, last
  used.

## 13. Quality gates

| Item | Requirement |
| --- | --- |
| Accessibility | Fully keyboard operable; every form control has a label; focus is visible; `@axe-core/playwright` reports nothing serious or critical |
| First load | Admin first-load JS ≤ 150 KB gzip (Preact, signals, the router, the form generator). **Asserted by `pnpm admin:size`**, counting only what `index.html` references; measured at 20.6 KB on 2026-08-30 |
| CodeMirror | Chunked and loaded only when the editor opens. **The render pipeline — unified, remark, rehype, LiquidJS — is equally on demand**: the preview uses the real renderer, so it loads with the editor rather than on first load |
| Importing from core | **A page on the first-load path must not import from the `src/core/index.ts` barrel**, not even for a single constant — the barrel drags the whole render pipeline into the first load. This happened once, on 2026-08-31: the Appearance page imported the barrel for one string constant and the first load went from 17 KB to 137 KB, caught by `pnpm admin:size`. Dependency-free constants live in `src/core/constants.ts` |
| Offline | No offline support. A network failure produces a clear error and never silently discards a change |
| Unsaved changes | Leaving the editor is intercepted and confirmed |

## 14. Deliberately not done

- No visual rich-text editing; that is Tiptap in 0.2.
- No revision-history interface; the `rev` column is kept but has no UI
  (`ARCHITECTURE §17`).
- No collaborative editing.
- No multiple users or roles. 0.1 has one administrator, though the schema
  makes no single-row assumption.
- No ability for a plugin to inject frontend code.
- **No upload-and-install interface for themes or plugins** — they are source
  code.
- No SQL console or arbitrary query interface in the admin.
- No customisation of the admin's own appearance beyond dark mode; how the
  admin looks is not a selling point.
