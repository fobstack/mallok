# The Mallok product vision

- Direction: 0.1 baseline (second revision, 2026-08-28: the foreign-trade B2B
  vertical established as the first)
- Document date: 2026-08-28
- First product release: 0.1
- Repository: `FobStack/mallok`
- Licence: Apache-2.0 (§12)

> **Read `docs/PRODUCT_CONTRACT.md` first.** It is the canonical statement of
> what Mallok is — a complete Cloudflare-native framework, published as one
> package, with a site depending on an exact version of it — and it wins where
> this document disagrees.

## 1. In one sentence

**Mallok is an open-source, Cloudflare-native content website: content lives
as Markdown in D1, an edit is live immediately, there is no build step, there
is no server, and the content can be taken away at any time. The first
vertical is foreign-trade B2B company sites — one deployment, several
languages, a product catalogue, inquiries straight to an inbox, starting at
zero cost and paying only once there is volume.**

## 2. The strategic judgement

A content website today takes one of two paths, and each has a structural
defect:

- **The CMS path (WordPress, Ghost)**: good editing, edits live immediately, a
  theme and plugin ecosystem. The price is a server, a database, a running
  stream of security updates, and performance rescued by layer upon layer of
  caching plugins.
- **The static-generation path (Astro, Hugo, Eleventy)**: excellent
  performance and output quality, cheap deployment. The price is that content
  becomes part of a source repository — fixing a typo means a commit, a CI
  run, a build and a redeploy, and non-technical people cannot get in at all.

Mallok's position is that neither price is necessary. Cloudflare's Worker, D1
and R2 make "content in a database" and "static bytes from the edge" the same
thing for the first time.

> WordPress's editing experience, an edge network's performance, open source,
> and no lock-in on your content.

The comparisons should be stated precisely: **Mallok's direct competitors are
WordPress and Ghost.** Astro is a reference point for performance and output
quality, not something to beat.

### 2.1 Why the first vertical is foreign-trade B2B

A general-purpose CMS faces diverging requirements; a trade company site faces
converging ones — several languages, a product catalogue, company
credentials, industry news, and one inquiry form. Sites of this kind mostly
run today on dated WordPress templates or on annually-billed website SaaS:
slow, expensive, and with content that cannot be moved. Mallok's three
promises — no operations, no build, no lock-in — are worth most here, and the
product owner runs sites of exactly this kind, so every requirement is real
and verifiable.

Choosing a vertical does not change the architecture; it changes what 0.1 is
accepted against. **0.1 is done when a real trade site runs on Mallok and
receives an inquiry** — not when "WordPress users would want to move", which
cannot be accepted against. General blogs, documentation sites and company
sites remain the same product; they are simply not what 0.1 is judged by.

## 3. Who it is for

### 3.1 Primary

1. **The product owner's own portfolio of trade sites**: several industry
   sites, multilingual news produced daily by an AI pipeline, product
   catalogues, inquiries. This is 0.1's first and strictest reviewer.
2. **A new trade company**: no technical staff, one domain and one Cloudflare
   account (or willing to create one), needing a multilingual company site
   that can receive inquiries, on a budget near zero.
3. **Technical teams and agencies** delivering trade or content sites for
   clients, where the client updates the content afterwards and the agency
   does not want to run a server per client.

### 3.2 Secondary

- Site owners leaving WordPress, tired of hosting, plugin conflicts and
  security updates.
- Authors who built on Astro or Hugo and cannot live with editing content
  through Git and CI.
- Editors and operators who only write content after deployment and never
  touch infrastructure.
- Designers and developers writing themes, starters and plugins for Mallok.

### 3.3 Not for

Mallok 0.1 is not for applications needing freely written server-side business
logic, membership and permission systems, complex form flows, or admin
back-office systems. E-commerce is an explicit **later direction** (§9), but
0.1 goes as far as inquiries and no further — no cart, no payment.

## 4. The product model

The product has two timelines, and the boundary must be visible at a glance:

| | Who changes it | How it takes effect |
| --- | --- | --- |
| **Content**: pages, articles, products, media | A non-technical user, in the admin | **Immediately — no build, no deployment** |
| **Settings**: site name, languages, navigation, domain, SEO defaults, theme options, plugin settings and secrets | A non-technical user, in the admin | As above |
| **Themes**: how the site looks, which content kinds exist | Someone technical, in the source tree | Edit source, commit, redeploy |
| **Plugins**: added capability, such as the inquiry form | Someone technical, in the source tree | As above |

**Day-to-day operation only touches the first two rows.** Themes and plugins
are the site's frame; they travel with the source and take effect on
deployment — the same way Astro and Hugo treat templates, except that Mallok
has taken *content* out of that line.

