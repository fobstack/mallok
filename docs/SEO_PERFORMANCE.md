# Mallok SEO and performance

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: defines the SEO output built into the core, the performance
  budgets, and how both are measured. **The numbers in §7 are proposed here
  for the first time and become acceptance gates only once the product owner
  confirms them** — particularly the entries marked "to be confirmed".

## 1. Why this document exists

A foreign-trade B2B site's traffic comes from search. `PRODUCT_VISION §2` names
Astro as "a reference point for output quality", which means: **a Mallok page's
HTML must stand level with a carefully configured static site**, or the "no
operations, no build" proposition is cancelled out by "but its SEO is poor".

`PRODUCT_VISION §5.6` separately promises zero client-side JavaScript on
visitor pages. The two reinforce each other: a page with no JavaScript scores
well without trying.

## 2. Built into the core, not a plugin

The core provides all of this, depending on neither a theme nor a plugin
(`PRODUCT_VISION §6`):

| Output | Path or location | Cache |
| --- | --- | --- |
| Sitemap, with hreflang | `/sitemap.xml` (plus `/sitemap-<n>.xml`) | Edge cache |
| RSS | `/feed.xml`, `/<locale>/feed.xml` | Edge cache |
| robots | `/robots.txt` | Edge cache |
| canonical | Each page's `<head>` | With the page |
| hreflang and x-default | Each page's `<head>` and the sitemap | With the page |
| Open Graph and Twitter Card | Each page's `<head>` | With the page |
| JSON-LD | Each page's `<head>` | With the page |
| Redirects | The `redirect` table, queried once before a 404 | Cached on a hit |

A theme **must** emit `{{ page.head }}` (`THEME_FORMAT.md §7.1`) — the core's
hreflang and JSON-LD are inside it. A theme that omits it fails the acceptance
in §8.

## 3. The sitemap

- Contains only content with `status = 'published'` and
  `published_at <= now`.
- Every URL carries an `xhtml:link rel="alternate"` for each translation,
  including an `x-default` pointing at the default language
  (`ARCHITECTURE §9`).
- A single file holds at most 5,000 entries; beyond that it paginates into
  `/sitemap-<n>.xml` with a sitemap index (`DATA_MODEL §3` already plans for
  `LIMIT 5000`).
- `lastmod` comes from `updated_at`.
- **No `changefreq` and no `priority`** — search engines have said plainly
  that they ignore them, so emitting them is noise.
- Drafts, scheduled content whose time has not come, and anything `noindex`
  never appear.

## 4. hreflang

The rules come from `ARCHITECTURE §9`:

- The default language has no prefix (`/products/x`); every other language is
  prefixed `/<locale>/` (`/de/products/x`).
- Each page emits every language in its `translation_group`.
- `x-default` points at the default language.
- **With only one language, no hreflang is emitted** — the current
  implementation already gates on `alternates.length > 1` in
  `buildHeadTags` (`src/core/view.ts`).
- **No automatic language detection or redirection** — `ARCHITECTURE §9`
  lists it as deliberately not done, because it harms SEO and shows crawlers
  the wrong content.

## 5. Structured data

0.1 emits four types (`PRODUCT_VISION §6`):

| Type | Where | Source |
| --- | --- | --- |
| `Organization` | The home page | Company details in `site.seo` |
| `Article` | Content pages of the `article` kind | Title, publication and modification times, language, canonical |
| `Product` | Content pages of the `product` kind | Front matter's `sku`, `specs`, images and `category` |
| `FAQPage` | Content pages of the `faq` kind | Front matter's question-and-answer pairs |

Two rules:

1. **A `<` inside JSON-LD must be escaped to `\u003c`**, or content can close
   the `<script>` element early. The implementation already does this —
   `buildHeadTags` in `src/core/view.ts`. This is a security requirement, not
   a stylistic one.
2. Structured data describes only what is **actually on the page**. Never emit
   a rating, price or stock level that the page does not show in order to win
   a rich result — that invites a manual penalty.

## 6. Open Graph and images

- `og:title`, `og:description`, `og:url`, `og:type`, `og:locale`,
  `og:site_name`.
- `og:image` comes from the content's `cover`, falling back to
  `site.seo.default_og_image`.
- `twitter:card` is `summary_large_image` when there is an image.
- OG images are served from the R2 custom domain and are content-addressed, so
  they carry `max-age=31536000, immutable` (`ARCHITECTURE §8`).

**0.1 does not generate OG images dynamically** — that would mean drawing in
the Worker, which contradicts the rule that the Worker does no image
processing.

## 7. Performance budgets (to be confirmed)

> These numbers are proposed here for the first time and will become gates in
> `ACCEPTANCE.md`. **The product owner must confirm them.** They rest on the
> official themes shipping no JavaScript, images being served directly from
> R2, and pages coming from the edge cache.

