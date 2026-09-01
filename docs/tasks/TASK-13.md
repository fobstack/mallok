# Task 13 — Import and export

- Status: **complete**, all checks green locally
- Date: 2026-08-30
- Scope: the export manifest, the import alias and identity rules, the three
  input layouts, and the seven round-trip assertions.
- Contract: `docs/CONTENT_FORMAT.md §5`–`§9`.

## 1. Demonstrable loop

> Export the whole site → import it into the same site → export again → the
> two directories are byte-identical, and the re-import writes nothing.

Verified with the real CLI against `wrangler dev`:
`diff -r export1 export2` reports no differences, and every row of the
re-import came back `unchanged`.

## 2. The export is a manifest, not an archive

The Worker returns a list of files: text inline, media as a site-relative
URL. Zipping a site inside the Worker would mean pulling every media object
through it, which neither the CPU nor the memory budget allows and which
contradicts "the Worker does not process media"
(`ARCHITECTURE §8`). The CLI streams the files to disk; the admin can build a
zip in the browser from the same manifest. One description of the layout,
two writers.

The manifest carries nothing secret — no sessions, tokens, plugin secrets or
`render_cache` (`CONTENT_FORMAT §8`).

## 3. What the seven assertions caught

`CONTENT_FORMAT §9` lists seven round-trip properties as a hard requirement.
Writing them as tests found one real gap:

**The import aliases were never implemented.** `CONTENT_FORMAT §3.3` says an
Astro or Hugo export's `pubDate`, `heroImage`, `summary` and `categories`
should derive into the stored view. `deriveFrontmatter` existed in core but
nothing called it, so a bundle from either tool imported with an empty
description and no cover. The save path now derives them — and the assertion
that the source text is *not* rewritten guards the other half of the rule.

The remaining six passed once written, which is worth stating plainly rather
than presenting as work: verbatim source text, same-named images in different
bundles, references to missing files, idempotent re-import, hostile input, and
the export/import/export cycle were already correct.

## 4. Decisions worth recording

1. **An unrecognised directory stops the import.** Filing unknown content
   under `article` would put it at a URL the author never chose, so the run
   ends with the list of folders that matched nothing and the list of enabled
   types (`CONTENT_FORMAT §7.1`).
2. **Idempotence is judged on stored bytes.** The API already compared the
   Markdown hash and the assets map; the CLI surfaces that as `unchanged`, so
   a daily pipeline can re-run a whole directory with no writes and no cache
   purges.
3. **A missing referenced file is a normal state**, all the way through: the
   scan records it, the save reports it, the page renders the original
   relative path, and the export omits the file while keeping the reference.
4. **Export paths are validated on the way out.** The manifest comes from a
   site the user chose, but writing files is where a bad value would cost
   more than an error message, so a path containing `..` is refused.

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 26 files / 283 tests pass |
| `pnpm build` | pass |
| `pnpm bundle:size` | 227.4 KiB gzip = 7.4 % of the Free limit |

`test/worker/roundtrip.test.ts` runs all seven assertions against real D1 and
R2 in workerd. `test/core/bundle.test.ts` covers alias derivation, asset-path
collection (including the traversal cases), status resolution, `mallok.json`
parsing and layout detection.

## 6. Not done / known limits

- ~~`--create-only` is parsed but not enforced.**~~ **Closed in a later pass.** Originally: The flag reaches the
  publish options and is ignored; the API has no "fail if it exists" mode
  yet, so honouring it would need a server change.
- **Importing `site.json` is not wired.** An export carries it and
  `CONTENT_FORMAT §7.1` allows importing settings alongside content; the CLI
  currently imports content only, and says nothing about the file.
- ~~`inquiries.csv` is not in the export.**~~ **Closed in a later pass.** Originally: `CONTENT_FORMAT §5` lists it. The
  plugin already exports it through its own panel action, so the data is
  reachable, but the site-wide export does not include it.
- ~~The admin has no export button.**~~ **Closed in a later pass.** Originally: The endpoint and manifest exist; the
  browser-side zip is not built.
