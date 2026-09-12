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

## Upgrading Mallok

```sh
npx mallok upgrade --to 0.1.0-rc.4
```

It sets the exact version, installs, applies any project migrations that
release needs, and re-runs lint, typecheck, tests and a deploy dry-run. Run it
twice and the second run changes nothing. Your content, settings, theme and
plugins are untouched — they are yours, not Mallok's.

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

`wrangler.jsonc` already declares the Text rule that makes those `.liquid`
imports work. The theme format is documented at
<https://github.com/fobstack/mallok/blob/main/docs/THEME_FORMAT.md>.

## What is not here

Mallok's own source, its admin app, its CLI and its tests are in the package,
not in this repository. That is deliberate: it is what makes
`mallok upgrade --to <version>` a one-line change instead of a merge.
