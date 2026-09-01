# Task 15 — The starter and the first-run wizard

- Status: **complete**, all checks green locally
- Date: 2026-08-30
- Scope: the `trade-b2b` starter, the wizard at `/_mallok/setup`, and making
  `atelier` the default active theme.
- Contract: `docs/ARCHITECTURE.md §11`, `§15`; `docs/ADMIN.md §5`.

## 1. Demonstrable loop

> A fresh deployment → walk the wizard → a working foreign-trade site with a
> home page, product families, products, an about page, a contact page with a
> working inquiry form, an FAQ, case studies and news.

Verified against `wrangler dev`: installing the starter created 13 documents
with no failures and switched the inquiry plugin on. The resulting site serves
`/products/grade-5-titanium-bar` with its breadcrumb resolving the category
reference, `/families/aerospace-alloys` listing its two products, the FAQ page
emitting `FAQPage` structured data, the inquiry form injected on product
pages, and a sitemap with 17 URLs.

## 2. `ACTIVE_THEME` is now `atelier`

The starter is written for atelier's six content kinds, and 0.1's acceptance
target is a real foreign-trade site (`PRODUCT_VISION §2`). Shipping `journal`
as the default meant the wizard had to tell every new user that its own
starter did not match its own theme — which it did, correctly, and that was
the signal to change the default rather than the message.

A fork whose site is a blog or a handbook edits that one line to `journal`,
`gazette`, `manual` or `folio` and redeploys. That is the whole switching
procedure, and it is why the line carries a comment saying so.

One test had to change with it: `flow.test.ts` asserted journal's exact
`<h1>` markup. It now matches the heading rather than one theme's class list,
which is what the rest of that file already did.

## 3. What a starter is

Source, like a theme or a plugin: content bundles compiled into the build and
imported **once** by the wizard. After the import they are ordinary content —
no link back to the starter, nothing that distinguishes them from typed
content (`ARCHITECTURE §11`). The import goes through the normal save path
for exactly that reason.

Cost: about 1.9 KiB gzip in the Worker bundle. It has to be there rather than
in the CLI, because the Deploy-to-Cloudflare path has no CLI to run.

## 4. Two steps that exist to tell the truth

The wizard collects four things, and two of its screens are mostly honest
reporting:

1. **Domain.** Without a custom domain the site runs on `.workers.dev`, where
   Cloudflare's edge cache does not apply (`ARCHITECTURE §2`). The wizard says
   that plainly — a preview, not a site — and gives the steps to bind one.
2. **Cache lifetime.** With no purge token configured, the wizard sets
   `cache_ttl` to 60 seconds and reports that it did, in wording that
   distinguishes an honest degradation from a fault
   (`CLOUDFLARE_RESOURCES.md §6`).

A starter written for a different theme is also stated rather than hidden: it
still imports, and its unsupported kinds fall back to the page layout
(`THEME_FORMAT §5.3`).

## 5. It closes for good

`site.setup_completed_at` is the gate. Once set, **every** route under
`/_mallok/api/setup` answers 404 — including the read-only status — so
someone who later finds the URL cannot re-seed a live site. The first step
(creating the administrator) is the only unauthenticated one; everything after
it requires that account, so a half-finished wizard cannot be hijacked.

`test/worker/setup.test.ts` asserts all of this, the 404-after-completion case
across every route in particular.

## 6. Verification

| Check | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 27 files / 291 tests pass |
| `pnpm build` | pass |
| `pnpm bundle:size` | 229.2 KiB gzip = 7.5 % of the Free limit |
| `pnpm admin:size` | 15.6 KiB gzip first load |

## 7. Not done / known limits

- **Steps 5 and 6 of `ADMIN.md §5` are not built.** The media domain
  (`media.<domain>`) and the Resend/DNS step both need Cloudflare API calls
  with an account-scoped token, which is Task 16's territory. Both are
  reachable from Settings, so nothing is unreachable — but the wizard is four
  steps, not seven, and that is a gap against the contract.
- **The wizard does not detect a bound custom domain.** It reports what the
  `site` row holds; detecting a binding needs the Cloudflare API.
- **Re-installing a starter is not offered.** `ARCHITECTURE §11` allows it as
  an explicit overwrite; the wizard runs once and Settings has no entry point.
- **The starter has no images.** Every bundle is text, so the site's product
  pages have no photography until the owner adds it. Shipping binary media in
  the Worker bundle would cost far more than the text does.
- **English only.** The starter's `nav` and content are `en`; a `zh` set was
  not written.
