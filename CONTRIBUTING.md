# Contributing to Mallok

Mallok is early. Until 0.1 ships, work is organised as numbered tasks under
`docs/tasks/`; each task implements one demonstrable loop and ends with test
evidence. Read the design documents first. If implementation, measurements, and design
disagree, describe the conflict and propose a correction with evidence.

## Language

English is the primary language for code, comments, commit messages, tests,
and technical documentation. Chinese translations are welcome in
`README.zh-CN.md`, `CONTRIBUTING.zh-CN.md`, and `docs/zh-CN/`.
Link translations to their English originals and keep changes in sync.
Do not replace English entry points with a translation or label an English
link as if it were already translated.

[中文贡献指南](CONTRIBUTING.zh-CN.md)

## Code style

The code follows the
[Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html).
The parts a formatter can enforce are configured in `biome.json` and checked
by `pnpm lint`; the rest is reviewed by hand. The rules that matter most:

- **Formatting**: 2-space indent, single quotes, semicolons, trailing commas,
  80 columns. Run `pnpm lint:fix` before committing.
- **Naming**: `UpperCamelCase` for types, interfaces, classes and enums;
  `lowerCamelCase` for variables, functions, methods and parameters;
  `CONSTANT_CASE` for module-level constants that are truly immutable.
  No `I` prefix on interfaces, no `_` prefixes. Two deliberate exceptions to
  camelCase: database columns and the view objects handed to Liquid
  templates use `snake_case`, because SQL and Liquid conventions do.
- **Files**: lowercase with hyphens (`theme-cache.ts`). One concept per file.
- **Modules**: named exports only; `import type` for types; no `namespace`,
  no default exports except where a framework requires one (the Worker entry
  point, the Vitest config).
- **Types**: `strict` plus `noUncheckedIndexedAccess`; `unknown` instead of
  `any`; no non-null assertions; validate external input with `zod` at the
  boundary and trust types inside.
- **Comments**: every exported symbol has a JSDoc sentence that says what it
  is for. Inside functions, comment *why*, not *what*. Comments are full
  sentences with a period.
- **Control flow**: `const` by default, `===` always, early returns over deep
  nesting, `for...of` over index loops, no clever one-liners.
- **Errors**: never leak SQL, bucket names, ids or stack traces to a client.
  Log a structured JSON line instead.

## Layering rules

- `src/core/` must not import Cloudflare or Node APIs. It is type-checked
  against `lib.webworker` only (`src/core/tsconfig.json`) and lint-blocked
  from Workers-only globals. This is what guarantees that the CLI, the admin
  preview and the Worker render byte-identical HTML.
- `src/db/` owns every SQL statement. Nothing else builds queries.
- Rendering is deterministic: no `Date.now()`, no randomness, no request
  headers inside `src/core`.
- New dependencies go through the gate in `docs/TECH_STACK.md §11`: exact
  versions, a note on which layer they belong to, and their gzip size.

## Commits

Conventional Commits, imperative mood, English:

```
feat(core): resolve relative asset paths in stage one
fix(worker): release the migration lock on failure
docs: record cache purge measurements
```

Do not commit secrets, generated bundles or `.dev.vars`.

## Running the checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build && pnpm bundle:size
```

All four must pass before a task is considered done.

## Beyond style

This document covers mechanical style. The boundaries a change is held to —
what the product is and is not, what the engineering may not do, how a claim
becomes a fact — are in [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md). Read it
before proposing anything structural.
