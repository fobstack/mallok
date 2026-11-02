# Admin migration to shadcn/ui

- Status: **accepted 2026-10-08; phases 0–2 done, phase 3 not started.** The
  owner chose the full version and took every recommendation in §3: D1
  option B, D3 the shadcn baseline with one brand accent, D4 the sidebar, D5
  and D6 as written. D2 was decided by phase 0's measurement: **Radix**.
  Phase 0 also found that the full version does not fit the first-load
  budget as it stands (§8, D7).
- Date: 2026-10-08
- Asked for by the owner on 2026-10-07: the admin "looks hard to look at",
  and should become a shadcn/ui interface of the kind a SaaS back office has.

## 1. Goal

The admin at `/_mallok/app/` looks and behaves like a current SaaS back
office, built from shadcn/ui components on Tailwind, without changing what
the admin does, what the Worker's API is, or what a plugin or theme author
declares.

Out of scope: any new admin feature, any change to the management API, the
declarative panel contract (`PLUGIN_API.md §7.5`), the public site, the CLI.

## 2. Where the admin is today

Measured in the repository on 2026-10-08, at `5d6caff`.

| Fact | Value |
| --- | --- |
| Framework | React 19.2, built by Vite 8 into Static Assets |
| Tailwind | **Already installed and imported**: `tailwindcss` 4.3.3 with `@tailwindcss/vite`, `@import "tailwindcss"` at the top of `src/admin/styles.css` |
| shadcn/ui | **Configured, never used.** `src/admin/components.json` exists (`new-york`, `neutral`, CSS variables, the `@/` alias); there is no `components/ui/`, no `lib/utils`, and not one shadcn component |
| Styling in practice | 384 `className` uses across the admin, **none of them a Tailwind utility**: every one names one of 81 hand-written classes in a 1,142-line `styles.css` |
| Native elements | 69 `<button>`, 34 `<input>`, 7 `<select>`, 2 `<textarea>`, 6 `<dialog>`, 3 `<table>` |
| State | `@preact/signals-react` (143 `.value` reads) for five globals, plus 121 `useState` |
| Data | 46 direct `api()` calls, loaded in `useEffect` (19) or event handlers; no cache, no shared loading or error handling |
| Routing | A 35-line history router on a signal; a dozen routes, no nesting |
| Forms | An in-repository schema-driven generator (`form/`, 739 lines) fed by theme and plugin field declarations; validation is the Worker's |
| Layout | A top bar with four sections; no sidebar |
| Dark mode | `prefers-color-scheme` only, no toggle |
| First load | 72.8 KiB gzip against a 150 KiB budget (`pnpm admin:size`); 384 KiB more on demand, almost all of it the editor |
| Source size | 34 files, about 7,100 lines of TypeScript and TSX |
| Browser tests | 16 spec files, 39 tests. Selectors: 112 by role, 39 by label, 9 by text, **103 by CSS**, 86 of which name a hand-written class, an id or a table row |

Two documents contradict the code and each other. `ADMIN.md §3` and
`TECH_STACK.md §6` both say "no Tailwind, no CSS-in-JS, no component
library"; the comment at the top of `styles.css` says Tailwind is the
group's standard base and that the variables are the ones shadcn/ui reads.
The stack decision the project works under — React, React Router in data
mode, TanStack Query, React Hook Form with Zod, shadcn/ui, Tailwind — is
the later one. This migration is what makes the code and the documents
agree.

### What shadcn/ui currently is

Read from `ui.shadcn.com` on 2026-10-08. These move; re-read before
starting.

- Every component is written for Tailwind 4 and React 19. Colours are OKLCH,
  theme variables are declared with `@theme inline`, animations come from
  `tw-animate-css`, and components no longer use `forwardRef`.
- **Base UI has been the default primitive library since July 2026.** Radix
  is "not being deprecated", is selected with `shadcn init -b radix`, and
  existing Radix projects need no action. This repository's
  `components.json` predates the change and resolves components against
  `radix-ui`.
