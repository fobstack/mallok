# Task 38 — A generated site type-checks and can be claimed locally

- Status: **done**.
- Date: 2026-10-03
- Scope: text-module type declarations for sites, and the setup key in the
  template's `.dev.vars.example`.
- Source: the owner's task list, item M15 parts 1–2 (found building a site
  from `mallok create` on 0.1.0-rc.7); `docs/IMPLEMENTATION_PLAN.md`, phase
  six. Parts 3–4 are Task 40.

## 1. Demonstrable loop

A site that installed only the `mallok` package imports a layout
(`./theme/layouts/base.liquid`), a stylesheet, a Markdown file and a plugin
migration (`./plugins/shop/0001_init.sql`), and `tsc` passes. A newly
generated site copies `.dev.vars.example`, runs `npm run dev`, and the wizard
accepts the key from that file.

## 2. What was wrong

- A site's `wrangler.jsonc` bundles `*.liquid`, `*.css`, `*.sql` and `*.md` as
  text, and the template's README shows importing a layout, but nothing
  declared those modules to TypeScript in a generated site. The declarations
  existed only in this repository's own `text-modules.d.ts`.
  `npm run typecheck` failed with `TS2307` the moment a site added its own
  theme or a plugin with a migration.
- `template/.dev.vars.example` had no `MALLOK_SETUP_KEY`. The wizard requires
  a key by default, so a new local site could not be claimed until its owner
  found out, from the framework's README, that one was needed.

## 3. What changed

| File | Change |
| --- | --- |
| `scripts/build-package.mjs` | Ships `types/text-modules.d.ts` and references it from `types/worker.d.ts` |
| `template/.dev.vars.example` | `MALLOK_SETUP_KEY`, how to generate it, and the commented development switch |
| `template/README.md` | A "Running locally" section; a note that text imports are typed by the package |
| `test/cli/strict-consumer.test.ts` | A site with its own theme and a plugin migration type-checks against the tarball |

## 4. Decisions and deviations

- **The declarations ship in the package's types, not as a file in the
  template.** The owner's list allowed either. A template file reaches only
  sites generated afterwards; the package's types reach every site on
  upgrade, because every site imports `mallok/worker`.
- **They are a separate file referenced from `worker.d.ts`.** `worker.d.ts`
  has imports, which makes it a module, and `declare module '*.liquid'` in a
  module is an augmentation of a module that does not exist. The reference
  line is added at package build time, since the path differs between this
  repository and the package.
- **`.dev.vars.example` documents both ways to claim a local site**: the key
  as the default, and `MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY=true` commented out,
  with the warning the template's `wrangler.jsonc` already gives — it belongs
  in `.dev.vars` only, and `mallok create` refuses to deploy a configuration
  carrying it.

## 5. Verification

- Red-green on the consumer test: before, `tsc` reported `TS2307 Cannot find
  module` for all four imports; with the declarations shipped, all nine
  consumer tests pass, including the one asserting that the published
  declarations name no package the tarball does not depend on.
- The template files are part of the reviewed package inputs
  (`scripts/package-inputs.mjs`); `test/cli/package-inputs.test.ts` and the
  package-boundary tests regenerate a project from the template and pass.
- No test framework drives the wizard from a generated project's
  `.dev.vars.example`. That path was checked by reading: `getSetupStatus` and
  `checkSetupKey` in `src/worker/setup.ts` require `MALLOK_SETUP_KEY` unless
  `MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY` is `true`, which is what the example
  file now says.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 6. Not done / known limits

- The local wizard was not walked through by hand from a freshly generated
  project in this task.
- **A site that already wrote its own `text-modules.d.ts`**, as Nundar did,
  now has the same wildcard modules declared twice. Measured with `tsc`: under
  `skipLibCheck: true`, which the template sets and explains, nothing is
  reported; under `skipLibCheck: false`, `TS2300 Duplicate identifier 'text'`.
  There is no way to write these declarations so that two copies merge. The
  upgrade note for the release that carries this task is: delete the site's
  own copy.
