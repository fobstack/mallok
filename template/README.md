# My Mallok site

A [Mallok](https://github.com/fobstack/mallok) site: Markdown in D1, published
instantly, running on your own Cloudflare account.

Everything the site *does* comes from the `mallok` package at the exact
version in `package.json`. What lives in this repository is what makes the
site yours: its configuration, its content, its theme choice and its plugins.

## Commands

```sh
npm install
npm run dev          # wrangler dev, with local D1 and R2
npm run build        # stage assets, then a production build
npm run lint
npm run typecheck
npm test             # this project's own checks
npm run smoke        # a real request to a real Worker
npm run deploy       # wrangler deploy
```

## Running locally

```sh
cp .dev.vars.example .dev.vars   # then replace the two change-me values
npm run dev
```

Open the address Wrangler prints. The first-run wizard asks for the
`MALLOK_SETUP_KEY` you put in `.dev.vars` before it creates the
administrator. `.dev.vars` is ignored by Git; keep it that way.

A local run has no purge token, so a change you save — content, settings, a
plugin's switch — shows on a page already in the cache only when that page's
cache lifetime (60 seconds after the wizard) has run out. Wrangler keeps the
cache on disk across restarts, under `.wrangler/state/v3/cache`; stop the
server and delete that folder to empty it. Pages opened before the
administrator exists are never cached.

## Upgrading Mallok

```sh
npx mallok upgrade --to 0.1.0-rc.11
```

It sets the exact version, installs it, and re-runs this project's own
typecheck, tests, build and deploy dry-run against what was installed. Run it
twice and the second run changes nothing. Your content, settings, theme and
plugins are untouched — they are yours, not Mallok's.

If anything fails, `package.json` and the lockfile go back and the previous
version is reinstalled. There is no project-file migration system in 0.1, and
nothing rewrites the files in this directory.

Database schema migrations are not this command's job: the Worker applies them
itself on its first request after a deploy.

## Your own theme

The five official themes come from the package (`atelier`, `folio`, `gazette`,
`journal`, `manual`). To use your own, put it in `src/theme/` and build it with
`defineTheme`:

```ts
import { createMallok, defineTheme } from 'mallok/worker';
import manifest from './theme/theme.json';
import base from './theme/layouts/base.liquid';
import page from './theme/layouts/page.liquid';

const mine = defineTheme(manifest, {
  'layouts/base.liquid': base,
  'layouts/page.liquid': page,
});

export default createMallok({ theme: mine });
```

`wrangler.jsonc` bundles `*.liquid`, `*.css`, `*.sql` and `*.md` as text, and
the `mallok` package declares those modules to TypeScript, so imports like the
ones above type-check as they are. A plugin migration imports its `.sql` the
same way.

`wrangler.jsonc` already declares the Text rule that makes those `.liquid`
imports work. The theme format is documented at
<https://github.com/fobstack/mallok/blob/main/docs/THEME_FORMAT.md>.

## What is not here

Mallok's own source, its admin app, its CLI and its tests are in the package,
not in this repository. That is deliberate: it is what makes
`mallok upgrade --to <version>` a one-line change instead of a merge.