- Forms are documented as React Hook Form with `<Field>` and `<Controller>`
  and a Zod resolver. The documented example uses Zod 3; this repository is
  on Zod 4.4.3.
- `cn` moved to a standalone package in September 2026.
- `sonner`, the toast component, declares `next-themes` as a dependency.
- `style`, `baseColor` and `cssVariables` in `components.json` "cannot be
  changed after initialization" without reinstalling components.

## 3. Decisions the owner has to make

Each is recorded in this file when made. Phase 0 can start without D2,
which it exists to inform.

### D1 — How far the migration goes

| | A. Interface only | B. Interface and the stack under it |
| --- | --- | --- |
| What changes | Components, layout and styles. The router, the signals, the `useEffect` data loading and the form generator's internals stay | A, then React Router data mode, TanStack Query, React Hook Form inside the form generator, and signals removed |
| Result | Looks right. Still two ways of doing things from the stack decision's point of view, and the fragile signals build transform stays (`vite.config.ts` guards against it silently producing an admin stuck on "Loading…") | The admin is on the same stack Nundar's and Fobly's are to be on |
| Size of the work | Phases 0–3 and 6 | All phases |
| Risk | Lower: no behaviour moves | Higher: every page's data loading is rewritten, which is where "it worked before" regressions come from |

**Recommended: B, in the order below, with the interface finished and
mergeable before the stack work starts.** A is a complete, shippable state
of its own — if phase 5 is never done, nothing is left half-built.

### D2 — Base UI or Radix

Base UI is what shadcn/ui now leads with and where new components land
first; Radix is what the existing configuration points at and has the
longer production record. Their cost in this admin's first load is not
known and **must not be assumed**: phase 0 builds the same shell on both and
measures it. Recommended: decide on that measurement; if the two are within
a few KiB of each other, take Base UI, because the default is where
upstream's attention goes.

**Decided 2026-10-08 by measurement: Radix.** The same shell costs 63 KiB
on Radix and 86 KiB on Base UI (§8) — 22 KiB apart, not "a few", and on Base
UI the shell alone would leave nothing of the budget.

### D3 — How it should look

The current design language is deliberate (`styles.css`, header comment):
flat surfaces, hairline rules, monospace for anything structural, one blue
and one rust accent — a spec sheet, not consumer software. The owner's
verdict is that it is hard to look at.

| | Keep the identity | Adopt the shadcn baseline |
| --- | --- | --- |
| How | Map the existing variables onto shadcn's tokens: 3px radius, no shadows, mono table headers | shadcn's `neutral` tokens as they come: its radius, spacing, shadows and type scale. One brand colour as `--primary` |
| Looks like | The same admin, tidier | The SaaS back offices people already know |
| Cost | Every component fought back into the old shape; upstream updates need re-fitting | Close to none; `shadcn add` output is used as generated |

**Recommended: the shadcn baseline with one brand accent.** It is what was
asked for, and it is what keeps the components upgradable.

### D4 — Navigation

