# Task 40 — `mallok publish` from a project root

- Status: **done**.
- Date: 2026-10-03
- Scope: `mallok publish . --with-settings`, run from the root of a project
  made by `mallok create`, publishes that site's content and nothing else.
- Source: the owner's task list, item M15 parts 3–4 (found building a site
  from `mallok create` on 0.1.0-rc.7); `docs/IMPLEMENTATION_PLAN.md`, phase
  six. Parts 1–2 are Task 38.

## 1. Demonstrable loop

In a generated project whose `site.json` enables a `product` kind the site
does not have yet, `mallok publish . --with-settings` applies the settings
and publishes exactly the bundles under `content/`, the products included.
The package's own template content in `node_modules`, the README and
everything else in the project are left alone.

## 2. What was wrong

- A project root holds `site.json` and `content/`, so it was already detected
  as the export layout. But `scanDirectory` collected every `index*.md` under
  the root whatever the layout, and its file walk entered every directory:
  `node_modules/mallok/template/content/page/hello` was published as a page
  of the site. A top-level `README.md` was taken for a loose file, matched no
  kind, and was dropped.
- `--with-settings` read the site's kinds before it applied `site.json`, so
  the bundles of a kind that file enables were dropped.

## 3. What changed

| File | Change |
| --- | --- |
| `src/cli/scan.ts` | In the export layout only `content/` is read; `node_modules` and `dist` are skipped at the top of the scanned directory, hidden directories at any depth |
| `src/cli/index.ts` | `site.json` is applied before the site's kinds are read |
| `docs/CONTENT_FORMAT.md §7.1`, `docs/CLI.md §6.1` | A project root as the export layout; what is skipped; the order under `--with-settings` |

## 4. Decisions and deviations

- **Owner decision, 2026-10-03: a project root is a supported input.**
- **The skip list is narrower than the owner's list asked for.** The list
  said to skip `node_modules`, `dist`, `.wrangler`, `.mallok` and
  dot-directories. Skipping `dist` and `node_modules` at every depth would
  silently drop an item whose slug is one of those words — the same class of
  bug as the `prototype` and `constructor` slugs fixed in rc.7. They are
  skipped at the top of the scanned directory only, which is where a project
  keeps them; hidden directories are skipped everywhere, since no kind or
  slug starts with a dot. A test holds a page with the slug `dist`.
- **Reading only `content/` in the export layout** is what keeps a project's
  README, plugin documentation and sources from being treated as content. The
  skip list alone would not: those are ordinary directories.
- **`--with-settings` wrote during `--dry-run`**, before this task and after
  it; applying the settings earlier did not change that. It was fixed right
  after as its own change: a dry run now reports the settings it would apply
  and resolves kinds from them locally, without a PATCH.

## 5. Verification

- `test/cli/scan.test.ts`: a project root yields only its `content/` bundles
  among a README, sources, `node_modules`, `dist`, `.wrangler`, `.mallok` and
  `.git`; the skip list applies in the bundle layout too; a slug named `dist`
  or `node_modules` under `content/` is still read.
- `test/cli/dispatch.test.ts`: the whole command, from a project root with
  `--with-settings`, over a stub site whose kinds change when the settings are
  patched — the product is published and the template's page is not.
- Red-green, each fix on its own: with `src/cli/index.ts` reverted the product
  is dropped; with `src/cli/scan.ts` reverted the template's `page/hello` in
  `node_modules` is published and the scan tests collect eight bundles
  instead of two.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 6. Not done / known limits

- **A bundle whose directory matches no enabled kind is dropped without a
  word whenever at least one other bundle is found.** `scanDirectory` raises
  its "do not match any content type" error only when nothing at all was
  placed, while `CLI.md §6.1` and `CONTENT_FORMAT.md §7.1` say the import
  stops and lists what it could not place. That is how the owner's missing
  kinds went unreported on rc.7. This task removes the cause in the
  `--with-settings` case; the silent drop itself is unchanged and is left for
  a separate decision, since making it an error would stop runs that pass
  today.

- Not run against a real site; the command test uses a stub site.
- A kind directory named `dist` or `node_modules` at the top of a directory
  of bundles is skipped. No theme declares such a kind.
