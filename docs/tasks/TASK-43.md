# Task 43 — A tagline, and a home page description, per language

- Status: **done**.
- Date: 2026-10-06
- Scope: the site's tagline may differ by language, everywhere it is set and
  everywhere it is shown.
- Source: Nundar's item M18, received 2026-10-06
  (`docs/IMPLEMENTATION_PLAN.md`, phase six).

## 1. Demonstrable loop

In Settings → Site, a site with English and German has a "Tagline (de)"
field under the tagline. Filled in, `/de/` is served with that text as its
`<meta name="description">` and as `site.tagline`, and the German feed is
described by it; `/` keeps the English one. Left empty, everything is as it
was. The same can be written in `site.json` as
`"tagline": { "en": "…", "de": "…" }`.

## 2. What changed

| File | Change |
| --- | --- |
| `src/db/migrations/0006_site_taglines.sql`, `src/db/migrate.ts`, `queries.ts` | A `taglines` column on `site` |
| `src/core/view.ts`, `index.ts` | `taglineFor`, `splitTagline`, `joinTagline`; `site.tagline` and the home description resolved by locale |
| `src/worker/site.ts`, `admin-settings.ts`, `admin-export.ts`, `seo-routes.ts`, `setup.ts` | Settings read and written as a string or a map; the export; the feed; a starter's tagline |
| `src/cli/site-model.ts`, `build.ts` | `site.json` and `mallok build` |
| `src/admin/pages/settings-site.tsx`, `types.ts`, `preview.ts` | A field per further language; the preview |
| `src/starters/`, `src/worker/public.d.ts` | The starter's and the plugin-facing types |
| `test/worker/tagline-languages.test.ts`, `test/core/view.test.ts`, `test/cli/build.test.ts`, `test/worker/setup-site-starter.test.ts`, `test/e2e/15-tagline-languages.spec.ts` | New cases |
| `docs/` | `DATA_MODEL §2.2`, `THEME_FORMAT §7.1`, `CONTENT_FORMAT §5`, `ARCHITECTURE §11.1`, `ADMIN`, the plan, the changelog |

## 3. Decisions and deviations

- **Owner decision, 2026-10-06:** the list's shape — a string, or a map of
  locale to string keyed like `nav`.
- **A second column, not JSON in the first.** `tagline` stays the default
  language's text, which is also the fallback; `taglines` holds the others.
  Nothing that reads `tagline` today reads something else tomorrow, and a
  tagline that happens to begin with `{` is still a tagline.
- **The interface is the union; the storage is not.** `PATCH /settings`,
  `site.json` and a starter take a string or a map; the settings endpoint
  and the export answer with a string until some other language has a
  tagline of its own, and with the map from then on. A script that reads
  `tagline` as a string keeps working on every site that has not used the
  feature.
- **Saving a string means one tagline for everyone**: it clears the others.
  Not sending `tagline` leaves all of them alone.
- **Blank is absent**, in the map and when resolving.
- **A plugin's `ctx.site.tagline` is unchanged** — the default language's —
  and `ctx.site.taglines` is new beside it. Changing the type of an existing
  field under a version 1 plugin was not an option.
- **The feed's description follows the language too.** Not in Nundar's item;
  it is the same string on the same kind of page, and leaving it would have
  been the next report.
- Map keys must look like locales; they need not be enabled. A language can
  be given its tagline before it is switched on, as with `nav`.
- The wizard's own steps do not ask for a tagline per language; a starter
  may bring one.

## 4. Verification

- `test/worker/tagline-languages.test.ts`, through the settings API and the
  public pages: a string stored and served as before; a map stored as two
  columns with the blank entry dropped and read back as a map; each
  language's home description, cold, including one rendered earlier with the
  old value and one with no tagline of its own; each language's feed; the
  export; a key that is not a locale refused; a patch without `tagline`
  leaving it alone; a string, then `null`, clearing the map.
- `test/core/view.test.ts`: the resolution rule, `site.tagline` by locale,
  and the split and join both ways.
- `test/cli/build.test.ts`: a `site.json` with a map builds each language's
  home page and feed with its own.
- `test/worker/setup-site-starter.test.ts`: a starter's map is stored.
- `test/e2e/15-tagline-languages.spec.ts`: in a browser, the field for the
  second language appears, saves, survives a reload, and emptying it returns
  to one tagline.
- Each guarantee was checked by breaking it: fourteen single changes each
  turned at least one test red. One, a blank stored value, was not caught by
  the first tests and now has a unit test.
- The gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 5. Not covered, and known risks

- The migration has run on the local test database only, not on a deployed
  site's.
- A home page already in the edge cache keeps its old description until it
  expires or is purged, like any settings change.
- The wizard cannot set a tagline per language.