This is the product's single most important boundary: **content needs no
build; the frame does.** The interface must say so, and must never let a user
believe switching themes is also one click.

**A starter** is the repository you forked: the theme already chosen, the
plugins already present, plus example content and a settings preset. Creating
a site means deploying that repository once, and the setup wizard imports the
example content. When a user says "the trade template", this is what they
mean.

Underneath there are still Workers, D1, R2, caching, schema migrations and
versions — and the admin must never require a user to understand any of them.

## 5. The promises

### 5.1 An edit is live immediately, with no build

Saving an article is one D1 write plus a precise cache purge. No build queue,
no CI, no redeploy, no "wait two minutes and see". **This is Mallok's central
difference from every static generator, and no design may trade it away.**

### 5.2 Content is standard Markdown and can be taken away

D1 holds Markdown source with YAML front matter, images referenced as
relative paths like `images/xxx.jpg` — not rendered HTML, and not a private
structure. One export produces ordinary content bundles (`index.md` plus
`images/`), a shape chosen because it echoes the bundle convention static-site
generators use — not to promise those specific tools can read it (Astro is a
reference point for output quality, not a compatibility target, per
[CONVENTIONS.md](CONVENTIONS.md)). **What is promised, and what round-trip
fidelity must cover, is narrower and concrete: an export re-imports into a
fresh Mallok deployment byte-identically.** Business data such as inquiries
exports too. **No lock-in is not marketing copy; it is an export feature, and
round-trip fidelity must be covered by tests.** The format is in
[CONTENT_FORMAT.md](CONTENT_FORMAT.md).

### 5.3 Deployed into your own Cloudflare account, starting at zero

Mallok hosts nothing. The site, the database, the images and the domain all
live in the user's own Cloudflare account, where Mallok can neither reach them
nor manage them. 0.1 has no Mallok account system, no billing and no
multi-tenant control plane.

Every Cloudflare product it depends on has a free tier, and there is exactly
one paid step — Workers Paid at $5 per account per month — which changes
neither the architecture nor the data. The cost ladder is §7.

### 5.4 One-click deployment comes in tiers, stated honestly

"One click" means different things to different users. The product offers
three tiers and states each one's prerequisite plainly:

| Entry point | For | Prerequisite | Release |
| --- | --- | --- | --- |
| `npx mallok create` | Technical teams, portfolios | Node installed, able to sign in to Cloudflare | 0.1 |
| The "Deploy to Cloudflare" button | Anyone with a GitHub or GitLab account | A GitHub or GitLab account plus a Cloudflare account | Deferred — needs a public starter-site repository that does not exist yet, and is not Nundar |
| A hosted setup assistant on the project site | A non-technical trade company owner | A Cloudflare account and a one-time authorisation | 1.0 |

0.1 ships the first of the three. All three converge on the setup wizard built into the Worker, which configures
the administrator, company details, languages, email and domain. **Binding a
custom domain is a precondition for caching to work at all** (ARCHITECTURE
§2); the wizard must say so, and `.workers.dev` is preview only.

### 5.5 Multiple languages are part of the content model

Multilingual on a trade site is not "install a translation plugin". Every item
has its own language and translation group, URLs are prefixed by language, the
sitemap carries hreflang automatically, and a theme's interface strings follow
the site's language. 0.1 delivers the content model, the URL rules and the
simplest translation management; AI translation arrives as a plugin in 0.2.

### 5.6 Visitor pages ship no client-side JavaScript

The admin's complexity does not reach visitor pages. The official themes emit
semantic HTML and CSS with 0 bytes of client-side JavaScript; mobile
navigation and galleries are pure CSS, and a WhatsApp button is a link. Where
interaction is needed, a theme or plugin adds it explicitly and the admin
states the cost. The one exception in 0.1 is the Turnstile script the inquiry
plugin injects against spam.

### 5.7 Switching themes does not touch content

A theme is a declarative set of templates in the source tree, bundled into the
artifact at deployment. **Switching themes means editing source and
redeploying** — it is part of the site's frame, not a switch in the admin.

A theme switch **migrates no content, changes no content id, and by default
changes no public URL**: the content is in D1 and the theme only decides how
it looks. Switching to a theme that does not know a content kind renders that
kind through the `page` layout, leaving the content and its URLs untouched.

There is no arbitrary JavaScript in a theme. Installing an unfamiliar theme is
not the same as running a stranger's code on your site, but it does enter your
build artifact, so reviewing it is the same act as reviewing any other code
that enters the repository.

Distribution is therefore **source**: fork a starter repository, or copy a
theme directory into your own. That is plainer than a zip upload, but it means
what a theme can do is checkable at build time, and it puts themes and plugins
on one path.

### 5.8 A plugin's boundary is stated honestly

