# Task 03 — Media

- Status: **complete for the server side**; the browser-side conversion step is
  deferred to Task 11 with the admin UI (see §6)
- Date: 2026-08-29
- Scope: content-addressed storage in R2, real type detection, image
  dimensions, WebP variants, reference counting and garbage collection, and
  responsive image output on the public page.
- Contract: `docs/ARCHITECTURE.md §8`, `docs/SEO_PERFORMANCE.md §9`,
  `docs/SECURITY.md §6`, `docs/CONTENT_FORMAT.md §4`.

## 1. Demonstrable loop

> Upload an image → reference it from Markdown as `images/hero.png` → the
> public page serves `srcset`, `width`, `height` and an eager first image →
> the object cannot be deleted while it is referenced → drop the reference and
> it becomes collectable.

Every step is covered in `test/worker/media.test.ts`.

## 2. What changed

| Area | Files | Notes |
| --- | --- | --- |
| Media rules | `src/core/media.ts` | Magic-byte type detection, image dimension reader, variant planning, R2 key construction. Pure; the browser and the CLI apply the same rules before uploading. |
| Persistence | `src/db/media.ts` | Media rows, dedupe lookup, variant widths, listing, and the reference-count statements. |
| Endpoints | `src/worker/admin-media.ts` | check, upload, variant upload, list, detail, alt text, delete. |
| Reference counting | `src/db/queries.ts` | `upsertContent` and `deleteContent` now move `ref_count` in the same batch as the row. |
| Garbage collection | `src/worker/scheduled.ts` | Unreferenced objects older than seven days are collected, at most 20 per tick. |
| Image output | `src/core/assets.ts` | The first image in a document is `loading="eager"`; the rest stay lazy. |

No schema migration: `media` already existed in `0001_init.sql`.

## 3. API surface

| Method | Route | Scope |
| --- | --- | --- |
| POST | `/_mallok/api/media/check` | — |
| GET | `/_mallok/api/media` | — |
| GET | `/_mallok/api/media/<sha256>` | — |
| PUT | `/_mallok/api/media/<sha256>` | `media:write` |
| PUT | `/_mallok/api/media/<sha256>/variants/<width>` | `media:write` |
| PATCH | `/_mallok/api/media/<sha256>` | `media:write` |
| DELETE | `/_mallok/api/media/<sha256>` | `media:write` |

## 4. Decisions worth recording

1. **The hash in the upload path is verified, not trusted.** The body is
   hashed and must equal it. That is what makes the key content-addressed, so
   the same file uploaded twice costs one object and a repeated upload is a
   no-op rather than a conflict.
2. **Type comes from the bytes.** A PNG renamed `.pdf` is stored as a PNG.
   The one exception is documented in the code: xlsx, docx and plain zip are
   all ZIP containers and cannot be told apart by signature, so there the
   signature decides that it *is* a ZIP and the declared extension only picks
   the label — and that extension is still checked against the allow-list.
   **SVG is rejected**, because sanitizing it safely needs a second allow-list
   that 0.1 does not have (`CONTENT_FORMAT.md §4.1`).
3. **Dimensions are read from the file header**, not taken from the uploader,
   so a wrong value cannot introduce layout shift. PNG, GIF, JPEG and WebP are
   parsed; AVIF returns `null` and the image simply renders without intrinsic
   dimensions.
4. **A newly uploaded object starts unreferenced**, so `unreferenced_since` is
   set at upload. An image uploaded and never used is collected after the
   grace period instead of living forever.
5. **Deleting a referenced object is refused with 409** and the reference
   count, rather than succeeding and leaving broken images with no way to find
   which page lost one.
6. **The first image in a document loads eagerly.** It is the likely LCP
   element (`SEO_PERFORMANCE.md §9`).
7. **New limit: 25 MiB per object** (`MAX_MEDIA_BYTES`). The isolate holds the
   whole body while hashing it and memory is capped at 128 MB. **This number
   is not in any design document yet and needs the product owner's
   confirmation**; it is the only figure in this task that was chosen rather
   than derived.

## 5. Evidence

Environment: Node 22.22.2, workerd via `@cloudflare/vitest-pool-workers`
0.22.0, macOS 24.6.0, vitest 4.1.11.

```
pnpm lint        → exit 0
pnpm typecheck   → exit 0
pnpm test        → exit 0   (10 files, 106 tests)
pnpm build       → exit 0
pnpm bundle:size → exit 0   (780.5 KiB raw, 206.8 KiB gzip, 6.7% of the Free limit)
```

