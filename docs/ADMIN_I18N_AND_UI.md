# Admin interface languages and interface review

- Status: **decided; phases 0 and 1 implemented, phase 2's strings wrapped
  and translated** on 2026-11-13. The owner took every recommendation in §3
  as written ("按照建议来"): D1 A (Lingui), D2 B built as A first, D3 C, D4
  C, D5 as an addition under plugin API 2, D6 unchanged, D7 the four rules,
  D8 C. Phase 0's numbers are in §8; D1 stands. Phase 2's gate is not yet
  complete — §8 says which parts ran.
- Date: 2026-11-12
- Asked for by the owner on 2026-11-12, in two parts: the admin and the setup
  wizard have no multilingual support, and the admin's interface needs
  adjusting. The second part named no page; §2.3 is what looking at every
  screen found.

## 1. Goal

1. An operator chooses the language the admin and the setup wizard speak.
   English and Simplified Chinese ship; a further language is a catalog and
   one line in a list, with no change to a page.
2. The interface problems listed in §2.3 are fixed, page by page, without
   changing what the admin does.

Out of scope: any change to the public site or its language packs, the
content model's languages (`site.locales`, `locale`, `translation_group`),
starter content (it is content, not interface), automatic translation of
content, the CLI's messages, right-to-left layout, and any new admin feature.
Three places where `ADMIN.md` describes something the admin does not have
are listed in §9 as conflicts for the owner; this plan does not build them.

## 2. Where it is today

Measured in the repository on 2026-11-12, at `a4b10e0`.

### 2.1 Language

