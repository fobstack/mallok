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

### Phase 3, steps 4 to 8 and the gate — 2026-11-03

Each step is its own commit, in the plan's order. The browser suite was run
on the media step alone, on the plugins and record editor steps together,
and then on the whole set as fixes landed; the commits in between were not
run one by one.

- **Step 4, media.** The upload target is a dashed drop zone around a
  visually hidden file input, which keeps the keyboard path the old label
  had; the library is a card grid; the picker is shadcn/ui's dialog in place
  of the native `<dialog>`, with the same name, Escape to close and focus
  kept inside. No progress bar: the upload reports a stage (hashing,
  converting, uploading), not a fraction, so a bar would have nothing true
  to show.
- **Step 5, plugins, declarative panels, related rows.** Each plugin is a
  card with its switch (shadcn's `switch`, still named "<plugin> enabled")
  in the header; panels are tables with sort buttons, row checkboxes and a
  pager; a read-only row opens in a sheet that keeps its old name
  ("<panel> detail"). **No tabs:** a tab hides its panel, and the browser
  tests (and an operator) expect a plugin's settings, secrets and panels to
  be on the page together. Badge cells colour only the values the admin
  knows (published, scheduled, ok, warn); a plugin's own values stay plain.
- **Step 6, record editor and action parameters.** Both forms are sheets
  from the right, named as the dialogs were. A click outside does not close
  them, as it did not close the native dialog — a stray click must not lose
  what was typed; Escape and the close button do. Money fields and
  repeatable rows use the field components.
- **Step 7, content editor.** The bar, the translation switcher, the three
  panes and the attached panels are Tailwind and shadcn/ui; CodeMirror is
  themed with `EditorView.theme` reading the tokens (background, text,
  gutters, selection, the missing-asset marker), so it follows light and
  dark without a second theme. The preview frame stays white in both
  schemes: a theme's page is designed on white. axe, scanning an existing
  long item rather than the new one `05-accessibility` opens, reported the
  Markdown pane's scroll area as unreachable by keyboard: it does not count
  a contenteditable as focusable. The editable element now also carries
  `tabindex="0"`, which changes nothing for the keyboard.
- **Step 8, setup wizard.** A numbered stepper, one card per step, a radio
  group for the starters. Two things axe caught on the way: a Radix radio
  named only by `<label for>` is reported as an unnamed button, so each
  also points at its label with `aria-labelledby`; and shadcn's destructive
  alert prints its text at 90 % opacity, under AA on the light card, so the
  wizard's alerts use full strength. Every step was captured against a
  mocked API in light and dark, at a desktop and a phone width; the real
  wizard is still driven by `01-wizard`.
- **The gate.** No page uses a legacy class: the shell's content area, the
  lazy-route fallbacks and the not-found page were the last. `styles.css`
  is the tokens and Tailwind's base layer, 163 lines from 1,167. Its old
  element rules set the body to 15 px with a 1.55 line height; the admin
  now has Tailwind's defaults, and every component sets its own size. One
  class name remains on purpose: a revoked token's row is still marked
  `revoked`, which `06-tokens` asserts and nothing styles.
- **Found, not fixed here:** the media API never returns the `url` the
  admin's `MediaItem` declares, so library thumbnails and the editor's image
  previews are blank — on `main` too, so it predates this work. Raised as
  its own task.
- **Size. First load: 125.0 KiB**, from 126.5 KiB: the stylesheet lost its
  legacy rules.
- **Checked:** the browser suite (44) passed in each of the eight runs of
  these steps, the last on the final tree; axe was clean on every page and every overlay (media picker, record
  sheet, action sheet, every wizard step) in light and dark; unit tests,
  lint, typecheck, build and bundle size pass. Screenshots at a desktop and
  a phone width were reviewed and not committed.
- **Not done here:** the plan's real-site check at the end of phase 3 — the
  gate site, deployed by the maintainer. Nothing has been deployed.

### Phase 4 — Forms on React Hook Form, 2026-11-03

- **Dependencies:** `react-hook-form` 7.89.0 and `@hookform/resolvers`
  5.9.1, both released more than two weeks before they were added (the
  newer 7.91.0 and 7.0.1 were not). Zod was already a dependency.
- **The generator** (`form/form.tsx`) renders each declared field through
  React Hook Form's `Controller` and checks it against its declaration with
  the same `validate()` as before, now as the field's rule; a failed submit
  marks every failing field at once. `validateAll` went with the hand-kept
  error maps that used it. It takes a name prefix, so a record's repeatable
  rows bind as `variants.0.sku`, and can leave checking to the server.
- **Callers:** site settings, theme options (bound with `values`, so
  switching the language being edited reloads them), plugin settings, the
  record editor and action parameters, and the content editor's front
  matter. The record editor's rows are a `useFieldArray`, whose ids replace
  the keys it used to mint itself.
- **Server errors** (`ApiError.fields`) are set on the fields they name with
  `setError`, beside the request's own message, which is still said where it
  was: a field the form does not show would otherwise swallow it.
- **Zod** checks the fixed-shape forms: sign-in, the password change, a new
  token and the email sender. They are `noValidate`; the message is the
  generator's ("This field is required.", or the rule the help text already
  states) and is the field's description, as the generated fields' are.
- **Not as the plan said:**
  - Site settings are checked through their field declarations rather than
    a Zod schema: they are declared like theme fields, and the declaration
    is their one source of rules.
  - Unsaved-changes interception stays on the Markdown text, not the
    form's dirty state. The text is the truth (docs/ADMIN.md §6.2), the
    form is a view of its front matter, and `13-editor-untouched` is the
    test of exactly that; no other page intercepts leaving.
  - The setup wizard's forms were not put on Zod; the plan did not list
    them.
