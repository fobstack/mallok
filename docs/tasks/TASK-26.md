# Task 26 — Plugin pages rendered through the theme

- Status: **done**.
- Date: 2026-10-05
- Scope: a plugin route may be a page — its handler returns a view and a
  theme layout renders it — and every `POST` to a plugin route passes a
  cross-site check.
- Source: the owner's task list of 2026-10-01, item M5
  (`docs/IMPLEMENTATION_PLAN.md`, phase six), with the owner's decision of
  2026-10-01 that the cross-site check applies to every plugin, refuses what
  a browser marks as cross-site, and allows a request carrying neither
  header.

## 1. Demonstrable loop

A plugin declares `cart` as `"render": "page", "layout": "shop/cart"` and its
handler returns `{ title, view }`. A theme lists `shop/cart` in
`pluginLayouts`. `/_mallok/p/shop/cart` is then a page of the site — the
theme's header partial, its language-pack strings, the plugin's cart lines —
and `/_mallok/p/shop/de/cart` is the same page in German, each linking to the
other through the theme's language switcher. A form on another site posting
to `cart/add` gets 403 before the handler runs. Switch to a theme without
that layout and the page still answers, plainly, and the admin says which
layout is missing.

## 2. What changed

| File | Change |
| --- | --- |
| `src/core/plugin.ts` | `render` and `layout` on a route, and the rules for them |
| `src/core/theme.ts`, `theme-package.ts` | `pluginLayouts` in `theme.json`; each must be a file the theme has |
| `src/core/page.ts`, `view.ts` | `page.kind` `plugin`, `plugin_page`, `buildPluginPageView` |
| `src/worker/plugin-pages.ts` | New. The cross-site check, page rendering, alternates, the built-in fallback |
| `src/worker/plugin-runtime.ts`, `render.ts` | The check before the handler; a view rendered, a `Response` passed through |
| `src/plugins/types.ts`, `src/worker/public.d.ts`, `framework.ts` | `PluginPageResult`; a handler returns it or a `Response` |
| `src/worker/admin-plugins.ts`, `src/admin/pages/plugins.tsx`, `types.ts` | Which page layouts the active theme lacks |
| `test/worker/plugin-pages.test.ts` | New |
| `test/core/plugin.test.ts`, `theme-package.test.ts`, `test/cli/strict-consumer.test.ts` | The manifest rules; a page route typed against the tarball |
| `docs/` | `PLUGIN_API §6, §7.2, §13.2, §13.3`, `THEME_FORMAT §4, §15, §16`, `SECURITY §7`, `ARCHITECTURE §4`, the plan |

## 3. Decisions and deviations

- **Only `POST` is checked for cross-site.** The plan says "page routes and
  state-changing POSTs". Read literally that refuses a cross-site `GET` of a
  page route — which is a link: the order link in an email opened from
  webmail arrives as `Sec-Fetch-Site: cross-site`. The task list's own word
  is "submission". So every `POST` to a plugin route is checked, page route
  or not, and no `GET` is; the docs tell authors not to change state on `GET`.
- **`same-site` passes.** The owner's rule is "what a browser marks as
  cross-site". A sibling subdomain of the site's own domain is `same-site`.
- **`Sec-Fetch-Site` wins over `Origin`** when both are present; it is the
  browser's verdict and a page cannot set it.
- **A handler may return a `Response` from a page route.** The task list has
  the handler return a view "instead of a `Response`", but a cart cannot work
  without redirect-after-POST.
- **`title` and `description` were added to the result.** The draft had
  `{ view, status?, headers? }`; a layout's `<title>` needs something to
  print.
- **Plugin layouts are flat files in `layouts/`.** The draft's example path
  is `layouts/plugins/shop/cart.liquid`; a theme's templates have always been
  `layouts/<name>.liquid` with no subdirectories, and that rule is unchanged.
  The layout *name* keeps the draft's `shop/cart` form.
- **The fallback cannot make an unknown view usable, and does not pretend
  to.** It names the missing layout and lists the view's top-level text,
  number and boolean values. A cart shown this way has no forms. The
  alternative — letting a plugin ship a fallback template of its own — is a
  new plugin capability and was not built; see §6.
- **A plugin page's default-locale address has no locale segment**, like the
  rest of the site.
- `page.head` is empty and `renderData`/`afterRender` do not run on a plugin
  page. It is the plugin's own page, private and unindexed.
- `themeApi` stays 1: `pluginLayouts` is optional and a theme without it is
  untouched.
- A redundant condition found by a mutation check was removed rather than
  given a test: a route has a layout exactly when it is a page route, so the
  runtime checks one of the two.

## 4. Verification

- `test/worker/plugin-pages.test.ts`, through `SELF.fetch` on a Worker
  composed with a probe theme, a version 2 plugin, a version 1 plugin and the
  official `inquiry` plugin, on a site with `en` and `de`:
  - the view rendered through the theme's layout with a partial, a
    language-pack string, the plugin's title and description, escaped values,
    and a function in the view never reaching the template;
  - `private, no-store` and `noindex`, no `Cache-Tag`;
  - the German page, and the switcher's two links from both sides;
  - status 422, two `set-cookie` headers kept, a handler's `cache-control`
    overridden; a 303 passed through;
  - the fallback for a layout the theme lacks, with the logged event, and the
    admin API reporting `provided: false`;
  - 500 and a logged event for a view from a plain route and a non-view from
    a page route;
  - cross-site: refused for a page route, a plain route and a version 1
    plugin before any handler ran; `same-origin`, `same-site` and `none`
    accepted; `Origin` compared when there is no `Sec-Fetch-Site`, including
    a look-alike host, another port and `null`; neither header accepted; a
    cross-site `GET` reaching its page; the inquiry form accepted from its own
    site (302) and refused from another (403).
- `test/core/plugin.test.ts` and `theme-package.test.ts`: what a manifest and
  a `theme.json` may declare.
- A page route returning a typed `PluginPageResult` compiles against the
  packed tarball.
- Mutation checks, each restored afterwards: no cross-site check, checking
  `GET` too, ignoring `Origin`, no `noindex`, a locale segment for the default
  locale, and not reducing the view to JSON each turn at least one case red.
- The five official themes and the inquiry plugin's own tests pass unchanged.
- The full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build &&
  pnpm bundle:size && pnpm admin:size`, and `pnpm test:e2e`.

## 5. Notes for the next release

- **A `POST` to a plugin route from another site is now refused (403).** An
  inquiry form embedded on a different domain and posting to a Mallok site
  stops working; a form on the site itself is unaffected.
- Themes may declare `pluginLayouts`.

## 6. Not done / known limits

- **The fallback page is not a usable page.** A site that uses a plugin with
  pages needs a theme that provides their layouts. If plugins should be able
  to bring a fallback template of their own, that is a further task and an
  owner decision.
- **The admin's warning was checked through the API, not in a browser.** The
  default composition has no plugin with pages, so the browser suite never
  shows it.
- No real browser exercised the cross-site check; the headers were set by
  the tests. That browsers send `Sec-Fetch-Site` on form posts is their
  documented behaviour, not something run here.
- A layout name is not checked against any plugin: a theme can declare a
  layout nothing asks for, and a typo shows up only as the fallback.
- A plugin page costs whatever the plugin's handler costs; nothing bounds
  its D1 calls or CPU.
