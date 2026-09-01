# Task 11 — Content editor and media library

- Status: **complete**, all checks green locally
- Date: 2026-08-30
- Scope: the three-pane editor, the live preview, the media library and
  browser-side upload pipeline, the media picker, and the language switcher.
- Contract: `docs/ADMIN.md §6`, `§8`; `docs/ARCHITECTURE.md §8`;
  `docs/CONTENT_FORMAT.md §4`.

## 1. Demonstrable loop

> Without touching a terminal: open the editor, type a title in the field
> form, type a body in the source pane, watch the preview render it through
> the real theme, publish, and see it at the public URL.

Verified end to end. The three panes were driven in a browser against
`wrangler dev` (field edit → source pane updated → preview re-rendered), and
the save path was exercised with the exact payload the editor sends:
`/news/editor-smoke-test` served the published page, and `GET /content/:id`
returned the Markdown **byte-identical** to what was sent.

## 2. The two rules the editor is built around

1. **The Markdown is the truth** (`ADMIN.md §6.2`). The field form edits front
   matter; the block is re-serialised and joined back onto the body. This
   needed a new core function, `joinFrontmatter` — and getting it right meant
   making it a true inverse of `splitFrontmatter`, which returns the body
   *including* the blank line after the closing delimiter. The first version
   added its own newline and grew the document on every edit. There is now a
   test asserting `join(split(x)) === x` for a whole document, and another
   asserting five round trips are stable.
2. **The preview is the real renderer** (`ADMIN.md §6.3`). It calls
   `renderFragment` and `renderPage` from `src/core` — the same functions the
   Worker runs. This is the reason `src/core` may not import Cloudflare types:
   it has to run in a browser too. A look-alike preview would drift; this one
   cannot.

## 3. Media, and why the browser does the work

The Worker never touches an image (`ARCHITECTURE §8`). The browser decodes the
file, downscales the original to the site's longest-edge limit, hashes it,
asks the API whether that hash exists — and only then converts to WebP at the
theme's declared widths and uploads. A repeated upload costs one request and
stores nothing.

Two consequences stated plainly in the UI: SVG is refused (it can carry
script), and the deduplication key is the **original's** hash, so variants
produced here and by the CLI's `sharp` need only match in specification, not
byte for byte.

`relativePathFor()` is what a picker writes back into content. It was
hardened after a test: names are reduced to portable characters *and* leading
dots are stripped, so `../../etc/passwd` becomes `images/etc-passwd` rather
than something that reads as a traversal when an export is unpacked.

## 4. Decisions worth recording

1. **The Markdown pane is a view, not an owner.** CodeMirror is mounted once,
   but an incoming value that differs from its document is pushed in — which
   is what makes a field-form edit appear in the source immediately. The
   difference check matters: syncing unconditionally would reset the cursor
   on every keystroke.
2. **CodeMirror and the render pipeline load on demand.** They are 83 KiB and
   64 KiB gzipped; the first-load budget covers Preact, signals, the router
   and the form generator (`ADMIN.md §13`). `lazyRoute` is nine lines rather
   than `preact/compat`'s `lazy`, because the admin deliberately does not ship
   the React compatibility layer (`TECH_STACK §6`). First load stayed at
   **20.6 KiB gzip**.
3. **The preview renders in a sandboxed iframe.** Content is untrusted even
   after sanitising, and a preview that could reach the admin's DOM would
   undo that.
4. **A translation is a separate content row**, so the language switcher
   navigates between siblings and offers to create a missing one rather than
   swapping a field (`ARCHITECTURE §9`).

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 22 files / 234 tests pass |
| `pnpm build` | pass |
| `pnpm admin:size` | 20.6 KiB gzip first load; 312 KiB gzip loaded on demand |

New tests: `joinFrontmatter` round trips, inverse property, idempotence,
value quoting (`2026-08-30` must come back a string, `# x` must not become a
comment); `relativePathFor` portability and the traversal case.

Browser-verified: the three panes in sync, the live preview rendering the
journal theme, the unsaved-changes pill. API-verified: publish → public URL →
byte-identical Markdown round trip.

## 6. Not done / known limits

- ~~Drag-and-drop upload is not wired**~~ **Closed in a later pass.** Originally:; the drop zone is a file input styled
  as one. The label says "choose files", so it does not promise what it does
  not do.
- ~~No image cropping or alt-text editing in the library.**~~ **Closed in a later pass (alt text only; cropping is still not built).** Originally: Alt text can be
  set through the API (`PATCH /media/:sha`) but has no control yet.
- **The editor's preview always renders the content layout**, never the list
  or home layout, which is right for content but means a theme's home page
  cannot be previewed from the admin.
- ~~Missing-image markers are counted, not located.**~~ **Closed in a later pass.** Originally: The bar shows "N images
  missing" with the paths in a tooltip; `ADMIN.md §6.4` also asks for a marker
  on the offending line in the source pane, which needs a CodeMirror
  decoration and is not built.
- **The CPU-budget error path is untested.** `ADMIN.md §6.5` requires a clear
  message when stage-one rendering exceeds the Free plan's 10 ms; the server
  returns one, but provoking it needs a real account (`TASK-01 §4`).