**Recommended: a collapsible left sidebar** (shadcn's `sidebar`), with
Content, Media, Plugins and Settings as groups, each plugin's panels listed
under Plugins, and the account menu at the foot. The top bar keeps the site
name, the language switch and the "saved / live in N seconds" note. On a
narrow screen the sidebar becomes a sheet.

### D5 — Where the components live

In this repository, under `src/admin/components/ui/`. Not a shared package:
the project's rule is to extract one only when two consumers exist, and
Nundar has no admin of its own — its panels are declared and Mallok's admin
draws them, so Nundar gets the new interface with no work.

### D6 — How it lands

One branch, `feature/admin-shadcn`, one commit per phase or page, merged
when a phase's gate passes. **No release is implied by any phase**; when to
publish is the owner's call, and the natural points are after phase 3
(interface complete) and after phase 5.

## 4. Constraints that do not move

| Constraint | Source | What it means here |
| --- | --- | --- |
| First load ≤ 150 KiB gzip | `ADMIN.md §13`, `pnpm admin:size` | 77 KiB of headroom today. Every phase reports the number. Components used on one page are imported by that page, not by the shell |
| No serious or critical axe violation, on every screen, light and dark | `test/e2e/05-accessibility.spec.ts` | Runs after every phase; a portal-rendered dialog or menu is checked open |
| Fully keyboard operable, every control labelled | `ADMIN.md §13` | Native `<dialog>` and `<select>` give this for free today; their replacements have to be shown to |
| The admin never enters the Worker script | `ADMIN.md §2` | Unchanged: it is still a Vite build into Static Assets |
| The editor and the render pipeline load on demand | `ADMIN.md §13` | Unchanged; CodeMirror stays, restyled through its own theme |
| The preview is a sandboxed `srcdoc` iframe | `src/admin/pages/editor.tsx` | Tailwind's reset cannot reach it; nothing to do, and a test should say so |
| A page on the first-load path does not import the `src/core` barrel | `ADMIN.md §13` | Unchanged; the same trap exists for an icon set imported whole |
| The Worker validates; the browser shows what comes back | `tasks/TASK-28.md` | React Hook Form holds values and errors; it does not become a second validator for theme and plugin fields |
| Third-party code is listed in `THIRD_PARTY_NOTICES` | `scripts/third-party-notices.mjs` | New runtime dependencies appear there; the build already derives it from the admin's dependency graph |
| English is the admin's language | — | No copy changes in this migration; wording is reviewed separately |

## 5. Phases

Sizes are relative — S under a day of focused work, M a few days, L a week
or more — and are estimates, not measurements.

### Phase 0 — Spike and numbers (S)

Throwaway branch; nothing merges but this file's §8.

1. Re-read the shadcn/ui docs listed in §2.
2. Build the same minimal shell twice, on Base UI and on Radix: sidebar,
   button, input, select, dialog, dropdown menu, toast. Record first-load
   gzip for each, and what each adds on a page that opens a dialog.
3. Check `@hookform/resolvers` against Zod 4.4.3 with one real form.
4. Decide dark mode: shadcn styles `.dark`; the admin follows the system.
   Either redefine Tailwind's `dark` variant to the media query, or add a
   three-way toggle (system, light, dark). Recommended: the toggle,
   defaulting to system.
5. Decide whether `sonner` is used as shadcn ships it (with `next-themes`)
   or wrapped without it.

**Gate:** a table of measured sizes in §8, and D2 decided.

### Phase 1 — Foundation (S)

- Re-initialise `components.json` for the chosen primitives; add `cn`.
- Replace the token block in `styles.css` with shadcn's (`@theme inline`,
  OKLCH), per D3. The 81 legacy classes stay, pointed at the new variables,
  so every page still renders while it waits its turn.
- Dark mode per phase 0.
- **Move the browser tests off CSS classes first.** 86 selectors name a
  class, an id or a row. Rewrite them to roles, labels and text against the
  *current* admin, where they can be shown to still pass. This is what lets
  every later phase be judged by an unchanged test suite.
- `ADMIN.md §3` and `TECH_STACK.md §6` corrected.

**Gate:** all 39 browser tests pass on the old interface with no class or
id selector outside `test/e2e/05-accessibility.spec.ts`.

### Phase 2 — The shell (M)

`components/shell.tsx`, `app.tsx`, `pages/login.tsx`.

- Sidebar and top bar per D4; breadcrumbs; the account menu.
- The global `notice` banner becomes toasts for transient messages and an
  inline alert for standing ones (no purge token, a redeploy needed).
- The "Loading…" text becomes skeletons; the unknown route gets a page.
- Sign-in on shadcn's card and field components.

**Gate:** every route reachable by keyboard from the sidebar; axe clean
with the sidebar open, collapsed and as a sheet.

### Phase 3 — Pages (L)

One page per commit, in this order — simplest first, so the component set
is settled before the hard pages:

| Order | Page | Files | Lines | Main components |
| --- | --- | --- | --- | --- |
| 1 | Settings: Site, Email, Appearance, Advanced | 4 | 1,092 | field, input, textarea, select, switch, card, alert, button |
| 2 | Account and API tokens | 1 | 267 | table, dialog, badge |
| 3 | Content list | 1 | 220 | table, filters, pagination, dropdown menu |
| 4 | Media library | 2 | 311 | grid, dialog, progress |
| 5 | Plugins, declarative panels, related rows | 3 | 930 | table, tabs, badge, sheet |
| 6 | Record editor and action parameters | 1 | 608 | sheet in place of `<dialog>`, field, repeatable rows |
| 7 | Content editor | 2 | 749 | toolbar, resizable panes, select; CodeMirror themed to the tokens |
| 8 | Setup wizard | 1 | 466 | stepper, card, radio group, alert |

The form generator's *controls* (`form/controls.tsx`, 450 lines) are
restyled in step 1 and reused by steps 5–7; its engine is phase 4.

Per page: the page's own browser tests pass unchanged, axe is clean, the
first-load number is reported, and a screenshot in light and dark goes in
the commit's task record.

**Gate:** no page uses a legacy class; `styles.css` holds tokens and
nothing else. **This is a complete state** — D1's option A ends here.

### Phase 4 — Forms on React Hook Form (M)

`form/` (739 lines) and the record editor.

- The generator keeps its input — the field declarations of `theme.json`
  and of a plugin's panel — and builds on React Hook Form and shadcn's
  `<Field>`.
- Server errors (`ApiError.fields`) are set on the fields they name.
- Static forms with a fixed shape (sign-in, site settings, email, tokens)
  get a Zod schema. Declared forms do not: their rules live in the Worker.
- Unsaved-changes interception moves to the form's dirty state.

**Gate:** `test/admin/form.test.ts` and the records and editor browser
tests pass; Zod's cost in the first load is reported, and if it does not
fit, static forms validate on submit through the Worker like declared ones.

### Phase 5 — Routing and data (L) — D1 option B only

- React Router in data mode replaces `router.ts` and `routes.ts`: nested
  routes under the shell, auth and setup redirects as loaders, an error
  boundary per route, lazy routes in place of `components/lazy.tsx`.
- TanStack Query replaces the 46 direct calls: one query key scheme,
  invalidation after writes, shared loading and error states.
- The five signals become queries (`session`, `settings`, `theme`,
  `health`) and one piece of router state (`activeLocale`).
  `@preact/signals-react`, its Babel transform and the guard around it in
  `vite.config.ts` are deleted.

**Gate:** no import of `@preact/signals-react`; no `useEffect` that fetches;
every browser test passes; first load reported.

### Phase 6 — Close (S)

`ADMIN.md` rewritten where it describes the interface (§3, §4, §13);
`TECH_STACK.md §6`; a task record per phase; unused dependencies removed;
`THIRD_PARTY_NOTICES` regenerated; the budget in `ADMIN.md §13` restated
with the measured figure.

## 6. Verification