A plugin is real JavaScript that hooks in declaratively, with its own tables,
routes, settings, scheduled work, admin panels and the ability to send email.

**Official and third-party plugins take the same path**: source into the
repository, bundled at build time, and **installing or updating one requires a
redeploy**. The interface must say so and must never look like a one-click
install.

Once a plugin is in the artifact, its **settings and secrets are editable in
the admin at any time and take effect immediately** — the inquiry recipient
address, the Resend key. **Whether it is enabled is an immediate switch too**;
that decides only whether the code runs, not what code is in the artifact.

A plugin runs in the user's own account. The risk boundary is a WordPress
plugin's, and the product states that rather than concealing it.

### 5.9 Local and production are the same thing

The admin runs on localhost or deployed to Cloudflare: the same code, the same
API. The CLI is a third entry point calling that same API. There is no
capability gap between the three.

### 5.10 Open source, with a community that can genuinely take part

Themes, starters and plugins have public, documented, versioned contracts, and
what a third party writes uses the same mechanism as what the project writes.
There is no private interface only the official code can reach. The Mallok
project site runs on Mallok.

## 6. What 0.1 delivers

Listed by the four objects; anything absent from this table is not in 0.1:

| Object | 0.1 delivers |
| --- | --- |
| Content | Content kinds declared by the theme (the official trade starter provides page, article, product, category, case, faq); a Markdown source editor plus a field form generated from the kind's schema; media upload converting to WebP with width variants in the browser; languages and translation groups; draft, published and scheduled; bundle import and export; CLI `publish`, `import`, `export` |
| Themes | The official themes, source in the tree and bundled at build time; `theme.json` declaring content kinds and options; **switching themes needs a redeploy**, while the options it exposes are editable in the admin |
| Settings | Site details, enabled and default languages, navigation, SEO defaults, domain status, Resend email, cache lifetime |
| Plugins | The official `inquiry` plugin (form, Turnstile, storage, Resend in both directions, an admin inquiry list, CSV export); the enable switch and settings panel, both immediate; **installing and updating a plugin needs a redeploy**; the third-party plugin contract and its documentation |
| Built into the core | The sitemap with hreflang, RSS, canonical and OG, JSON-LD (Organization, Article, Product, FAQ), signed draft preview links, redirects, and a note on Cloudflare's site-level analytics |
| Deployment | `npx mallok create`, the setup wizard, runtime self-migration, `mallok upgrade --to <version>` and its backup prompt. The Deploy to Cloudflare button is deferred (§5.4) |

## 7. The cost ladder

"Free at first, pay once there is volume" holds only if every dependency has a
free tier and the upgrade changes no architecture. The table is from the
official documentation, checked 2026-08-28, and is not an established fact
until measured:

| Purpose | Product | Free tier | Beyond it |
| --- | --- | --- | --- |
| Rendering, admin, API | Workers | 100k requests/day, 10 ms CPU each; a script up to 64 MiB uncompressed | Workers Paid at $5/month: 10M requests, 30M CPU-ms, 30 s CPU by default; the same 64 MiB script limit |
| Content, inquiries | D1 | 5 GB total, 5M rows read/day, 100k rows written/day; exceeding it makes it unavailable for the day | With Paid: 25B rows read/month, 50M written/month, $0.75/GB past 5 GB |
| Images, attachments | R2 | 10 GB-month, 1M writes and 10M reads/month, egress permanently free | $0.015/GB-month |
| The admin app | Workers Static Assets | Unlimited free requests, 20k files, 25 MiB each | With Paid, up to 100k files |
| Page caching and purging | Cache API + Purge API | Free; ample single-file purge quota, 5 tag/host/everything purges per minute | Higher on Pro and Business |
| Scheduled publishing, email retries | Cron Triggers | **5 per account** | 250 with Paid |
| Form abuse protection | Turnstile | Free, 20 widgets, 10 hostnames each | Enterprise |
| Domain and DNS | Registrar + DNS | Domains at cost, DNS free | — |
| Visitor analytics | Cloudflare site analytics | Free | — |
| Sending email | Resend | 3,000/month, 100/day, 3 domains | Pro at $20/month for 50,000 |

Deliberately unused: Workers KV (1,000 writes a day on the free tier),
Cloudflare Images (paid), and the Email Workers send binding (Paid-only, and
only to verified addresses). Queues' free tier allows 10,000 operations a day
but 0.1 does not need it — cron covers email retries — and it will be
re-evaluated at the storefront stage.

Two free-tier limits shape the product directly: **5 Cron Triggers per
account** means one free account carries scheduled work for at most five
sites, so a larger portfolio needs Paid; and **exceeding D1's free tier makes
it unavailable for the day**, so the admin must show usage and warn as the
limit approaches.

## 8. What success looks like for 0.1