- **The licence notices** (`scripts/third-party-notices.mjs`) learned that
  a package can ship sub-path packages: `@hookform/resolvers/zod` has its own
  manifest and no licence file, and stopped the package build until its
  parent's licence was found for it.
- **Tests:** `test/admin/schema-form.test.tsx` renders the generator into a
  DOM (every failing field reported with its message as its description,
  values submitted when valid, checks left to the server when asked, a
  server message put on its field, a nested group read and written), and
  the notices test covers the sub-path licence. Each was seen to fail with
  its fix reverted.
- **Size. First load: 125.0 KiB**, unchanged: React Hook Form and Zod are in
  page chunks. Zod is 17.9 KiB gzip and its resolver 1.3 KiB, loaded with
  the sign-in, account and email pages — so the sign-in screen, the first
  thing a signed-out operator sees, now loads about 19 KiB more. Loaded on
  demand: 445.1 KiB, from 429.6.
- **Checked:** the browser suite (44) twice; axe clean on the sign-in and
  account pages with their messages showing, in light and dark; unit tests,
  lint, typecheck, build and bundle size pass.

### Phase 5 — Routing and data, 2026-11-03

- **Dependencies:** `react-router` 8.5.0 and `@tanstack/react-query`
  5.104.4. React Router's current major is 8 (`RouterProvider` now comes
  from `react-router/dom`, `react-router-dom` is gone); 8.5.0 is the newest
  release older than two weeks. Removed: `@preact/signals-react`, its Babel
  transform, the `vite.config.ts` guard around it, and `@babel/core`, which
  only that transform used.
- **Routing.** React Router in data mode replaces `router.ts`, `routes.ts`
  and `components/lazy.tsx`. The basename is `/_mallok/app/` with its slash,
  so the admin's home stays at the address it always had; the entry point
  adds the slash to a bare `/_mallok/app`, which the Worker also serves.
  The root route's loader settles the session and, signed in, loads the
  workspace before the first render (the skeleton shows meanwhile); it does
  not run again on navigation. Signed out, any address shows the sign-in
  form, and signing in leaves the operator on the page they asked for —
  not a redirect, so the address is kept. Each route group has an error
  element; an unknown address is the not-found page. The setup wizard runs
  before there is a session and is its own small app in `main.tsx`.
- **Pages load with `React.lazy` inside the route's element, not with the
  route's own `lazy`.** React Router holds the previous page on screen until
  a lazy route's code arrives, so "New" left the content list up, live, while
  the editor loaded; `03-publish` then picked the list's own Type filter and
  its change cancelled the navigation. The admin moves at once and shows a
  still outline, as before. Still, not pulsing: `17-shell` waits for every
  animation to finish, and an endless one cut off as the page arrives reads
  as aborted.
- **Data.** `queries.ts` holds one key scheme (`session`, `settings`,
  `theme`, `health`, `content`, `media`, `plugins` with each panel's rows,
  records and related rows under it, `tokens`, `diagnostics`, `setup`).
  Every read is a query, and no `useEffect` fetches any more; writes stay
  plain calls that then invalidate or replace what they changed. Retries and
  refetch-on-focus are off: a failure is said, not hidden behind a retry.
- **The signals** became queries — session, settings, theme and health,
  read with `useSuspenseQuery` under the shell, where the loader has
  already filled them — and the address: the content list's type, status,
  language and page are search parameters, and the editor's language is
  the item's, or `?locale=` for a new one. `notice` became `notice.ts`, a
  `useSyncExternalStore` of one string: a message is not server state.
- **Behaviour that changed.** The language filter is no longer global: the
  sidebar's Content link opens the default language, and "← All content"
  goes back to the list in the item's language.
- **Fixed on the way:** "Create zh" in the editor's language bar never
  worked. The editor read the item id as `new?locale=zh&group=…`, asked the
  server for it and said it could not load it. It now reads the language,
  group and kind from the address and saves the translation into the
  original's group. `19-translation` covers it, and fails with either half
  of the fix reverted.
- **Two `Health` types** (the shell's and the Advanced page's) were one
  endpoint described twice; there is one now.
- **Found, not fixed here:** a second item saved into the same group and
  language makes the Worker answer 500 with an unhandled D1 constraint
  error instead of a 409. Raised as its own task.
- **Size. First load: 161.7 KiB** (budget now 170 KiB, D7), from 125.0 KiB.
  Loaded on demand: 446.4 KiB.
- **Checked:** the browser suite (45: the 44 that were there, unchanged, and
  `19-translation`) twice; axe clean on the content list, plugins, advanced,
  account and not-found pages in light and dark; unit tests (1447 — the
  three for the deleted path helpers went with them), lint, typecheck, build
  and bundle size pass.
- **Not done here:** the plan's real-site check at the end of phase 5 — the
  gate site, deployed by the maintainer.

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

**Decided 2026-11-03: raised to 170 KiB**, from this admin's own measured
number — 161.6 KiB with React Router and TanStack Query in and signals out
(phase 5 below), against the 175–190 KiB the scaffold suggested. The owner
had asked for the migration to be finished without stopping for questions,
and the stack decision names both libraries, so the budget was raised to
fit them rather than phase 5 dropped. **It is the owner's to confirm.** If
not, phase 5 is one commit at the tip of the branch: without it the admin is
phases 0–4, inside 150 KiB at 125.0, on the hand-written router and signals.

## 9. Not in this plan

- New features, copy changes, translating the admin.
- A component package shared with other Fobstack products.
- Visual-regression tooling.
- The purge-reporting fix on `fix/purge-failure-reporting`, which touches
  one admin message and merges independently.
