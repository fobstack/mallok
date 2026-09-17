# Task 14 — The CLI

- Status: **complete for the content commands**; `create` and `destroy`
  belong to Task 16 and report that plainly.
- Date: 2026-08-30
- Scope: `publish`, `import`, `export`, `media push`, `preview`; the `sharp`
  image pipeline; exit codes, `--json`, and the missing-file report.
- Contract: `docs/CLI.md`.

## 1. Demonstrable loop

> `mallok publish ./articles` publishes a directory of bundles with images;
> running it again is a no-op.

Verified against `wrangler dev` with a real bundle containing a real PNG:

```
Found 1 bundle (bundles layout).
  uploading images/hero.png
bundle          locale  status   path
cli-smoke-test  en      updated  /news/cli-smoke-test
```

The published page served the image from R2 with intrinsic `width`/`height`
and `loading="eager"` on the first image. The second run uploaded nothing and
reported `unchanged`.

## 2. What the CLI is, and is not

Its remote content, media and export workflows use the same management API
contracts as the admin, with a scoped, revocable token read from
`MALLOK_TOKEN` and never written to a file (`CLI.md §4`). There is no private
CLI-only site-data endpoint. That does not imply capability parity: local
preview/build and project or Cloudflare lifecycle are CLI concerns, while
account and plugin management are admin concerns (`PRODUCT_VISION §5.9`,
`AC-CLI-04`).

`sharp` lives only in `src/cli/media.ts` and is external to the published
bundle: it is a native module, so the consumer installs it for their platform.
Nothing in the Worker can import that file.

## 3. Decisions worth recording

1. **Arguments are parsed by hand.** Seven commands and a dozen flags do not
   justify a dependency that every user of the published package would
   install.
2. **The original is hashed after capping, not before.** The site's
   longest-edge limit is applied first, because the capped file is what gets
   stored; hashing the untouched file would upload the same picture twice
   under two different limits.
3. **Variants match the browser's specification, not its bytes.** The
   deduplication key is the original's sha256, so a file uploaded from the
   admin and the same file uploaded by the CLI resolve to one media row
   (`ARCHITECTURE §8`).
4. **Ambiguity is an error.** With more than one registered site and no
   `--site`, the CLI stops rather than picking one; publishing to the wrong
   site is worse than an error message.
5. **Errors are written for a person.** No SQL, bucket names or stack traces;
   a connection failure and a rejection get different wording; a 5xx mentions
   that the daily database quota resets at 00:00 UTC (`CLI.md §12`).

## 4. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 26 files / 283 tests pass |
| `pnpm build:cli` | 840.7 KiB bundle, `sharp` external |

Tests: `test/cli/args.test.ts` (parsing, site resolution, token resolution,
exit codes, table rendering), `test/cli/scan.test.ts` (all three layouts,
missing files, unfilled image slots, unrecognised kinds, files Mallok must
not interpret).

End-to-end against `wrangler dev`: publish with image upload, idempotent
re-run, `--json` output, export, re-import, and a second export identical to
the first.

**A build bug worth recording**: the published bundle is ESM, but `yaml`
resolves to CommonJS under Node's export conditions, so the first build threw
`Dynamic require of "process" is not supported` the moment it parsed front
matter. The build now emits esbuild's documented `createRequire` shim in the
same banner as the shebang. This is exactly the class of failure that only
shows up when the artifact is actually run.

## 5. Not done / known limits

- ~~**`mallok create` and `mallok destroy` are not implemented.**~~
  **Implemented in Task 16** — but never run against a real account
  (`TASK-16.md §6`).
- ~~`mallok preview` has no command wiring.**~~ **Closed in a later pass.** Originally: `src/cli/preview.ts` renders a
  bundle through `src/core` with no network, but the command is not routed
  because it needs a theme to render with and the CLI has no local theme
  loader yet.
- ~~`--create-only` is accepted and ignored**~~ **Closed in a later pass.** Originally: (see `TASK-13.md §6`).
- **`--verbose` is parsed but does not print requests yet.**
- **`--dry-run` reports every document as `updated`** rather than predicting
  whether it would be unchanged, which would need the hash comparison the
  server does.
- **Batching is per bundle, not per D1 limit.** `CLI.md §6.5` asks for
  batching against D1's 100 KB statement and 50-query call limits; media is
  checked in batches of 40 hashes and content is posted one document at a
  time, which respects the limits but does not measure against them.