- **The gate, every phase:** `pnpm lint && pnpm typecheck && pnpm test &&
  pnpm build && pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.
- **Behaviour:** the 39 browser tests, with selectors fixed once in phase 1
  and not edited again except where a flow itself changes (the record
  editor becoming a sheet). A test that has to change says why in its diff.
- **Accessibility:** the axe spec on every screen in light and dark, plus
  each overlay open.
- **Size:** `pnpm admin:size` in every commit message of phases 2–5.
- **Looks:** screenshots per page, light and dark, at a desktop and a phone
  width. There is no visual-regression tooling in the repository and this
  plan does not add any; screenshots are for the owner's review.
- **A real site:** the gate site, deployed by the maintainer, at the end of
  phase 3 and of phase 5 — sign in, edit and publish, upload an image, open
  a plugin panel.

Unit tests for migrated components are not added where a browser test
already drives the behaviour through the real admin.

## 7. Risks

| Risk | Why it is real | What contains it |
| --- | --- | --- |
| The first load outgrows 150 KiB | Primitives, an icon set, React Hook Form, React Router and TanStack Query all arrive. None has been measured in this build | Phase 0 measures before anything is committed to; per-page imports; the number in every commit. If phase 5 does not fit, it does not merge — phase 3 already stands on its own |
| Keyboard and screen-reader regressions | Six native `<dialog>`s and seven native `<select>`s are replaced by portal-rendered components | axe on every overlay; the keyboard path of each dialog exercised by a browser test before it is replaced |
| The browser tests are rewritten *to fit* the new interface | 86 selectors must change, and a test edited alongside the code it checks proves less | Phase 1 changes selectors against the old interface only |
| Phase 5 changes behaviour without anyone noticing | Data loading is rewritten on every page | It is last, optional, and judged by tests that predate it |
| shadcn/ui moves under the work | The default primitives changed in July and `cn` moved in September | Components are copied into the repository, so nothing changes until someone runs `shadcn add` again; the docs are re-read at phase 0 |
| A long-lived branch drifts from `main` | Fixes will keep landing on `main` | Phases are small and merge as they pass; the legacy classes keep unmigrated pages working throughout |
| The result is "shadcn default" and looks like everyone else's | It will | Accepted under D3; a brand pass over tokens is a separate, small task afterwards |

## 8. Measurements

### Phase 0, 2026-10-08

**Method.** Two throwaway Vite projects made by `shadcn init -t vite -p nova`,
one with `-b radix` and one with `-b base` (shadcn 4.21.4, React 19.3,
`radix-ui` 1.7.0, `@base-ui/react` 1.8.0, `lucide-react` 1.52, `sonner`
2.0.8). One `App.tsx` was written once and built in both: a collapsible
sidebar with four icon items, a dropdown menu, a field with an input, a
select, a button, a dialog and a toast. Variants of that file remove parts.
The number is gzip of the scripts and styles `index.html` references, as
`pnpm admin:size` counts it. **These are a scaffold's numbers, not this
admin's**: they are good for what a part adds, not for a total.

| Build | Radix | Base UI |
| --- | ---: | ---: |
| React only, no component | 67.2 KiB | 67.2 KiB |
| + button, input, field, label | +13.9 | +16.9 |
| + sidebar (brings sheet, tooltip, separator, skeleton and four icons) | +41.3 | +54.9 |
| + select, dialog, dropdown menu | +53.9 | +76.2 |
| + toast (`sonner`, with `next-themes`) — the whole shell | **+63.4** | **+85.8** |

Rows are cumulative: each is the total added over "React only". Styles are
11.1 KiB against this admin's 5.4 KiB today, in every row.

Measured the same way on the Radix project, each alone over "React only":

| Library | Adds |
| --- | ---: |
| React Hook Form 7.89 (`useForm`, `Controller`) | +11.7 KiB |
| the same with `@hookform/resolvers` 5.9.1 and Zod 4.4.3 | +27.8 KiB |
| React Router 8.4 in data mode (loaders, a redirect, a lazy route) | +28.8 KiB |
| TanStack Query 5.104 (a query, a mutation, an invalidation) | +9.6 KiB |

Also established:

- **`@hookform/resolvers` 5.9.1 works with Zod 4.4.3**: it type-checks, and
  run in Node it returned the schema's messages for bad values and the
  parsed values for good ones.
- **Dark mode.** shadcn's styles use `@custom-variant dark (&:is(.dark *))`.
  The scaffold's own `theme-provider.tsx` offers system, light and dark, and
  stores the choice. That provider, not `next-themes`, is what this admin
  takes: system by default, a toggle in the account menu.
- **`sonner` imports `next-themes`** for one `useTheme()` call. The wrapper
  is edited to read the admin's own provider and `next-themes` is not
  installed.
- **The scaffold imports the Geist variable font.** This admin keeps its
  system font stack: a font file is a first-paint cost the budget does not
  even count.

### What the numbers say about the plan

Added to this admin's 72.8 KiB, as an estimate — parts share code, so the
real totals should come out somewhat lower, and are measured for real at
each phase:

| After | Estimate | Against 150 KiB |
| --- | ---: | --- |
| Phase 3, overlays loaded with the pages that use them | ≈ 129 KiB | fits |
| Phase 3, every overlay in the first load | ≈ 142 KiB | fits, with nothing to spare |
| Phase 4, React Hook Form in the first load, Zod not | ≈ 141–154 KiB | fits only if overlays stay out of the first load |
| Phase 4 with Zod in the first load | ≈ 157 KiB and up | **does not fit** |
| Phase 5, React Router and TanStack Query added | ≈ 175–190 KiB | **does not fit** |

So:

1. **Phases 1–3 fit**, provided dialogs, selects and menus are imported by
   the pages that open them and not by the shell.
2. **Zod stays out of the first load.** That was already this admin's rule
   (`tasks/TASK-28.md`); phase 4 keeps it — a static form's schema loads
   with its page.
3. **Phase 5 cannot be done inside 150 KiB.** React Router alone is 29 KiB.
   See D7.

### Phase 1, 2026-10-31

On the branch `feature/admin-shadcn`, in a worktree beside the main
checkout, because another line of work (`feature/itick-m1-m4`) was checked
out there with uncommitted files.

- **Selectors.** Every browser test that named a hand-written class, an id
  or a component's structure now finds it by role, label or text, and all
  39 passed on the old interface first. To be findable, the old interface
  gained what it lacked: a field's error is its input's description
  (`aria-invalid`, `aria-describedby`), a plugin's switch is a named
  `switch`, plugin cards, panels, the editor's panes and the failed-jobs
  list are labelled regions, and a stored secret is a named group. A test
  that removes the error wiring fails. What still uses CSS selectors:
  CodeMirror's own `.cm-*` classes (CodeMirror stays), the public site's
  pages in `04-public-pages`, and the accessibility spec.
- **Tokens.** `styles.css` starts with shadcn/ui's `radix-nova` neutral set
  as `shadcn init` generates it, `--primary` set to the brand blue
  (`#1f4e79`, `#6fa8d8` in dark), and the old variable names mapped onto the
  tokens so every page still renders. One deviation: **shadcn's light
  `--muted-foreground` (`oklch(0.556 0 0)`) is 4.35:1 on its own `--muted`
  surface and failed the accessibility gate**; it is `oklch(0.53 0 0)` here,
  4.82:1. The old `--muted` meant grey text and shadcn's means a grey
  surface; the 17 old uses were renamed.
