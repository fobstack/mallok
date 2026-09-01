## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem, not the patch. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm bundle:size && pnpm admin:size` all pass
- [ ] New logic has tests
- [ ] Comments and docs match the final code
- [ ] No unrelated files touched, no debug leftovers, no secrets

## Things this repository is strict about

- `src/core/` must not import Cloudflare or Node APIs — it runs in Node, the
  browser and workerd alike.
- Everything in the repository is written in English: code, comments, tests
  and commit messages.
- Content, settings, theme options and plugin toggles change instantly.
  Themes, plugins and upgrades need a redeploy, and the UI must say so.
- Visitor pages ship no client-side JavaScript.

See `CONTRIBUTING.md` for the rest.