| Budget | Gate | Basis |
| --- | --- | --- |
| Client JS in official themes | **0 B** | `PRODUCT_VISION §5.6`; already a promise, not new |
| The single exception | The Turnstile script on inquiry pages | As above; already a promise |
| One page's HTML, uncompressed | ≤ 100 KB | To be confirmed |
| CSS, gzipped | ≤ 24 KB | To be confirmed |
| The LCP image | ≤ 200 KB | To be confirmed |
| Image requests per page | ≤ 20 | To be confirmed |
| Fonts | Google Fonts; at most two families per theme, `display=swap`, with a system fallback stack; not self-hosted | **Confirmed** at the 2026-08-29 design review, where the product owner approved four theme designs using Google Fonts |

Lighthouse, on mobile, against a custom domain, with the cache warm:

| Category | Gate |
| --- | --- |
| Performance | Median ≥ 95, any single run ≥ 90 (to be confirmed) |
| SEO | **100 every time** (to be confirmed) |
| Accessibility | ≥ 95 (to be confirmed) |
| Best Practices | ≥ 95 (to be confirmed) |

**Why SEO must be perfect**: that category checks deterministic things — meta
tags, canonical, hreflang, robots, link text — all generated by the core.
Anything short of 100 means the core has a bug, not that the environment
wobbled.

## 8. Server-side performance

These follow from the architecture and are not tuning knobs:

| Metric | Target | Source |
| --- | --- | --- |
| CPU on the cache-hit path | Under 1 ms | `ARCHITECTURE §4` |
| D1 calls in a cold render | One batch, at most 3 queries | `ARCHITECTURE §4` |
| Row reads on a list page | `LIMIT n+1`, **never `COUNT(*)`** | `DATA_MODEL §3` |
| Markdown parsing on a list page | **Never** | `ARCHITECTURE §4` |
| From saving content to it being publicly visible | Seconds | `PRODUCT_VISION §5.1` |

The real latency of that last row depends on which purge plan is chosen (A or
B in `ARCHITECTURE §6.2`), and **is not an established fact until measured in
`TASK-01 §4.5`**.

## 9. Image output

Generated when stage one substitutes R2 URLs for relative paths
(`ARCHITECTURE §8`):

```html
<img src="https://media.example.com/media/<sha>_960.webp"
     srcset="…480.webp 480w, …960.webp 960w, …1440.webp 1440w"
     sizes="(max-width: 768px) 100vw, 768px"
     width="1600" height="900"
     loading="lazy" decoding="async" alt="…">
```

- `width` and `height` come from the `media` table, **which is what prevents
  layout shift** (CLS).
- `loading="lazy"` is the default, but **an above-the-fold image, being an LCP
  candidate, should be `eager`**. The 0.1 rule: a content item's `cover` and
  the first image in the body are `eager`, everything else is `lazy`.
- External images are emitted as they are, neither proxied nor downloaded
  (`ARCHITECTURE §8`), so none of these optimisations protect them. The admin
  should say so.

## 10. robots.txt

```
User-agent: *
Allow: /
Disallow: /_mallok/
Sitemap: https://example.com/sitemap.xml
```

- Everything under `/_mallok/*` is disallowed.
- With no custom domain bound — the `.workers.dev` preview — it emits
  **`Disallow: /` and adds `noindex` to every page**. An indexed preview
  address creates duplicate content and damages the real domain.
- Signed draft previews respond `no-store` and `noindex`
  (`ARCHITECTURE §14`).

## 11. Redirects

- Changing a slug writes a `redirect` (301) automatically, so inbound links
  survive (`ARCHITECTURE §7`).
- Changing `site.default_locale` recomputes every `path` and writes the
  redirects in bulk. **That is an explicit operation requiring confirmation**
  (`DATA_MODEL §2.2`).
- One `redirect` row is read before returning a 404; a hit returns the
  redirect, which is cached.

## 12. How each thing is measured

| Item | Tool | When |
| --- | --- | --- |
| Lighthouse | `@lhci/cli`, pinned, development-only | Every task touching a theme or rendering |
| Accessibility | `@axe-core/playwright` | As above |
| HTML and CSS size | A build script, asserting against §7's gates | Every build |
| Structured data | Snapshot tests plus schema.org validation | Unit tests |
| Sitemap and feeds | XML snapshot tests | Unit tests |
| Server CPU | Workers Logs on a real account | The spike, and before a release |

**Lighthouse must run against a custom domain with the cache warm** — there is
no cache on `.workers.dev`, so numbers measured there mean nothing
(`ARCHITECTURE §2`).

## 13. Deliberately not done

- No dynamic OG image generation.
- No AMP.
- No automatically generated meta descriptions. When one is absent an excerpt
  is derived from the body, which is derivation, not generation.
- No keyword meta tags; search engines ignore them.
- No automatic language detection or redirection.
- No analytics script on visitor pages — Cloudflare's site-level analytics
  needs no client-side JavaScript (`PRODUCT_VISION §7`).
- No service worker and no prefetching.