Someone running a trade company who has never used Mallok — or a technical
person acting for them — can:

1. Install Mallok into their own Cloudflare account with the CLI or the Deploy
   button and complete the setup wizard;
2. Bind their own domain and have the site serve from it with the cache
   hitting;
3. Choose the trade starter, fill in the company details, and immediately have
   a working home page, about page and contact page;
4. Enter ten products with specification tables and images, publish an
   industry news item, and see it on the public URL within a minute;
5. Enable a second language, create a translation of one product, and have
   both languages carry correct URLs and hreflang;
6. Switch themes by changing one line and redeploying, with all content and
   URLs preserved;
7. Publish a local directory of bundles, images included, through the CLI;
8. Receive an inquiry a buyer submitted from a product page — the owner gets
   the email within seconds, the buyer gets an acknowledgement, and the admin
   shows the inquiry and can export it as CSV;
9. Export all content and inquiries in one action, confirming they can leave
   whenever they want.

Finishing only the render core, only the CLI, only running locally, or not
receiving the inquiry, is not finishing 0.1.

## 9. The roadmap after 0.1

Directions, not commitments, and none of it may enter 0.1 early:

- **0.2**: the visual editor (Tiptap); product CSV/Excel import; an AI
  translation plugin (`onContentSave`); an inquiry cart (several products
  combined into one RFQ, which is what a trade buyer actually does); a
  WordPress importer; a revision-history interface.
- **0.3**: payment for samples and small orders (Stripe Checkout or PayPal's
  hosted page, with the Worker only creating a session and receiving a
  webhook, never touching card details); inquiry webhooks pushed to a CRM.
- **1.0**: the hosted setup assistant; marketplaces for themes, starters and
  plugins; a full storefront plugin with variants, stock, orders and order
  email.

The line from inquiries to a storefront is straight: the tables, write routes,
secrets, scheduled work, admin panels and email a storefront needs are exactly
the six plugin capabilities 0.1 built for the inquiry plugin. The core needs
no new concept.

## 10. Non-goals

- No Mallok hosting service, account system, billing or multi-tenancy — a
  direction beyond 1.0, not part of 0.1.
- No cart, payment, membership or comments; from 0.2 those are plugins.
- No collaborative editing.
- Not a compatibility layer for Astro, Next.js or WordPress, and no
  implementation of PHP or the WordPress theme format.
- No requirement that a user understand Workers, D1, R2, caching or schema
  migrations.
- No faking "one click" by hiding costs, account ownership, failure states or
  what deleting data does.

## 11. Known risks

These belong in the vision because they decide whether the product works:

1. **The free plan's 10 ms of CPU.** The product promises to start on the free
   tier, so this cannot be waved away with "upgrade". The cache-hit path must
   be extremely cheap; a cold render moves Markdown parsing off the request
   path through the derived fragment cache in D1, leaving only template
   rendering; and a list page never parses a body. See ARCHITECTURE §5 and §6.
2. **Caching is only reliable on a custom domain.** The official documentation
   states the Cache API works on custom domains; `.workers.dev` behaviour must
   be measured. A trade site needs a domain anyway, so the bar is acceptable —
   but the wizard has to say it plainly.
3. **The ecosystem starts at zero.** 0.1 has a handful of official themes, one
   starter and one official plugin. The strategy is to win one vertical on "no
   operations, no build, no lock-in, and inquiries arrive"; the ecosystem
   takes time.
4. **A single cloud vendor and a single email provider.** The mitigation is
   that content and inquiries export at any time, and that email goes through
   one `sendEmail` boundary where Resend is 0.1's only implementation — not a
   pretence of multi-cloud.
5. **The compliance and quality of an AI content pipeline** are not Mallok's
   responsibility. Mallok guarantees only that what is given is published,
   that it is live within a minute, and that missing images are reported.

## 12. Current facts

**Updated 2026-09-01.** This section previously recorded the state on
2026-08-28, when the repository held documentation only. What has changed:

- **The repository exists.** `FobStack/mallok`, currently private.
- **The licence is settled: Apache-2.0**, chosen over MIT for its explicit
  patent grant and patent-retaliation clause. A separate trademark policy
  keeping the `Mallok` name is still outstanding.
- **The implementation exists** — all seventeen tasks, 357 tests passing.
  See [ACCEPTANCE.md §14](ACCEPTANCE.md) for what that is and is not evidence
  of.
- **Nothing has run against a real Cloudflare account.** No acceptance
  criterion is verified on real infrastructure, and the platform limits quoted
  in §7 still come from documentation rather than measurement.
- Three decisions the product owner confirmed on 2026-08-28 stand: multiple
  languages belong to the content model; third-party keys are encrypted into
  D1 and configured from the admin; official plugins are pre-bundled and
  enabled by a switch.