- **Dark mode** is the `.dark` class, set before the first render by
  `theme-mode.ts`: system by default, or light or dark chosen in Account and
  kept in this browser. Covered by `16-appearance.spec.ts`. The choice moves
  to the account menu in phase 2.
- `components.json` is `radix-nova`. Biome parses Tailwind's directives
  (`css.parser.tailwindDirectives`). `tw-animate-css` and `shadcn` (for its
  stylesheet) are new development dependencies.
- **Found on the way:** packages the admin stylesheet inlines with
  `@import` were never in `THIRD_PARTY_NOTICES` — Vite's licence list only
  sees modules — including Tailwind itself, imported long before this work.
  They are now read from the stylesheet (`stylesheetPackages`); the notices
  went from 118 packages to 121.
- **First load: 74.5 KiB** (72.8 before): 67.9 KiB script, 6.6 KiB styles.

### Phase 2, 2026-10-31

- **The shell.** A collapsible sidebar (Content, Media, Plugins; Site,
  Appearance, Email, Advanced), a breadcrumb bar, and an account menu at the
  sidebar's foot with the account page, the colour scheme and sign-out. On
  a phone the sidebar is a sheet. The settings tabs are gone; the sidebar
  holds them. Errors pages report through `notice` are toasts; the
  no-purge-token warning is an alert above every page, marked `role="note"`
  rather than shadcn's default `alert`, since it is standing and must not
  interrupt a screen reader. Loading shows the shell's outline; an unknown
  route has a page. Sign-in is a shadcn card.
