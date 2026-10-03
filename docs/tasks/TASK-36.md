# Task 36 — One translation group per published bundle

- Status: **done**.
- Date: 2026-10-03
- Scope: `mallok publish` and `mallok import` put every language of a bundle
  into one translation group, with or without `mallok.json`.
- Source: the owner's task list, item M12 (found publishing Nundar's sample
  content on 0.1.0-rc.7); `docs/IMPLEMENTATION_PLAN.md`, phase six.

## 1. Demonstrable loop

A bundle with `index.md`, `index.de.md`, `index.fr.md` and `index.es.md` and no
`mallok.json`, published to an empty site, lands as four rows in one
translation group, and each page carries hreflang to the other three.
Publishing it again reports every language unchanged. A bundle whose German
version the site already held joins that version's group.

## 2. What was wrong

For a bundle without `mallok.json`, `src/cli/publish.ts` posted each language
without a `translationGroup`, and the server's
`existing?.translation_group ?? input.translationGroup ?? crypto.randomUUID()`
gave each a group of its own — the four-rows-four-groups result the owner saw
on rc.7. `mallok build` groups by bundle, so the static and D1 paths
disagreed, and `CONTENT_FORMAT.md §2` rule 1 says a bundle is one group.

## 3. What changed

| File | Change |
| --- | --- |
| `src/worker/admin-content.ts` | The save response carries `translationGroup` (the unchanged answer too); `GET /content` accepts `slug` |
| `src/db/queries.ts` | `listContent` filters by exact `slug` |
| `src/cli/publish.ts` | A bundle without `mallok.json` joins the group of any language the site holds (by kind, locale, slug), else the group its first saved language receives |
| `docs/CONTENT_FORMAT.md §7.2`, `docs/CLI.md §6.2`, `§6.4` | The one-group rule, the lookup, and the repair for bundles split earlier |

## 4. Decisions and deviations

- **The save response did not return the group**, although the owner's list
  said it did; an audit of the plan caught it. The response now includes it.
- **A cheap lookup was added instead of reusing `findExisting`**, which lists
  up to 200 items and fetches each, and stays for `--dry-run` only. The server
  already had `findContentByKey`; the list route gained a `slug` filter.
- **A failed group lookup fails that bundle, not the run**: its languages are
  reported as failed rather than saved into separate groups, since saving
  without the group would reproduce the bug. An authorization failure still
  stops the run, as a failed save does.
- **Bundles already split are not merged.** The stored item's group wins, as
  before; the repair (delete the extra languages, publish again) is documented
  rather than rewriting stored groups behind the operator's back.
- **The lookup checks the slug of what comes back.** A site still running
  rc.8 or earlier ignores the unknown `slug` filter and answers with any item
  of the kind and locale; trusting it would file a bundle into an unrelated
  group. With the check, a newer CLI against an older site falls back to the
  old behaviour (a group per language) instead of corrupting groups. This can
  happen between `mallok upgrade` and the next deploy.
- Dry runs make no group lookup and are unchanged.

## 5. Verification

- `test/worker/publish-groups.test.ts` drives the CLI's real `publishBundles`
  against the real Worker: one group and hreflang to every other language;
  a second run all unchanged; joining the group of a language already held.
- `test/cli/publish.test.ts` gains four stub cases: the first language's new
  group reaches the others; a lookup answer for another slug, as an older site
  gives, is ignored; a failed lookup fails the bundle's languages and saves
  nothing; an authorization failure stops the run.
- `test/cli/dispatch.test.ts`'s stub site now answers the group lookup with an
  empty list, as an empty site does; before that, the new lookup's 404 failed
  its bundle, which is the intended behaviour for a failed lookup.
- Red-green: with the server changes kept and `src/cli/publish.ts` reverted,
  all three end-to-end cases fail (four groups instead of one) and the new
  stub cases fail; with it restored, all pass. Separately, with only the slug
  check removed, the older-site case fails.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`.

## 6. Not done / known limits

- Not run against a real Cloudflare account; the Worker test runs the same
  code in workerd.