| Requirement | Implementation | Test | Status |
| --- | --- | --- | --- |
| Type detected from magic bytes, not the extension | `src/core/media.ts` `sniffMediaType()` | `test/core/media.test.ts` "ignores a lying extension" | `VERIFIED_LOCAL` |
| SVG rejected | same | `test/core/media.test.ts` "rejects SVG" | `VERIFIED_LOCAL` |
| ZIP family labelled by declared extension | same | `test/core/media.test.ts` "uses the declared extension only to label a ZIP container" | `VERIFIED_LOCAL` |
| Dimensions read from the header | `src/core/media.ts` `readImageSize()` | `test/core/media.test.ts` "image dimensions" | `VERIFIED_LOCAL` |
| Variants never upscale | `src/core/media.ts` `planVariants()` | `test/core/media.test.ts` "variant planning" | `VERIFIED_LOCAL` |
| Upload verifies the body against the path hash | `src/worker/admin-media.ts` `putMedia()` | `test/worker/media.test.ts` "refuses a body that does not match the hash" | `VERIFIED_LOCAL` |
| Repeated upload is deduplicated | same | `test/worker/media.test.ts` "deduplicates a repeated upload" | `VERIFIED_LOCAL` |
| Variants must be WebP | `src/worker/admin-media.ts` `putVariant()` | `test/worker/media.test.ts` "refuses a non-WebP variant" | `VERIFIED_LOCAL` |
| Objects served immutably | `src/worker/media.ts` | `test/worker/media.test.ts` "serves the object through the proxy" | `VERIFIED_LOCAL` |
| Responsive output with srcset, dimensions and eager first image | `src/core/assets.ts` | `test/worker/media.test.ts` "renders a referenced image responsively" | `VERIFIED_LOCAL` |
| Only the first image is eager | `src/core/assets.ts` | `test/core/fragment.test.ts` "loads only the first image eagerly" | `VERIFIED_LOCAL` |
| `ref_count` moves in the content batch | `src/db/media.ts` `refCountStatements()` | `test/worker/media.test.ts` "counts the reference in the same write" | `VERIFIED_LOCAL` |
| Referenced object cannot be deleted | `src/worker/admin-media.ts` `removeMedia()` | `test/worker/media.test.ts` "refuses to delete an object that content still uses" | `VERIFIED_LOCAL` |
| Dropping the reference starts the grace period | `src/db/media.ts` | `test/worker/media.test.ts` "releases the reference" | `VERIFIED_LOCAL` |
| Collection happens only after seven days | `src/worker/scheduled.ts` `collectMedia()` | `test/worker/media.test.ts` "collects media only after the grace period" | `VERIFIED_LOCAL` |
| Uploads require `media:write` | `src/worker/admin.ts` | `test/worker/media.test.ts` "requires the media:write scope" | `VERIFIED_LOCAL` |

### Cross-stage invariants (`ACCEPTANCE.md §11`)

`AC-INV-01`, `-02`, `-03`, `-04` (206.8 KiB gzip), `-07`, `-09`:
`VERIFIED_LOCAL`.

## 6. Not done, and why

- ~~The browser-side conversion pipeline is not written.**~~ **Closed in Task 11.** Originally: Canvas-based WebP
  conversion and variant generation belong to `src/admin/`, which does not
  exist until Task 10. What *is* done is the part both the browser and the CLI
  must agree on — accepted types, variant widths, key construction — and it
  lives in `src/core/media.ts` with tests, so neither side can drift. Until
  Task 11 an image reaches the site by uploading the original and, optionally,
  variants produced elsewhere.
- **`sharp` in the CLI**: Task 14.
- ~~`max_image_edge` is stored but not enforced.**~~ **Closed in Task 11.** Originally: The setting exists on the
  `site` row; capping the longest edge happens on the upload side, so it lands
  with Task 11 and Task 14.
- **AVIF dimensions are not read.** The ISO-BMFF box walk needed is
  disproportionate here; such images render without intrinsic width and
  height, which costs layout stability but nothing else.
- **`render_cache` garbage collection** is still absent from the cron tick
  (`DATA_MODEL.md §4` lists it). It belongs with Task 05, which is the task
  that changes `pipeline_version` behaviour.

## 7. Known risks

1. **`MAX_MEDIA_BYTES` is a guess** (see §4.7). A 25 MiB body is held in
   memory while it is hashed, against a 128 MB isolate. Real numbers for large
   uploads have not been measured on a real account.
2. **Reference counts can drift if a batch partially fails.** D1 batches are
   atomic, so the counted case is safe, but an object whose R2 delete fails
   after its row is gone becomes an orphan that nothing will retry. The order
   is deliberate — a dangling row would break pages, an orphaned object only
   costs storage — but there is no sweeper for orphans yet.
3. **The grace period is measured from `unreferenced_since` only.** Restoring
   old content from an export after seven days will not find its images unless
   the export is imported with the media, which `CONTENT_FORMAT.md §5`
   requires.