| Fact | Value |
| --- | --- |
| Translation mechanism | None. Every string is English, written in the JSX |
| Source to cover | 8,765 lines of TypeScript and TSX in `src/admin` outside `components/ui/` (11,184 with it) |
| Document language | `src/admin/index.html` has `lang="en"`, fixed |
| Sentences with markup inside them | 23 uses of `<Code>` and 8 of `<strong>` or a link inside running text (the wizard's setup-key help, the purge notice, the domain step) |
| Plurals | Seven, each hand-built with `=== 1 ? '' : 's'` or left wrong on purpose ("1 pages", which `01-wizard` asserts) |
| Number and date formatting | Four call sites, three behaviours: `Intl.NumberFormat('en', …)` in `components/record-editor.tsx`; `toLocaleString()` with the browser's locale in `pages/account.tsx` (twice) and `pages/settings-advanced.tsx`; the content list prints `updatedAt.slice(0, 10)` |
| Native dialogs | Two `window.confirm` calls with long English sentences (`pages/settings-site.tsx`) |
| First load | **161.7 KiB gzip of 170** (`node scripts/admin-size.mjs` on the existing build output): 8.3 KiB of headroom |
| Strings from themes | `theme.json`: `kinds.*.label`, each field's `label`, `help` and `group`, each option's `label`; `select` `choices` are bare strings that are both the stored value and the text shown. English only |
| Strings from plugins | `plugin.json`: `name`, `description`, each setting's and secret's `label`, each panel's `label`, column labels, action labels, a script's `purpose`; badge cells print the row's raw value. English only |
| Strings from the Worker | 146 `problem(status, message)` calls in `src/worker` and `src/plugins`; the body is `{ "error": "<English sentence>" }`, sometimes with `errors: { field: "<English sentence>" }`. **There are no error codes.** Many messages are assembled with values in them |
| Email | The inquiry notification to the operator is English only; the autoreply to a visitor has English and Chinese chosen by the *content* language of the page (`src/plugins/inquiry/emails.ts`) |
| Browser tests | 41 tests in 20 spec files; 176 selectors by role, 62 by label, 20 by text — all English |
| Where a preference could live | Nowhere yet. `admin_user` has `id`, `email`, `password_hash`, `password_params`, `created_at` (`DATA_MODEL.md §2.8`); the colour scheme and the sidebar's state are in `localStorage` |

Two things already in the repository look reusable and are not, as they are:

- **A theme's `locales/<locale>.json`** is the public site's text
  (`THEME_FORMAT.md §10`): a flat map read by templates, keyed by the
  *content* language (`zh`), with no interpolation. A few keys coincide with
  field names (`moq`, `lead_time`, `grade` in Atelier's pack) but they are
  what a visitor reads, not what an operator reads, and no option label
  ("Hero headline") is there. See D4.
- **The content editor's language bar** switches which translation is being
  edited. It is the control most likely to be mistaken for an interface
  language switch. See D7.

### 2.2 What the libraries cost, measured

**Method.** A throwaway Vite 8.3.8 project (React 19.2.8,
`@vitejs/plugin-react` 6.3.0), outside the repository. One small screen was
written once per approach: a heading, a sentence with a value in it, a
plural, two buttons, and a switch that loads the other language's catalog
with a dynamic `import()`. The number is gzip of what `index.html`
references, as `pnpm admin:size` counts it; catalogs are separate chunks in
every variant and are not in it. **These are a scaffold's numbers**: good
for what a library adds, not for this admin's total, which phase 0 measures.

| Approach | Versions | Adds to first load |
| --- | --- | ---: |
| React only | — | 58.0 KiB (base) |
| In-repository: a context, `{name}` substitution, plural forms picked with `Intl.PluralRules` | — | **+0.9** |
| The same with a splitter for `<code>…</code>` inside a message | — | **+1.0** |
| Lingui, runtime only, catalogs compiled by hand | `@lingui/core`, `@lingui/react` 6.12.0 | **+3.3** |
| Lingui as it is meant to be used: `Trans`, `Plural` and `t` macros, `lingui extract`, `.po` catalogs compiled by its Vite plugin | + `@lingui/vite-plugin`, `@lingui/cli` 6.12.0 | **+4.2** |
| An in-repository context around `intl-messageformat` | 12.1.5 | +10.3 |
| FormatJS | `react-intl` 12.1.7 | +14.6 |
| i18next, its own plural format | `i18next` 27.1.1, `react-i18next` 18.0.1 | +17.6 |
| i18next with ICU messages | + `i18next-icu` 2.7.0 | +29.8 |

Also established by running it, not from memory:

- **Lingui's macro build works on this stack without Babel or SWC.**
  `lingui({ macroTransform: true })` beside `@vitejs/plugin-react` built
  under Vite 8; its installation page (read 2026-11-12) says this path
  "doesn't need `@lingui/babel-plugin-lingui-macro` or `@lingui/swc-plugin`".
  That matters here: phase 5 of the last migration deleted the admin's Babel
  transform because it could fail silently (`ADMIN_MIGRATION.md §8`).
- **Extraction works.** `lingui extract` found all six messages of the
  screen, wrote `en.po` and `zh-CN.po`, and reported "zh-CN: 6 total, 6
  missing". A sentence with markup became one message with numbered
  placeholders (`Printed once by <0>mallok create</0>. …`), so a translator
  can reorder it.
- **The built page ran in Chromium in both languages**, with the right
  plural form, `<html lang>` following the choice, and the second catalog
  fetched only on the switch. The compiled Chinese catalog for the six
  messages was 0.3 KiB.
- **Playwright's default context reports `navigator.language` as `en-US`**
  on this (Chinese-language) machine, so a test that does not ask for a
  locale gets English from browser detection.

Read from current documentation on 2026-11-12, not measured:

| | ICU plurals and select | Keys checked by the compiler | Extraction from source |
| --- | --- | --- | --- |
| In-repository | No. Plural forms only, by category | Yes, if catalogs are TypeScript objects of one type | None; keys are written by hand |
| Lingui | Yes ("ICU MessageFormat under the hood") | There are no keys to mistype with macros: the English sentence in the source is the message. Its docs also list a "Typed Message IDs" guide, not read here | `lingui extract`; `compile` produces the runtime catalogs and "ships no message parser" |
| FormatJS | Yes | Not established here | `formatjs extract` |
| i18next | Its own `_one` / `_other` suffixes on `Intl.PluralRules`; ICU through `i18next-icu` | Yes, by augmenting `CustomTypeOptions`; its docs warn of slower type checks and lost inference for template-literal keys | Separate tools; not examined |

Lingui's installation page asks for Node 22.19 or higher; `.nvmrc` is
22.22.2.

### 2.3 The interface, from screenshots

A separate local instance (its own port and state directory, the
`trade-b2b` starter, the Atelier theme, three content languages) was driven
with Playwright through the wizard and every admin page at 1440 px and
390 px, light and dark: 86 screenshots, kept outside the repository. The
content list, the Site page, the plugins page and the editor were then
re-captured with their text replaced in the page by Chinese and by German
of realistic length. What follows is from those images; where a claim is
from code it says so.

**What holds up.** Light and dark are consistent on every page. No page
scrolls sideways at 390 px. With Chinese or German text nothing overflowed
or was clipped in the sidebar (256 px wide; "Erweiterte Einstellungen"
fits), the buttons, the badges or the table headings. Chinese renders in the
system's CJK face through the existing stack at the existing sizes and line
heights (14 px on 20 px in controls and tables) and reads well — **on macOS,
the only system measured.**

| # | Where | What is wrong | What it should become |
| --- | --- | --- | --- |
| U1 | Every page | The standing "Changes reach visitors within 1 minute" notice is three lines at 1440 px and **seven at 390 px, above every page, the editor included**. It names `CF_API_TOKEN`, `CF_ZONE_ID` and "Worker secrets" — the vocabulary `ADMIN.md §2` keeps to Advanced | One line: the sentence in its title and a "Why?" link to Advanced → Diagnostics, where the secret names already are. Still standing, still `role="note"` |
| U2 | Every page | Three widths on one screen: the notice spans the window; the content list and editor are 68 rem; settings pages are 56 rem **left-aligned inside the centred 68 rem column**, so at 1440 px they sit 84 px from the sidebar and 205 px from the right edge | One column rule: the notice, the page header and the page share a left edge and a width; forms cap their own fields, not the page |
| U3 | Sidebar | **Inquiries, the thing a trade site's operator opens every day, is the last block of the Plugins page**, about 1,500 px down, under nine settings and a secret. The last migration's D4 recommended "each plugin's panels listed under Plugins"; the sidebar that shipped has one Plugins link. There is also no way to open the public site from the admin | See D8 |
| U4 | Content list | The Type column prints the kind's id (`article`) while the Type filter, one row above, prints the theme's label ("Note"); statuses are raw lowercase values; languages are bare codes (`en`); the date is a sliced ISO string | Labels from the theme, status names from the catalog, language names from `Intl.DisplayNames` with the code beside them, dates through one formatter (§5.4) |
| U5 | Content list | A "Media" button duplicates the sidebar item beside it. "New" does not say what it makes. Previous and Next are drawn, disabled, when there is one page. "Nothing here yet." is shown both for an empty site and for a filter that matches nothing, with no action in either | Drop "Media". Hide the pager when there is nothing to page. Two empty states: an empty site offers "Create the first page"; an empty filter says so and offers "Clear filters" |
| U6 | Content list, 390 px | The table scrolls sideways and Path and Updated are off screen, so a phone shows title, type and status only — by accident, not by design | Below `md`, a row is the title with type and status under it; Path and Updated are dropped on purpose |
| U7 | Editor, 1440 px | The editor is held to 68 rem, so each pane is about 330 px while 350 px of the window is empty. Markdown wraps at about 35 characters and the preview shows the theme's phone layout. `ADMIN.md §10` says the editor "fills the window"; `§6.1` says the columns collapse, and the code has no collapse control | The editor route is full-bleed. The field pane collapses to a rail; the source and preview split what is left |
| U8 | Editor | Nothing says whether the open item is published, a draft or scheduled, or when it was last saved, and there is no link to it on the site. `ADMIN.md §6.1` draws a status bar with exactly those | A status badge and "Updated …" beside the title controls, and "View on site" for a published item |
| U9 | Editor, 390 px | Fields, then the whole source, then the preview, in one column about 2,000 px tall; Save draft and Publish scroll away with the top | Three tabs — Fields, Write, Preview — and the two buttons in a bar that stays on screen |
| U10 | Four places | The language of *content* is chosen with four different controls: a select in the list's filters, chips ("en", "Create zh") in the editor, an "Editing" select on Appearance, and a suffix on a label ("Tagline (zh)") on Site. All show bare codes | One component, always labelled "Content language", always showing the language's name and code. This is also what keeps it apart from the interface language (D7) |
| U11 | Plugins | The card opens with Hooks, Client JavaScript and a script URL; the settings follow; the panel is last. Help is written into labels ("From address for inquiry email (empty uses the sender in Settings → Email)") although fields have a `help` key. A Liquid body is typed into a one-line input. The Status filter is a free-text box with the placeholder "any". "Mark replied" and "Mark spam" are enabled with no row selected (from code: only the pager is ever disabled) | Order: panel link, settings, secrets, then "Technical details" (hooks, scripts, cache effect) closed by default — still there, as `ADMIN.md §10` requires. The inquiry manifest moves its parentheses into `help` and its body to `text`. A filter on a column with known values is a select. Bulk actions are disabled until a row is selected |
| U12 | Settings → Site | "Only this host is indexable. Without one, every page is served noindex and the edge cache does not apply." and "An R2 custom domain … through the Worker." are infrastructure wording on the first settings page. One textarea per extra language is stacked full-width (two here; six languages would be six). The first card has a Save button; the Languages card below acts at once — two models on one page with nothing telling them apart. A new language is typed as a code | Plain wording, with the detail under Advanced. Taglines for other languages behind the one content-language control (U10). Cards that act at once say "Applies immediately" where a Save button would be. Adding a language offers names, with a typed code still accepted |
| U13 | Settings → Appearance | 370 px of facts and a deploy notice stand between the heading and the first option an operator can change | Options first; the theme's facts and the deploy note after them |
| U14 | Settings → Advanced | The one action an operator needs here, "Export everything", is the fourth card. Storage rows are raw keys (`jobsPending`, `fragments`). On a fresh site five of five diagnostics are orange | Backup first. Labels for the storage rows. Orange only for what stops something working; "not set up yet" is neutral |
| U15 | Saving, everywhere | Success is an inline badge beside the button, failure is a toast, sign-in failure is an inline box. With no purge token, a *successful* save is the orange warning badge "Saved — visitors see it within 1 minute", which reads as a problem | Success is always the green badge "Saved"; the delay is plain text after it. Failures stay where they are |
| U16 | Wizard, step 2 | The first question a non-technical owner meets is "Main language" as a free-text code and "Other languages" as "zh, de", comma separated | A select of language names for the main language and a multi-select for the others, drawn from the active theme's packs first, with a typed code still accepted |
| U17 | Wizard | Five numbered dots for what `ADMIN.md §5` calls four steps: "Finish" is a result, not a step. There is no Back. The password is typed once, unseen, with no way to show it. Step 4 is two paragraphs of Cloudflare dashboard directions plus the secret names | Four steps and a result screen. Back on steps 2–4. A show-password toggle. Step 4 keeps its first, honest paragraph; the directions become a link to the documentation |
| U18 | Sign-in | "The site's admin" names no site, and there is nowhere to choose a language before signing in | The site's name where the session-less API can give it, otherwise as now; the interface-language control of D2 |
| U19 | Empty states | "Nothing here yet.", "No media yet." and "No rows yet." are three wordings in two dashed boxes that look like the upload drop zone next to them | One empty-state block: what is empty, and the one action that fills it |
| U20 | Type size in Chinese | Sidebar group labels and badges are 12 px. Latin survives that; Chinese at 12 px is at the edge of comfortable | Under a CJK interface language these two go to 13 px. No other size changes |

## 3. Decisions the owner has to make

### D1 — The translation mechanism

| | A. Lingui | B. In the repository | C. FormatJS or i18next |
| --- | --- | --- | --- |
| First load (§2.2) | +4.2 KiB | +1.0 KiB | +14.6 to +29.8 KiB |
| Fits 170 KiB | Yes, with about 4 KiB left | Yes, with about 7 KiB left | **No.** The budget would have to be raised again, nine days after it was raised to 170 |
| What a page looks like | The English sentence stays in the JSX, wrapped: `<Trans>Save draft</Trans>` | Every sentence moves to a catalog and the JSX holds a key: `t('editor.saveDraft')` | Keys, as B |
| Plurals, sentences with markup | ICU; markup as numbered placeholders | Plural categories only; a hand-written splitter for markup | Yes |
| Missing translation | Reported by the extractor | A type error | Varies |
| Cost | Four packages; a build-time transform in `vite.config.ts` again; `.po` files | A formatter and a splitter written and owned here; ~8,700 lines re-keyed by hand | Size |

**Recommended: A, Lingui, confirmed by phase 0 in this admin's own build.**
It fits, it was seen to work on this stack without Babel, and it leaves the
English in the source — so the browser tests' selectors and the code they
drive stay readable side by side. B is smaller, but it is writing the
library: `TECH_STACK.md §11` rule 6 says adding no dependency is not a
reason to hand-write what a mature ecosystem has solved, and that rule
names parsing. If phase 0 finds Lingui does not fit or its transform is
fragile here, B is the fallback and C is not.

### D2 — Where the operator's choice lives

| | A. This browser only | B. The account, mirrored in the browser | C. A site-wide default |
| --- | --- | --- | --- |
| Storage | `localStorage`, like the colour scheme | A nullable `admin_user.ui_locale` column (migration `0010`, additive), plus `localStorage` | A `site` column |
| Before sign-in (wizard, sign-in page) | Works | Works, from the mirror or the browser's language | Needs an unauthenticated read |
| A second browser or a phone | Asks again | Follows the operator | Follows the site, not the person |
| Gives the Worker a language for operator email | No | Yes | Yes |

**Recommended: B, built as A first.** Phase 1 ships A: the choice in
`localStorage`, else the first of `navigator.languages` the admin has a
catalog for, else English. Phase 3 adds the column and one field on the
existing account endpoint; from then the account's value wins after sign-in
and is copied to the browser, so the next sign-in page is already in it. The
wizard's choice is carried into the account when it creates the
administrator. C is not recommended: 0.1 has one administrator, and a site
default would be a third place to look for no one's benefit.

### D3 — The Worker's messages

| | A. Codes, translated in the admin | B. `Accept-Language`, translated in the Worker | C. Codes where they exist, the Worker's English otherwise |
| --- | --- | --- | --- |
| API change | `code` and `params` added beside `error`; `errorCodes` beside `errors` | None in shape; the same request now answers in different languages | As A, additive |
| Catalogs | In the admin, on demand | In the Worker script, every language, on the render path's size budget | In the admin |
| The CLI and scripts | Unaffected: `error` stays English | Must send English or parse translated text | Unaffected |
| Work | All 146 sites before anything is translated | All 146 sites and a formatter in the Worker | Incremental |

**Recommended: C.** `error` stays exactly as it is — the CLI prints it, and
it is the fallback. A site that gains a `code` also gains its `params`, and
the admin shows its own sentence when its catalog has that code and the
Worker's English when it does not. English is then the worst case, never a
blank or a key. Order of work: sign-in and setup, content save, media
upload, settings, then the rest. A plugin's own validation messages follow
D5.

### D4 — Labels declared by themes

Kinds, fields, groups, help text and options are English in `theme.json`.

| | A. Leave them English | B. Reuse `locales/<locale>.json` | C. A separate, optional admin catalog per theme |
| --- | --- | --- | --- |
| Contract change | None | The public pack gains admin keys | `admin/<ui-locale>.json` beside `theme.json`: a flat map keyed by declaration path (`kinds.product.label`, `kinds.product.fields.grade.label`, `options.hero_title.label`, `groups.Specification`) |
| Result | A Chinese interface with English field labels in the editor — the page an operator uses most | Visitor text and operator text in one file, keyed by content language (`zh`), not interface language (`zh-CN`) | Themes without the file work as today |

**Recommended: C.** The file is optional, additive, validated at build time
like the public packs, and bundled the same way. The Worker overlays it on
the manifest it already serves from `GET /_mallok/api/theme`, choosing by
the `Accept-Language` the admin sends (§5.3) — the admin's code does not
change and no theme string enters the admin bundle. A missing key falls back
to the declared English. `THEME_FORMAT.md §10` gains a section; the five
official themes get `zh-CN`. **Not solved here:** a `select`'s `choices` are
stored values; showing a translated choice needs a value/label form of
`choices`, which is a change to the field schema and is left as an open
question (§9).

### D5 — Labels declared by plugins

The same shape as D4, for `plugin.json`: `admin/<ui-locale>.json` in the
plugin's directory, keyed `name`, `description`, `settings.<key>.label`,
`settings.<key>.help`, `secrets.<key>.label`, `panels.<id>.label`,
`panels.<id>.columns.<field>`, `actions.<id>`, `values.<field>.<value>` for
badge cells (`new`, `replied`, `spam`), and `errors.<code>` for a plugin
that returns codes under D3.

**Recommended: take it, as an addition under plugin API 2**
(`PLUGIN_API.md §13.1`: version 2 only adds). A plugin without the file is
shown in English, so the official `inquiry` plugin keeps running unedited as
the compatibility proof and gets its `zh-CN` file as a separate commit. A
site-level plugin such as Nundar's gets translated panels by adding one
file.

### D6 — Email and what the wizard writes

- **Starter content** stays as it is: it is content, in the content's
  languages.
- **The visitor's autoreply** already follows the content language of the
  page. Not touched.
- **The operator's inquiry notification** is the one message addressed to
  the admin's reader. **Recommended: leave it English in this plan**, and
  decide after D2's column exists whether it should follow the
  administrator's `ui_locale`. It is sent from a visitor's request, where no
  session says who will read it, and the recipient is an address in the
  plugin's settings, not an account.

### D7 — Keeping the interface language apart from content languages

**Recommended, as rules:**

1. The interface language is chosen in exactly three places: the account
   menu (a radio group under "Colour scheme"), the sign-in page and the
   wizard (a small menu in the corner). Never in a page's toolbar.
2. It is always called "Interface language" and lists each language in its
   own name: "English", "简体中文".
3. A content language is always called "Content language" (or "Site
   languages" in Settings), always through the one component of U10, and
   always shows name and code: "German (de)".
4. In data they do not meet: interface languages are BCP 47 tags the admin
   has catalogs for (`en`, `zh-CN`); content languages are whatever codes
   the site declares. Neither defaults from the other, in either direction —
   a Chinese-speaking operator of an English-only site is the common case.

### D8 — How much of §2.3 to do, and the sidebar

| | A. Translation only | B. Translation and the review's fixes | C. B, and plugin panels in the sidebar |
| --- | --- | --- | --- |
| Covers | Phases 0–3 | Phases 0–4: U1, U2, U4–U20 | B plus U3 |
| Changes behaviour | No | Layout and wording, no flow | A new route per declared panel |

**Recommended: C.** U3 is the finding that matters most to a trade site: a
declared panel appears under Site in the sidebar by its label
("Inquiries"), at `/plugins/<plugin>/<panel>`, and the Plugins page keeps
the switch, settings and secrets with a link to the panel. A panel attached
to a content kind stays in that kind's editor and is not listed. A link to
the public site joins the sidebar's header. The order of the fixes inside
phase 4 is the owner's taste as much as anyone's; the proposed order is
there.

## 4. Constraints that do not move

| Constraint | Source | What it means here |
| --- | --- | --- |
| First load ≤ 170 KiB gzip | `ADMIN.md §13`, `pnpm admin:size` | 8.3 KiB of headroom. English is the fallback and is compiled into the entry only if phase 0 shows that costs less than a second request; every other catalog is a chunk fetched on demand. Each phase reports the number |
| Everything in the repository is English | `CONVENTIONS.md`, Style | Source strings, comments and tests stay English. A catalog in another language is a translation "where it serves a real user", the same footing as a theme's `zh.json` |
| No serious or critical axe violation, light and dark | `test/e2e/05-accessibility.spec.ts` | Run in both interface languages. `<html lang>` follows the choice; an untranslated English fragment inside a Chinese page is acceptable to axe but is a catalog defect |
| The browser tests find controls by English role, label and text | `test/e2e` | English is what a context with no stored choice and an English browser gets. `playwright.config.ts` pins `locale: 'en-US'` rather than rely on the default seen in §2.2 |
| The Worker validates; the browser shows what comes back | `tasks/TASK-28.md` | D3 changes how an error is worded on screen, never who decides it |
| Errors carry no SQL, bucket names, ids or stack traces | `SECURITY.md` | `params` under D3 are the values already in today's message, nothing more |
| Migrations are additive and forward-compatible | `DATA_MODEL.md` | `ui_locale` is a nullable column; an older Worker ignores it |
| Themes and plugins ship no admin code | `ADMIN.md §7` | D4 and D5 add data files, not code |
| Version 1 plugins run unchanged | `PLUGIN_API.md §13.1` | D5 is optional and additive |
| Infrastructure words only under Advanced | `ADMIN.md §2` | Applies to the translations as much as to the English; U1 and U12 remove existing breaches |
| New dependencies are registered | `TECH_STACK.md §11` | Exact versions, licence, layer and measured size, in a dependency-only commit; released at least two weeks earlier, as the last migration held itself to |
| No release is implied | — | When to publish is the owner's call |

## 5. Design

### 5.1 Catalogs and loading

`src/admin/locales/<tag>.po`, one per interface language, with `en` the
source. A list of supported tags and their own names lives in one module;
adding a language is a new `.po` and one entry. The provider sits above both
the router and the wizard in `main.tsx`, resolves the language before the
first render (D2's order), sets `document.documentElement.lang`, and loads
that language's chunk. Switching loads the other chunk and re-renders in
place: no reload, and nothing typed into a form is lost.

Messages follow three rules. A sentence is one message, markup included,
never fragments joined in code. A count goes through a plural, including in
English ("1 page"). Nothing an operator reads is assembled from a server
value and a client word.

### 5.2 What is not translated

Values that are data: content titles, slugs, paths, language codes, plugin
and theme ids, token scopes, secret names. Words that are names: Mallok,
Markdown, Resend, Turnstile, Cloudflare.

### 5.3 What the admin tells the Worker

`src/admin/api.ts` is the one place requests are made; it sends the
interface language as `Accept-Language`. The Worker uses it for one thing
only: choosing the admin catalog of a theme or plugin to overlay on the
declarations it returns (D4, D5). Error text does not vary by it (D3). No
response under `/_mallok/` is cached, so the header creates no cache
variance.

### 5.4 Formatting

One module wraps `Intl.DateTimeFormat`, `Intl.NumberFormat`,
`Intl.RelativeTimeFormat` and `Intl.DisplayNames`, always called with the
interface language. The four call sites of §2.1 move to it, and
`saved-note.tsx`'s hand-built "1 minute" becomes a plural. Money in a
record keeps its declared currency and takes the interface language's
grouping.

### 5.5 Typography

The system stack stays; no font file is added. `lang="zh-CN"` on the
document is what lets a browser pick a Simplified Chinese face for Han
characters, so it is set before the first paint. U20 is the one size
change. **Windows and Linux were not measured**; phase 2's gate includes a
screenshot on each.

## 6. Phases

Sizes are relative — S under a day, M a few days, L a week or more — and
are estimates.

### Phase 0 — Spike and numbers (S)

Throwaway branch; only §8 of this file merges.

1. Add the D1 choice to this admin's real build, wrap the shell and the
   sign-in page, and record `pnpm admin:size`, with English in the entry
   and with English as a chunk.
2. Confirm the build fails loudly, not silently, when the transform is
   missing or a catalog does not compile.
3. Find how a missing translation fails the gate (the extractor reported
   counts in §2.2; whether a flag turns that into an exit code was not
   checked).
4. Count the messages: extract the whole admin once and record the total.

**Gate:** the measured first load in §8, and D1 confirmed or switched to B.

### Phase 1 — Foundation (S)

The provider, the language list, the formatter module, the interface
language control in the account menu, the sign-in page and the wizard
(D7), `<html lang>`, the choice in `localStorage` (D2, option A).
`playwright.config.ts` pins `en-US`. The shell and the sign-in page are
translated; every other page still reads English.

**Gate:** all browser tests pass unchanged; a new spec switches to 简体中文
from the account menu, sees the sidebar and `<html lang>` change, reloads
and finds the choice kept, and finds no cookie set.

### Phase 2 — Every string in the admin (L)

One page per commit, in the last migration's order (settings, account,
content list, media, plugins and panels, record editor, content editor,
wizard), then the form generator's own messages ("This field is
required."). Each commit wraps the page's strings and adds its `zh-CN`.
The two `window.confirm` sentences move into the catalog. English wording
is not edited here, with one exception: "1 pages" becomes "1 page", and
`01-wizard`'s assertion changes with it and says why.

**Gate:** the extractor reports nothing missing for `zh-CN`; a
pseudo-language run (every message replaced by a marked string) shows no
unmarked sentence on any page or overlay; axe is clean in both languages;
screenshots of every page in Chinese at both widths, on macOS, Windows and
Linux, reviewed by the owner — who is also the reviewer of the Chinese
wording.

### Phase 3 — Strings from outside the bundle (M)

- D2's column and the account endpoint's field; the wizard passes its
  choice when it creates the administrator.
- D3: `code` and `params` on the Worker's errors, in the order given there;
  the admin's catalog gains each code as it lands.
- D4 and D5: the admin catalog files, their build-time validation, the
  overlay in the two endpoints, `zh-CN` for the five official themes and
  the `inquiry` plugin. `THEME_FORMAT.md`, `PLUGIN_API.md` and
  `DATA_MODEL.md` are revised in the same commits as the code.

**Gate:** worker tests for the overlay (present, absent, a missing key) and
for an error's `code`; the Chinese spec opens the editor of a product and a
plugin panel and finds declared labels in Chinese; a deliberately failed
sign-in and a refused save are read in Chinese; the Worker's bundle size is
reported.

### Phase 4 — The review's fixes (M–L), per D8

One finding or one page per commit, proposed order: U1 and U2 (every page
improves at once), U15, U10, U4–U6, U7–U9, U16–U18, U11–U14, U19, U20,
then U3 if D8 is C. A fix that changes English wording changes the catalog
and its translation in the same commit.

**Gate:** per commit, the page's browser tests pass — a selector that has to
change says why in its diff — axe is clean in both languages, and a
before-and-after screenshot goes to the owner.

### Phase 5 — Close (S)

`ADMIN.md` gains a section on the interface language and is corrected where
phase 4 changed a page; `TECH_STACK.md §6` and `§11.1`; `THIRD_PARTY_NOTICES`
regenerated; the CHANGELOG; a short "adding an interface language" note.

## 7. Verification

- **The gate, every phase:** `pnpm lint && pnpm typecheck && pnpm test &&
  pnpm build && pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.
- **Behaviour:** the existing browser tests, in English, unchanged except
  where §6 names a change.
- **The other language:** one ordered spec in 简体中文 covering the switch,
  its persistence, a declared label, a translated error, and the wizard —
  which, because the wizard runs once per database, is driven in Chinese in
  a context of its own inside `01-wizard`'s run, or against a mocked setup
  API as the last migration did for its screenshots. Phase 1 decides which.
- **Accessibility:** `05-accessibility` runs its page list once per
  interface language.
- **Completeness:** the extractor's missing count and the pseudo-language
  run of phase 2.
- **Size:** `pnpm admin:size` in every commit message of phases 1–4.
- **Looks:** screenshots for the owner; no visual-regression tooling is
  added.

## 8. Measurements

Measured 2026-11-13 in this admin's real build (Vite 8.2.2, Rolldown), with
Lingui 6.11.0 — 6.12.0, which §2.2 measured, was ten days old, and §4 holds
new dependencies to two weeks. The shell, the account menu and the sign-in
page were wrapped: 25 messages.

| Build | First load (gzip) | Change |
| --- | ---: | ---: |
| Before, `main` at `a4b10e0` | 161.7 KiB | — |
| Lingui, catalogs as chunks, `await` at the top of `main.tsx` | 173.1 KiB | **+11.4, over budget** |
| Lingui, catalogs as chunks, start-up as a promise | **165.4 KiB** | **+3.7** |
| The same with English compiled into the entry | 165.7 KiB | +4.0 |

- **A top-level `await` in the entry costs 7.7 KiB.** Rolldown split the
  entry into 22 small preloaded chunks instead of 6, and each pays its own
  gzip framing. `main.tsx` starts the language with a promise and renders
  in its `then`; the comment there says why.
- **English stays a chunk.** Compiled into the entry it cost 0.3 KiB for 25
  messages and grows with every one; as a chunk it is one small request
  that starts before React renders.
- **The scaffold's +4.2 KiB was close**: the real figure is 3.7 KiB, leaving
  4.6 KiB of the 170.
- **A missing transform fails the build, loudly — but only because of a
  guard.** Without the transform the `.po` imports fail to parse, which is
  loud. With the transform switched off and the catalogs still compiling
  (`macroTransform: false`), the build passed: `@lingui/react/macro`'s
  browser build is empty functions, so `<Trans>` renders nothing. A
  `resolveId` guard in `vite.config.ts` now fails the build naming each
  module that still imports a macro; tried with the option switched off.
- **A broken catalog fails the build** with a parse error naming the file.
- **A missing translation fails `pnpm lint`.** `lingui check missing` passes
  by default even with a missing translation, because English fills it in;
  `--mode catalog` is the one that fails (exit 1, "Found 1 missing
  translation(s) before applying fallbackLocales"). `lingui check sync`
  fails (exit 1) when a sentence in the source has changed and the catalogs
  were not re-extracted. Both run in `pnpm lint` as `pnpm i18n:check`.
- **Extraction is reproducible**: catalogs carry origins without line
  numbers, and a second `lingui extract` a minute later wrote identical
  bytes. The admin build stayed reproducible across checkout paths
  (`test/cli/admin-build-reproducibility.test.ts`, which now copies
  `lingui.config.ts` too).
- **Not counted: the whole admin's messages.** The extractor counts only
  wrapped messages, so step 4's total is known only once phase 2 has wrapped
  them; it will be recorded there.
- **The rest of the gate:** `pnpm lint`, `typecheck`, `test` (1460 tests),
  `build`, `bundle:size` (Worker 310.3 KiB gzip) and `admin:size` passed;
  `pnpm test:e2e` passed, 47 specs, including the new
  `20-interface-language.spec.ts`. One `pnpm test` run in three had one
  failing test that two reruns did not repeat; it was not identified.

Phase 1 as built:

- `src/admin/i18n.ts`: the two languages and their own names, the choice in
  `localStorage` (`mallok-admin-language`), else the browser's languages
  matched exactly and then by primary subtag (`zh`, `zh-Hans-CN` → `zh-CN`),
  else English; `<html lang>` follows. `zh-TW` also matches `zh-CN` by that
  rule — better than English for a reader of Traditional Chinese, and a
  Traditional catalog would take it over.
- The account menu gains "Interface language" under "Colour scheme"; each
  radio group is now named by its label, which `16-appearance` relied on
  not needing — its selector changed and says why.
- `playwright.config.ts` pins `locale: 'en-US'`.
- Finished at the start of phase 2: a language control (a native
  `<select>`, `components/language-picker.tsx`) on the sign-in page and in
  the wizard's header, and `src/admin/format.ts` (§5.4). The three call
  sites that formatted with the browser's locale use it; `saved-note.tsx`'s
  hand-built "1 minute" / "N minutes" is `Intl`'s unit format. The fourth
  site in §2.1, `decimalsOf` in `record-editor.tsx`, keeps `'en'`: it reads
  how many decimals a currency has, which no locale changes. First load
  165.5 KiB.

Phase 2 as built (commits `bb278c7` to the commit adding this note):

- Every page and overlay in the order above, then the form generator,
  `api.ts`'s network failure, the slug notices and the admin's 404 page:
  364 messages, all with `zh-CN`. The owner reviewed Chinese screenshots
  every two or three pages and confirmed the wording each time; the agreed
  terms are 邮箱, 标语, 部署 / 重新构建, 缓存清除令牌, 边缘缓存, 片段, 询盘,
  密钥 (for both a Worker secret and an API key), API 令牌, 权限范围, 撤销,
  替代文本, 定时发布.
- English changed where it was wrong, and only there: "1 pages · 1 sample
  records" in the wizard (and `01-wizard`'s assertion), "used by 1 items",
  "1 image(s) missing" and similar became real plurals.
- `REQUIRED_MESSAGE` became `requiredMessage()`: a constant was read once,
  at module load, before any language was active. The sign-in and account
  schemas pass it to zod 4 as `{ error: requiredMessage }`, read when a
  value is checked.
- Found in the Chinese screenshots and fixed: `Intl.ListFormat` with
  `type: 'unit'` joins Chinese items with no separator ("4809601,440"), so
  the media page uses a conjunction list; a status badge broke "已发布" one
  character per line in a narrow cell, so it is `break-keep`.
- Left for phase 3, because each embeds or is text from outside the
  bundle: what themes and plugins declare (D4, D5), the Worker's messages
  (D3), and `export.ts`'s failures, whose sentences embed fragments from
  `src/core`.
- `pnpm i18n:extract` passes `--clean`, so a message removed from the
  source leaves the catalogs.
- Gate, so far: the extractor reports nothing missing; `pnpm lint`,
  `typecheck`, `test` (1462), `build`, `bundle:size` (Worker 310.3 KiB) and
  `admin:size` (first load 165.5 KiB) pass; `pnpm test:e2e` passes, 48
  specs. One `pnpm test` run failed `wrangler-contract.test.ts` on its 5 s
  timeout under load; alone it passed, and the full suite passed after.
  Screenshots were taken on macOS only.
- **Pseudo-language pass**, run twice on a fresh database: `zh-CN.po` was
  swapped, for the run only, for a catalog whose every message is wrapped
  in ⟦ ⟧, and a throwaway spec walked the wizard, sign-in (empty and wrong
  password), the content list, the account menu, the editor (stored, new,
  a slug notice), media (empty, an upload, alt text, a refused SVG), the
  plugins page (an action with nothing selected, a record refused and
  stored, an action's parameters), the four settings pages (a refused
  sender), the account page (a refused password, a minted token), the 404
  page and the mobile sidebar, collecting visible text and `aria-label`,
  `placeholder`, `title` and `alt` outside the marks. The first run found
  seven messages in the vendored shadcn/ui components and Sonner — the
  sidebar's "Toggle Sidebar", its mobile sheet's title and description, the
  sheet's and dialog's "Close", the breadcrumb's label and "More", and the
  toasts' region label — now in the catalog (371 messages). The second run
  found nothing unmarked but what §5.2 and phase 3 expect: each language's
  own name, example placeholders (`zh, de`, `Acme <hello@example.com>`),
  scope and migration names, content, the Worker's messages (D3: a refused
  sign-in, "Some fields need attention.", the server's required-field
  message on a record, Advanced's storage note), the starters' names, and
  what themes and plugins declare (D4, D5).
- **Axe in Chinese**: `05-accessibility` scans the sign-in screen with a
  browser that prefers Chinese, and every admin screen and the editor with
  Chinese chosen; no serious or critical violation.
- **Not run: screenshots on Windows and Linux.** This machine has neither,
  nor Docker. They remain for the owner or CI.
- Found on the way, not an interface-language matter: once setup is done,
  `/_mallok/setup` answers the Worker's JSON 404 (`{"error":"Not found."}`),
  so the admin's "Setup is finished" card is never shown.

Phase 3 as built, in the order it landed:

- **D2, the account's language.** Migration `0010_admin_ui_locale` adds a
  nullable `admin_user.ui_locale`. `GET /_mallok/api/auth/me` and the
  sign-in response return it as `uiLocale`; `PATCH /_mallok/api/auth/me`
  with `{ "uiLocale": "zh-CN" | null }` changes it, for a browser session
  only (a token has no account; 403). The Worker checks the value's shape,
  not whether a catalog exists. The wizard sends the language it is used in
  when it creates the administrator. In the admin, the session query and
  the sign-in adopt the account's language before the shell renders and
  copy it to `localStorage`; choosing in the account menu writes both, and
  says so if the account could not be told. A language chosen on the
  sign-in page applies until sign-in, where the account's wins — D2 as
  decided. `05-accessibility`'s Chinese pass now chooses Chinese in the
  account menu: writing `localStorage` alone stopped working once the
  account's `en` won on every load, and the scan then checked English
  without failing; each scanned screen now asserts its `lang`.

- **D4, themes' admin catalogs.** `src/core/admin-catalog.ts` lists the
  keys a manifest allows, checks a catalog, picks one for a list of
  languages and lays it over a manifest; `readThemePackage` accepts
  `admin/<ui-locale>.json` and fails the build on a bad one. `api.ts` sends
  the interface language as `Accept-Language`; `GET /_mallok/api/theme`
  overlays the best match. **One change to D4 as written:** it said the
  admin's code would not change, but `src/core/view.ts` titles a list page
  and its links with a kind's label when the language pack has none, so a
  preview rendered from a translated manifest could differ from the site.
  The endpoint therefore also returns the words as written, under
  `declared`, and `preview.ts` renders from those — the one admin change.
  Choosing a language refetches the theme (and the plugins, for D5); sign-in
  adopts the account's language before it loads the workspace. The five
  official themes have `admin/zh-CN.json` (89 keys; theme names kept as
  proper names). `THEME_FORMAT.md §10.1` documents the file.

- **D5, plugins' admin catalogs.** `src/core/plugin-catalog.ts` lists the
  keys a plugin manifest allows and lays a catalog over one. A plugin passes
  its catalogs to `definePlugin` as `adminCatalogs` (`{ "zh-CN": … }`),
  which refuses a bad one when the plugin is defined. `GET
  /_mallok/api/plugins` overlays the best match per plugin, and each panel
  also carries `names` (a filter's, a detail row's or a search field's
  name) and `values` (a badge value's words), which the panel view and
  related rows use; neither changes anything shown in English. Two changes
  to D5 as written: an action's key is `panels.<panel>.actions.<action>`,
  because action ids are unique only within a panel, and a badge value's is
  `panels.<panel>.values.<field>.<value>` for the same reason. No
  `declared` copy is kept, as for themes: a plugin's panels never reach a
  visitor. `PLUGIN_API.md §7.8` documents it. The test fixture plugin
  carries a partial catalog, which `20-interface-language` reads.
  In a commit of its own, the official `inquiry` plugin gains
  `admin/zh-CN.json` (36 keys, its status values included) through
  `adminCatalogs` in `index.ts`; its `plugin.json` is unchanged, as D5 asks.

- **D3, the Worker's errors: the mechanism, and sign-in, setup and the
  account.** `problem(status, message, code?, params?)` adds `code` and
  `params` beside the unchanged English `error`. Codes are dotted
  (`auth.invalid_credentials`, `setup.key_wrong`); a code is never reused
  for a different sentence. The admin's sentences live in
  `src/admin/server-messages.catalog.ts` with the id `server.<code>` and
  the Worker's English as their message; `api.ts` builds an `ApiError`'s
  message from the loaded catalog when it has the code, and from `error`
  otherwise, so no caller changed. Measured on the way: a lookup table
  bundled into `api.ts` cost 0.6 KiB of first load for 25 codes, which
  would not survive the rest; keyed by id, the sentences live only in the
  lazily loaded catalogs and first load is 166.0 KiB however many codes
  there are. A test fails on a code the Worker never sends. First batch:
  the router's own refusals, sign-in, the account, tokens and every setup
  step (25 codes).

## 9. Risks and open questions

| Risk | Why it is real | What contains it |
| --- | --- | --- |
| The first load passes 170 KiB | 8.3 KiB of headroom; the scaffold says 4.2, and a scaffold undercounts shared code as often as it overcounts | Phase 0 measures in the real build before anything merges |
| A build-time transform fails silently | It happened to this admin once, with signals | Phase 0, step 2; a build check that the entry contains no untransformed macro |
| Half-translated screens | 8,700 lines are wrapped by hand over many commits | English is always the fallback; the pseudo-language gate; one page per commit |
| Tests rewritten to fit | A wrapped string can change by a space or a quote | Phase 2 edits no English, and the unchanged suite is the judge |
| Translations rot | A new English sentence has no Chinese until someone writes it | The extractor's missing count is in the gate |
| The Chinese is correct and reads badly | Interface Chinese has conventions a literal translation misses | The owner reviews phase 2's screenshots; a short glossary (发布, 草稿, 询盘, 内容语言, 界面语言) is agreed before phase 2 starts |
| Theme and plugin authors do not ship catalogs | The file is optional | The declared English shows; nothing breaks |

Conflicts between documents and code, found on the way and **not resolved
by this plan**:

1. `ADMIN.md §4` lists search on the content list and a Navigation editor
   under Settings; the admin has neither, and Advanced tells the operator
   navigation is among the things that change instantly.
2. `ADMIN.md §6.1` draws collapsible editor columns and a status bar;
   neither exists (U7, U8 propose them).
3. `ADMIN.md §5` requires the standing no-token notice and `§2` keeps
   infrastructure words to Advanced; today's notice satisfies the first by
   breaking the second (U1 proposes a reading that satisfies both).
4. `ADMIN.md §10` says the deploy explanation is "at the top" of the
   Plugins page; U11 keeps it there in one sentence. Moving it lower would
   need that section changed first.
5. `CONVENTIONS.md` still gives the first-load budget as 150 KB.

Open questions:

1. D4's `select` choices: is a value/label form of `choices` wanted, and in
   which contract version?
2. Should Traditional Chinese (`zh-TW`) be planned for? It is a catalog,
   but the fallback chain (`zh-TW` → `zh-CN` or → `en`) is a decision.
3. D6: should the operator's notification email follow `ui_locale` once it
   exists?
4. Does the CLI get translated messages? This plan assumes not.
5. Is the Chinese documentation's glossary (`docs/zh-CN/`) the source for
   interface terms, or does the interface set them?

## 10. Not in this plan

- Translating content, starter content or the public themes' packs.
- Right-to-left interface languages.
- A translation management service; catalogs are files in the repository.
- Search, a navigation editor, revision history, or any other feature
  `ADMIN.md` describes and the admin lacks.
- Visual-regression tooling.
