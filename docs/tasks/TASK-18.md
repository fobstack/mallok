# Task 18 — Documentation corrections for plugin API 2

- Status: **done**, documentation only.
- Date: 2026-10-02
- Scope: remove the statements that contradict phase six (plugin API 2), and
  give every planned extension point a place to be documented.
- Source: the owner's task list of 2026-10-01, item M0
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

A reader of the product documents no longer meets a line saying that Mallok
needs no new plugin concept, that Nundar is not a Mallok starter, or that
nothing in the repository is shaped for Nundar — and `PLUGIN_API.md §13`
lists every addition phase six plans, the task that delivers it, and where it
will be documented.

## 2. What changed

| Document | Before | After |
| --- | --- | --- |
| `PRODUCT_VISION.md §9` | A storefront needs "exactly the six plugin capabilities 0.1 built for the inquiry plugin. The core needs no new concept." | Names the generic extension points plugin API 2 adds; the storefront is the Nundar plugin, not the core |
| `PRODUCT_CONTRACT.md §2` | Nundar "has no bearing on this release and nothing in this repository is shaped for it in advance" | Nundar brings no commerce code; Mallok adds generic extension points any plugin can use |
| `PRODUCT_CONTRACT.md §5` | 0.1 does no carts or payments | Adds that the core still does none after 0.1, and that adding a generic extension point does not cross the line |
| `CONVENTIONS.md` (product boundaries) | Same carts-or-payments line | Same clarification, pointing at the contract |
| `RELEASE_GATE.md §15.1` | Nundar "is neither a Mallok starter nor a place to put one, and nothing in this release touches it" | Nundar is a starter, theme and plugin set with its own repository; the Deploy button needs the plain starter shell, which is a different repository |
| `ARCHITECTURE.md §15` | Nundar "is the commerce engine and has nothing to do with this" | Same correction as the release gate, keeping the point that the button's starter is not Nundar |
| `PLUGIN_API.md §1` | Five hooks and seven capabilities | Adds that version 2 builds optional hooks and capabilities on top (§13) |
| `PLUGIN_API.md §5.2` | A Markdown-engine change would take `pluginApi` "to 2" | It would take it to a new version, 3, because 2 is the additive version |
| `PLUGIN_API.md §13` | — | New: status, the compatibility rule, the table of planned additions, and the checks that apply to every plugin |

## 3. Decisions and deviations

- **Owner decision, 2026-10-01**: `CLAUDE.md`'s product boundary gains the
  same one-line clarification. `CLAUDE.md` is listed in `.gitignore`, so that
  edit exists in the working checkout only and is not part of this commit.
- **Found beyond the owner's list**: `PRODUCT_CONTRACT.md §2` ("nothing in this
  repository is shaped for it in advance") and `CONVENTIONS.md`'s
  carts-or-payments line contradicted phase six in the same way as the listed
  documents, so they were corrected here. `PRODUCT_VISION.md §5.4` and
  `ACCEPTANCE.md` (`AC-DEPLOY-02`) say only that the Deploy button's starter is
  not Nundar, which stays true; they were left as they are.
- `PLUGIN_API.md §5.2`'s reservation of version 2 for a breaking Markdown-engine
  change conflicted with using 2 for additive work, and was moved to 3.
- Every row of §13 is marked **Planned**; each later task changes its own row
  when it lands, so the table never describes something that does not exist.

## 4. Verification

No test framework covers prose, so the checks were:

- `git grep` for the contradicting phrases ("neither a Mallok starter", "no new
  concept", "nothing in this repository is shaped", "has nothing to do with
  this") finds none outside the plan, which quotes the old wording on purpose.
- Every fact §13 states about code was checked against it: the build-time
  refusal text in `src/core/plugin.ts`, `PLUGIN_API_VERSION = 1`, and that an
  admin session holds every scope (`hasScope` in `src/worker/auth.ts`), so the
  Task 19 fix affects API tokens only.
- `test/cli/release-gate-docs.test.ts` passes after the `RELEASE_GATE.md` edit.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 5. Not done / known limits

- `CONVENTIONS.md` still says "the one exception in 0.1 is the Turnstile
  widget", without Atelier's carousel approved on 2026-09-18. That is
  unrelated drift and is left for a separate change.
- The `CLAUDE.md` clarification is local to this checkout (§3).
