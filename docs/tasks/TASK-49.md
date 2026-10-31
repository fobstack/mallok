# Task 49 — Prefix the default locale too

- Status: **done**, merged to `main`, not released.
- Date: 2026-10-25; review fixes 2026-10-31 and 2026-11-01.
- Scope: a site setting that puts the default language under its prefix
  (`/en/about`), everything that builds or answers a public address, and the
  switch itself.
- Source: the owner's item M2 (`docs/IMPLEMENTATION_PLAN.md`, phase seven).
  It supersedes phase six's "no always-prefix mode".

## 1. Demonstrable loop

Settings → Site → Languages → **Prefix the default language too**, confirmed:
`/about` answers 301 to `/en/about`, `/` answers 301 to `/en`, `/feed.xml` to
`/en/feed.xml`; canonical, hreflang and x-default, the sitemap, feeds, lists,
tags, the navigation and the inquiry thank-you redirect all use `/en/…`.
Unchecking it puts every address back, each old one redirecting.

## 2. What was built

- `site.prefix_default_locale` (migration `0009_site_locale_prefix`), off by
  default. `PATCH /settings` refuses to change it; it has its own confirmed
  endpoint, `POST /_mallok/api/settings/locale-prefix`, which moves every
  default-language path with a 301 from each old one and refuses, writing
  nothing, when a moved path would land on an existing one.
- Every path builder takes the setting (`src/core/paths.ts`): public paths,
  home paths, `parsePublicPath`, `site.home_path`, `site.kinds`, the SEO
  routes, the inquiry redirect, the admin's path preview.
- `site.json`, starters and `mallok build` carry it; a static build writes the
  root redirects to `_redirects` and a `noindex` refresh page.
- Plugins read `ctx.site.prefixDefaultLocale` and the `localePrefix` helper.

## 3. Upgrade guarantee

A site that leaves the setting off serves exactly the URLs it served before:
`test/worker/locale-prefix-golden.test.ts` and
`test/cli/build-locale-prefix.test.ts` compare every URL a site serves —
stored paths, statuses, redirects, every `href`, `src`, `<loc>` and `<link>`
— with fixtures recorded on the code before this task (`c6c6894`). They were
re-recorded once, for Atelier 2.5.2 (§4): the theme version in asset URLs,
and a translated article's tag link, which pointed at the default language's
archive. Nothing else moved.

## 4. Review fixes

From an independent review, 2026-10-31:

- **Old list, tag and home addresses kept answering.** Turning the prefix on
  left `/notes` and `/tags/x` as 404s, since no content row moved from them to
  record a redirect; they now answer 301 to `/<default>/…`, worked out as they
  are asked for. Turning it off records 301s from `/<default>`, each
  `/<default>/<base>` and each `/<default>/tags/<tag>` in use, and turning it
  on again removes them. Any other unprefixed address stays a 404.
- **The navigation is rewritten in the same change**, in every language's
  menu, leaving absolute URLs, paths under another language and `/_mallok/…`
  alone.
- **One transaction.** Paths, redirects, navigation and setting are one D1
  `batch()`; so is a change of default language, which was three separate
  writes. A failure leaves nothing changed (tested with a trigger that
  refuses the last statement).
- **Query strings survive every redirect**: stored ones, the root's, the
  feed's, and the worked-out list and tag ones.
- **The sitemap and feeds are cached under `site` too**, so the switch's
  whole-site purge reaches them.
- The confirmation text, the CLI's report and `ADMIN.md §6.6` say what moves.

2026-11-01:

- **Themes no longer write site addresses.** Atelier wrote `/tags/<tag>` and
  Gazette `/feed.xml`: wrong for a translated page on any site, a redirect on
  a prefixed one. `site.tags_path` and `site.feed_path` replace them (Atelier
  2.5.2, Gazette 2.0.1).
- **The owner's links are mapped as pages render** on a prefixed site:
  unprefixed paths in the navigation and in a theme's `string` options
  (Atelier's `quote_href` defaults to `/contact`) become `/<default>/…`
  (`linkForPrefix`). A site that never prefixes renders its links as
  written. A test renders every official theme's pages on a prefixed site and
  fails on any site link without a language prefix.

## 5. Verification

`test/worker/locale-prefix.test.ts`, the two golden tests, `test/core/
paths.test.ts`, `test/core/view.test.ts`, `test/core/themes.test.ts`, and the
browser test `test/e2e/16-locale-prefix.spec.ts`, which switches the setting
in the admin and waits for the root to redirect (60 seconds at most there:
the browser tests' site has no purge token). Every fix in §4 was red-green
checked by reverting it.

## 6. Open

- Not checked on a deployed site.
- Links inside page bodies are not mapped: a body written before the switch
  that links `/about` reaches it through the recorded redirect, but a body
  that links an unprefixed path created after the switch finds a 404. Only
  navigation and `string` options are mapped.