- **Changes to what shadcn generates**, each commented where it is made:
  the sidebar kept its open state in a `sidebar_state` cookie on path `/`,
  which would make the operator's every visit to their own public site skip
  the shared cache (`ARCHITECTURE.md §6.4`) — it uses `localStorage` now; the
  toast reads the admin's own colour scheme instead of `next-themes`. Biome
  relaxes three rules for `components/ui/**` only, so the generated files
  stay as generated.
- **Size.** The shell as first written was 147.8 KiB by the old count. Three
  things were moved out of the first load: every page now loads with its
  route, the toasts load with the first one, and the account menu with its
  first click. **First load: 124.1 KiB**, with the content list adding about
  1.3 KiB more.
- **The budget was being under-counted, and is no longer.** `pnpm
  admin:size` counted `<script src>` and stylesheets but not the shared
  chunks Vite lists as `<link rel="modulepreload">`, which download with the
  first load all the same. Such chunks existed before this work — phase 1's
  committed state is **80.0 KiB** counted properly, not the 74.5 KiB
  reported above — and route-level loading made more of them. The script
  now counts them.
- **The legacy styles are in Tailwind's `base` layer.** Left unlayered,
  their element rules (`button`, `input`, `a`, …) beat every utility class
  a shadcn/ui component is built from — unlayered CSS outranks all layers,
  whatever the specificity. The first screenshots showed it: sidebar and
  breadcrumb links in the legacy link blue. The legacy `a` rule now skips
  elements with `data-slot`, which shadcn/ui puts on everything it renders.
- **The account menu is not modal.** A modal Radix menu marks the rest of
  the page `aria-hidden` while open, which the accessibility gate flags as
  serious. One consequence, tested around rather than fixed: a click on the
  trigger during the menu's closing animation, about a tenth of a second,
  counts as a click outside and is ignored.
- **Third-party notices.** Radix brings `react-remove-scroll-bar`, whose
  npm package ships no licence file. The notices build fails on a missing
  text by design; that package is now a named exception which states the
  declared licence and where the text is (checked: MIT, in the upstream
  repository). The notices list 167 packages.
- **Tests.** `17-shell.spec.ts`: every section reached from the sidebar by
  keyboard, with `aria-current`; axe clean with the sidebar open, collapsed
  and as a phone sheet, and with the account menu open; the collapsed state
  surviving a reload with no cookie set. The sign-out test opens the account
  menu first, and the sign-in helper waits for the page to settle, since the
  sign-in page now loads after the first paint. 43 browser tests pass.

### Phase 3, step 1 — Settings, 2026-11-02

- **The four settings pages** (Site, Appearance, Email, Advanced) are built
  from shadcn/ui's card, field, input, textarea, native select, checkbox,
  badge, alert and separator, through a few building blocks in
  `components/page.tsx`: a page header (`h1`), sections (a card whose title
  is an `h2` and which is a region named by it), status badges, facts lists
  and inline code. No copy changed.
- **The form generator's controls and field shell** (`form/controls.tsx`,
  `form/form.tsx`) are on the same components; its engine is untouched
  (phase 4). Every page that draws a schema form — the editor, plugin
  settings, the record editor — now shows these controls.
- **Added from the registry, as generated** (`radix-nova`): badge, textarea,
  native-select, checkbox. `shadcn add` does not run non-interactively here,
  so they were fetched with `shadcn view` and written unchanged except for
  the one step `add` performs itself: its icon placeholder replaced by the
  lucide icon it names. A native `<select>` was kept on purpose: keyboard
  behaviour and the browser tests' `selectOption` stay as they were.
- **Two tokens:** `--success` beside the existing `--warning`, for status
  badges in both schemes.
- **Things the tests caught:** shadcn's alert is `role="alert"` by default;
  standing notes on a page (no Resend key, a theme change needs a deploy) are
  `role="note"`, as the shell's no-purge-token note is. A section must be a
  named region for "Failed background jobs" to be found; an element with
  `display: contents` was not enough.
- **Unit tests** resolve the admin's `@/` alias too (`vitest.config.ts`):
  `test/admin` imports the Advanced page's lists of what is instant and what
  needs a deploy.
