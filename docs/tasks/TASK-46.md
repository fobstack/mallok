# Task 46 — Stale pages after a plugin switch, a settings change, or a first run

- Status: **done, except the check on a deployed site**, which waits for the
  next release to be deployed to the gate site (§5).
- Date: 2026-10-06
- Scope: what Nundar observed locally, sorted into what was a defect and
  what is the documented behaviour of a site without a purge token.
- Source: Nundar's item M21, received 2026-10-06
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. What was found

Nundar reported three things, all on a local run with no purge token.

| Observed | Finding |
| --- | --- |
| Switching a plugin on or off leaves cached pages as they were | **Already handled where it can be.** `POST …/plugins/<id>/enabled` and `PATCH …/plugins/<id>/settings` have purged the `site` tag since before this phase. A purge needs a token; with none, nothing is purged and the page waits out its cache lifetime. Not a defect; it was not written down for plugin authors, and now is |
| `PATCH /settings` with a new `nav` leaves cached pages as they were | The same: it purges `site`, given a token |
| A home page opened before setup is still served after setup, as "My Mallok site" | **A defect.** That page was stored for the default lifetime, 3600 seconds — the wizard's shortening to 60 comes later — and on a local run survived restarts. Fixed |

## 2. Demonstrable loop

Start a fresh site and open `/`: "My Mallok site", sent with
`Cache-Control: private, no-store`. Create the administrator and name the
site. Open `/` again: the site's name, at once, with no purge and no token.
From then on pages are cached as before.

## 3. What changed

| File | Change |
| --- | --- |
| `src/db/migrations/0007_site_claimed.sql`, `migrate.ts`, `queries.ts` | `site.claimed_at`, set for sites that already have an administrator |
| `src/db/auth.ts` | Creating the administrator marks the site claimed, in the same batch |
| `src/worker/pages/context.ts`, `home.page.ts`, `content.page.ts`, `tag.page.ts`, `seo-routes.ts` | Nothing an unclaimed site serves is stored |
| `test/worker/unclaimed-site.test.ts`, `site-claimed-migration.test.ts`, `release-contract.test.ts`, `flow.test.ts` | New, and two adjusted |
| `docs/`, `template/README.md` | `ARCHITECTURE §6.4`, `DATA_MODEL §2.2`, `PLUGIN_API §2`, the template's "Running locally", the plan, the changelog |

## 4. Decisions and deviations

- **Owner decision, 2026-10-06:** fix now what can be established locally,
  and confirm on the deployed gate site with the release.
- **"Unclaimed" means no administrator yet, not "setup not completed".** The
  wizard's completion flag was the obvious signal and the wrong one: nothing
  forces a site through the wizard's last step, so a site set up through the
  API would have lost its edge cache, silently, on upgrade.
- **The fact lives on the site row.** The render path reads that row already
  and reads neither `setup_claim` nor `admin_user`; a column costs it
  nothing. It is written in the batch that creates the administrator, so
  the two cannot disagree.
- **The migration marks existing sites from what they already record** — the
  claim, or for a site claimed before `setup_claim` existed, its first
  administrator. An existing site is cached after the upgrade exactly as
  before; this is tested for both cases and for a site with neither.
- **The SEO endpoints follow the same rule**: an unclaimed site's sitemap and
  feed are placeholders too.
- **No purge was added anywhere.** The two the item asks for were there.
- **Nothing was done to make a tokenless site fresh faster.** A tag cannot be
  purged without the API, and the wizard's 60-second lifetime is the existing
  answer. The docs now say what a local run should expect and how to empty
  Wrangler's on-disk cache.
- Two existing tests assumed an unclaimed site caches. `release-contract`
  now claims its site first, so its rules are still tested on stored pages;
  `flow` lists the new migration.

## 5. Verification

- `test/worker/unclaimed-site.test.ts`: on a fresh site the home page, a
  list page and the three SEO endpoints are served and none is in the cache;
  the home page is `private, no-store` with no tags; creating the
  administrator sets `claimed_at` to the claim's own time; after naming the
  site the home page shows the name at once, with no token bound; from then
  on all five are stored and the home page is a `HIT`; and with a token,
  switching a plugin on, switching it off and changing the navigation each
  send Cloudflare a purge of `site`.
- `test/worker/site-claimed-migration.test.ts`: migration 0007 run again on a
  site with no administrator, with a claim, and with an administrator and no
  claim.
- Each rule was checked by breaking it: seven single changes each turned a
  test red; one, the migration reading the claim, was not caught until the
  test pulled the two timestamps apart.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 6. Not covered, and known risks

- **[VERIFY] still open: a deployed site with a purge token.** That switching
  a plugin and changing a setting purge what they should there has been
  shown only against a stubbed Cloudflare API. To do when this release is
  deployed to the gate site: request a page, switch the inquiry plugin,
  request it again, and record `cf-cache-status` and the body both times.
- A page requested after the administrator exists and before the site is
  named or filled is cached like any other, and on a site without a token
  stays as it was for its cache lifetime.
- Migration 0007 has run on the local test database only.
