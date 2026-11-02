# Task 48 — Heading ids for a linked table of contents

- Status: **done**, merged to `main`, not released.
- Date: 2026-10-25; review fixes 2026-11-01.
- Scope: ids on the headings of a rendered page body, `content.headings`,
  and the Manual theme's contents list.
- Source: the owner's item M4 (`docs/IMPLEMENTATION_PLAN.md`, phase seven).

## 1. Demonstrable loop

An article with `## Quick start` and `### Install the SDK` renders
`<h2 id="quick-start">` and `<h3 id="install-the-sdk">`; Manual's contents
list links `#quick-start`, with no script.

## 2. What was built

- `collectHeadings` in `src/core/fragment.ts`, after the sanitizer: each
  heading gets `headingSlug` of its text — letters and digits of any script
  kept (`## 快速开始` → `快速开始`), punctuation dropped, at most 80
  characters — or `heading-<n>` when nothing is left. A repeated id is
  numbered `-1`, `-2`, … in document order and never repeats an id already in
  the body.
- `content.headings` carries `{ depth, text, id }`; the GFM footnotes label is
  not listed.
- An author's own id (inline HTML) keeps the sanitizer's `user-content-`
  prefix.
- `PIPELINE_VERSION` is `2`: every stored body re-renders once.
- Manual 2.1.0 links its contents list.

## 3. Owner decision, 2026-10-25

Plain ids (`#quick-start`), not prefixed: the link a reader and a table of
contents expect. The narrowing of the sanitizer's clobber protection that
this means is recorded in `SECURITY.md §4`.

## 4. Review fixes, 2026-11-01

- **Generated ids no longer take the theme's and plugins' own ids.** A
  heading called "Main" was a second `id="main"`, and every theme's skip link
  landed on it. `RESERVED_IDS` (`main`, `menu-toggle`, `products`,
  `capabilities`, `turnstile`) and the loop ids `hero-slide-<n>`, `shot-<n>`
  are now skipped; a test reads every fixed id in the official themes and
  plugins and fails if one is not reserved. Third-party themes are told to put
  an underscore in their ids, which a heading's id never has
  (`THEME_FORMAT.md §7.2`).
- **An author's id repeated in the body is numbered** like a repeated
  heading, so the contents link leads to the right one.
- A comment named a function that does not exist (`assignHeadingIds`).

The id rules changed under pipeline version 2, which has not been released,
so no stored body was rendered under the old rule.

## 5. Verification

`test/core/fragment.test.ts` (heading ids) and `test/core/themes.test.ts`
(Manual's links); each rule red-green checked by reverting it.