- **Size. First load: 126.4 KiB**, from 123.6 KiB after merging `main`.
- **Checked:** the browser suite (44) twice in a row, axe in light and dark
  included; screenshots of the four pages in both schemes were reviewed and
  not committed. One run, with an extra screenshot spec appended, failed the
  account menu test of phase 2 once (the closing-animation timing recorded
  above); it passed in the two runs either side.

### Phase 3, step 2 — Account and API tokens, 2026-11-02

- **The account page** is built from the same blocks: the password form is a
  section with its submit in the footer, the hashing note is a `role="note"`
  alert like the Appearance page's, and the token list shows each scope as
  a badge. No copy changed.
- **Two departures from the plan's component list, both to keep the tests
  unchanged and the behaviour as it was.** The tokens stay a list, not a
  table: `06-tokens` finds a token by its `listitem`. The new token is
  shown inline in a `role="alert"`, not in a dialog: a dialog closed by
  Escape or a click outside would lose a token that is never shown again,
  and both token tests read it from the alert. A revoked row keeps the
  class `revoked`, which `06-tokens` asserts; it styles nothing now (the
  strike and muted colour are utilities), so it is a marker, not a legacy
  class.
- **A fix that reaches step 1.** The legacy `button` rule's padding also hit
  shadcn's checkbox — a `button` that sets its width and height but not its
  padding — and stretched it to a wide box; the Site page's prefix checkbox
  had it too. The rule's frame (font, border, radius, padding, disabled
  opacity) now applies only to buttons without `data-slot`, as the legacy
  `a` rule already did. Legacy buttons (the content list's, for one) were
  checked unchanged in a screenshot.
- **Size. First load: 126.5 KiB.**
- **Checked:** the browser suite (44) passed three times, axe in light and
  dark included; unit tests (1445), lint, typecheck, build and bundle size
  pass. Screenshots of the page in both schemes, with a freshly minted
  token and a revoked one, were reviewed and not committed.

### Phase 3, step 3 — Content list, 2026-11-02

- **The content list** is a shadcn/ui table in a bordered frame, its
  filters native selects with labels, its statuses badges (published in
  the success colour, scheduled in the warning one, draft plain), and its
  pager two outline buttons. No copy changed.
- **Departure from the plan:** no pagination component. shadcn's is a row
  of page links; this list pages by offset with only Previous and Next,
  because the API answers `hasNext`, not a total.
- **On a phone** the table scrolls sideways inside its frame; the title and
  path columns keep a minimum width so a path is not broken a few
  characters at a time.
- **Added from the registry, as generated:** table.
- **Size. First load: 126.5 KiB** (the table is in the content list's own
  chunk).
- **Checked:** the browser suite (44); screenshots in light and dark at a
  desktop and a phone width, reviewed and not committed.

### D7 — The first-load budget, raised by phase 0

150 KiB is the project's own number (`ADMIN.md §13`), not a platform limit:
the admin is served from Static Assets, which are not billed as Worker
invocations, and nothing of it enters the Worker script. It was set when
the admin was 17 KiB on Preact and has been a useful tripwire since.

| | Keep 150 KiB | Raise it |
| --- | --- | --- |
| Means | Phase 5 is not done, or is done with a smaller router than the stack decision names | A new figure, written down with its reason, before phase 5 starts |
| Costs | The admin stays on a hand-written router and signals: D1's option A, not B | A slower first paint of the admin on a poor connection; operators, not visitors, pay it |

**Not decided, and not needed until phase 5.** Recommended: keep 150 KiB as
the gate through phase 4, then set the new figure from this admin's own
measured numbers rather than from a scaffold's. The owner chose option B
knowing phase 5 was the risky part; this is what that risk turned out to be.

## 9. Not in this plan

- New features, copy changes, translating the admin.
- A component package shared with other Fobstack products.
- Visual-regression tooling.
- The purge-reporting fix on `fix/purge-failure-reporting`, which touches
  one admin message and merges independently.
