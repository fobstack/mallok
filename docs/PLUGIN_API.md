# The Mallok plugin API

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: the only contract a plugin has. Official and third-party plugins
  use the same mechanism; there is no private interface. The boundaries
  described here must match the wording in the admin interface — **nothing may
  imply a sandbox exists**.

## 1. In one sentence

**A plugin is real JavaScript or TypeScript that reaches five hooks and seven
capabilities through a declarative `plugin.json`. It runs in the user's own
Cloudflare account with the Worker's full permissions.** Plugin API 2 adds
optional hooks and capabilities on top of these (§13).

## 2. The honest boundary (which the interface must state as-is)

**Official and third-party plugins take the same path**: source into
`src/plugins/`, bundled into the Worker at build time. The only difference is
who wrote it and who is responsible for it.

| Action | How it takes effect | Who does it |
| --- | --- | --- |
| Install, update or remove a plugin | Edit source, redeploy | Someone technical |
| Enable or disable an installed plugin | A switch in the admin, **immediate** | The operator |
| Change settings and secrets | A form in the admin, **immediate** | The operator |

The switch decides only whether the code runs; it does not change what code is
in the artifact. That is why it can be immediate, and it is what separates it
from installing.

**The interface must not make installing a plugin look like a single click** —
it cannot be, and pretending otherwise is exposed the first time a user tries.
The correct interface tells the user that source must change and a build must
run, and gives them the steps.

### 2.1 Security model

A plugin is **trusted code** (`ARCHITECTURE §14`). It can read and write the
entire database, call any external service, and read every secret. **There is
no sandbox, and there will not be one.** The risk boundary is the same as a
WordPress plugin's: the user is responsible for what they install.

The documentation and the interface must say this outright. Concealing it is
more dangerous than the absence of a sandbox.

## 2.2 `definePlugin`, and what it refuses

A plugin is built by calling `definePlugin` once, at module scope, and
exporting the result:

```ts
import { definePlugin } from 'mallok/worker';
import manifest from './plugin.json';

export default definePlugin({ manifest, hooks: { … }, routes: { … } });
```

It exists because the runtime reads `manifest.hooks` and `manifest.settings`
directly. Mallok's own plugins are fine — their manifests come from
`plugin.json` through a schema that supplies every default — but both fields
are **optional** in the format below, so a hand-written manifest made the
runtime throw `Cannot read properties of undefined` on a visitor request,
from inside Mallok, naming nothing the author could act on. `definePlugin`
runs the same schema, so a hand-written object and a parsed file end up
identical.

It then checks the two halves against each other, and refuses:

| What | Why it is worth failing a build over |
| --- | --- |
| A hook the manifest declares with no implementation | The runtime calls what the manifest lists, so it does nothing — silently, on every request |
| An implemented hook the manifest does not declare | It never runs, and its author has no way to tell |
| The same, for routes | A declared route with no handler answers 500; an undeclared one is never mounted |
| A hook name that is not one of the five | Named in the message, because zod's own error lists the allowed options and not the offending value |
| Anything the manifest schema rejects | An id that cannot form a table prefix, a settings field of an unknown type, a panel table without the plugin's `p_<id>_` prefix |

Every refusal names the plugin. `definePlugin` runs when the Worker module is
initialised; a bad plugin therefore prevents that Worker from initialising,
rather than turning into a later plugin-route failure. A bundler that only
transforms modules does not execute it, so Mallok's package gate also imports
and executes the built artifact.

Refusals are `PluginDefinitionError`, which carries a `hint` alongside its
message.

## 3. Package structure

```text
src/plugins/inquiry/
├── plugin.json           # declares hooks, routes, settings, secrets, panels, injected client JS
├── migrations/
│   └── 0001_inquiry.sql  # table names must start with p_inquiry_
├── emails/               # optional: email templates (Liquid, through the same restricted engine)
│   ├── notify.en.liquid
│   └── autoreply.en.liquid
└── index.ts              # the implementation; exports only what plugin.json declares
```

## 4. `plugin.json`

```jsonc
{
  "id": "inquiry",                   // [a-z][a-z0-9-]*; also the table prefix and the route prefix
  "name": "Inquiry form",
  "version": "1.0.0",
  "description": "Product inquiry form with spam protection and email delivery.",
  "pluginApi": 1,                    // the version of this contract

  "hooks": ["afterRender", "onContentSave", "scheduled"],

  "routes": [
    {
      "path": "submit",              // actually /_mallok/p/inquiry/submit
      "method": "POST",
      "turnstile": true,             // the core performs the server-side siteverify
      "rateLimit": true              // a site binding; key is plugin id + route + IP (§7.2)
    }
  ],

  "settings": {                      // stored in cleartext in plugin_state.settings
    "recipient":     { "type": "string",  "label": "Recipient email", "required": true },
    "from_address":  { "type": "string",  "label": "From address" },  // optional; §7.6
    "autoreply":     { "type": "boolean", "label": "Send auto-reply", "default": true },
    "block_countries": { "type": "string[]", "label": "Blocked countries" }
  },

  "secrets": {                       // AES-GCM encrypted into plugin_state.secrets
    "turnstile_secret": { "label": "Turnstile secret key" }
  },

  "panels": [ /* §7.5 */ ],

  "affectsFragmentCache": false,     // see §9
  "clientScripts": [
    { "src": "https://challenges.cloudflare.com/turnstile/v0/api.js",
      "purpose": "Turnstile bot protection", "bytes": 0 }
  ]
}
```

Unknown fields are rejected at every manifest level; they are never silently
discarded. Migrations and executable handlers live beside the manifest in the
object passed to `definePlugin`, because JSON cannot contain code.

`official` is deliberately not a manifest field. Mallok marks the plugin it
ships through an internal registry that is not exported from `mallok/worker`.
A third-party manifest containing `"official": true` is rejected instead of
receiving an origin badge it can award itself.

The field types in `settings` match the table in `THEME_FORMAT.md §5.2`,
excluding `image`, `file` and `reference`. Validation uses zod, with the
schema generated from `plugin.json`.

## 5. Hooks

0.1 exposes five (`ARCHITECTURE §12`); plugin API 2 adds `renderData` and
`onContentDelete`.
Implementations are properties of the `hooks` object passed to `definePlugin`.

| Hook | When | Whose CPU it costs | Typical use |
| --- | --- | --- | --- |
| `onRequest` | A request arrives, **before the cache lookup** | The visitor request | Redirects, access control |
| `beforeRender` | Stage one, once the mdast exists | **The save request** | Shortcodes, custom syntax |
| `afterRender` | After the complete HTML is generated | The visitor request, on a cache miss | Injecting meta, structured data, form markup |
| `onContentSave` | When content is saved | The save request | Validation, auto-summaries, notifying something external |
| `scheduled` | Inside the once-a-minute cron | The cron invocation | Retries, syncing, cleanup |
| `onContentDelete` (API 2) | After content has been deleted | The delete request | Removing what the plugin kept for that content |
| `renderData` (API 2) | While a page is rendered, **on a cache miss only** | The visitor request, on a cache miss | Data from the plugin's tables that templates print: prices, availability |

### 5.1 `onRequest`

```ts
export async function onRequest(
  request: Request,
  ctx: PluginRequestContext,
): Promise<Response | undefined>;
```

Returning a `Response` short-circuits the request; returning `undefined`
continues. **It runs before the cache lookup, so every visitor request pays
its CPU cost** — including the ones the cache would otherwise have answered
directly. Writing something heavy here destroys the design goal that a cache
hit costs almost nothing (`ARCHITECTURE §2`). The admin must say so when a
plugin declaring `onRequest` is enabled.

### 5.2 `beforeRender`

```ts
import type { Root as MdastRoot } from 'mdast';

export function beforeRender(
  tree: MdastRoot,
  ctx: { readonly frontmatter: Readonly<Record<string, unknown>> },
): void | Promise<void>;
```

The signature is `BeforeRenderHook` in `src/core/fragment.ts`. It operates on
**mdast**, remark's AST — the only reason unified was chosen over `marked` or
`markdown-it` (`TECH_STACK §4`).

**It must be pure**: no input beyond the AST, the front matter and the
plugin's settings. It may not read the clock, a random source, anything about
the request, or the database. The reason is the determinism rule in
`ARCHITECTURE §5` — identical input must produce byte-identical HTML, or
neither the fragment cache nor the regression tests hold.

> **Contract-version warning**: `beforeRender`'s parameter type is bound to
> remark's mdast. Should the core ever change Markdown engine (the open
> decision in `TASK-01 §6`), this signature necessarily breaks, and
> `pluginApi` must go to a new version rather than degrade silently — 3, since
> 2 is the additive version in §13. 0.1 defines the contract against unified
> and mdast.

### 5.3 `afterRender`

```ts
export async function afterRender(
  html: string,
  ctx: PluginRenderContext,
): Promise<string>;
```

Receives the complete page HTML and returns modified HTML. **The plugin is
responsible for escaping what it injects** — the core's sanitisation happened
in stage one and is already past. A plugin is trusted code, so this is its
job, but the documentation has to say so plainly.

### 5.4 `onContentSave`

```ts
export async function onContentSave(
  content: ContentDraft,
  ctx: PluginContext,
): Promise<{ readonly markdown?: string } | void>;
```

Returning a replacement `markdown` adopts that value; all other draft fields
remain owned by Mallok. Returning `void` changes nothing.
Throwing fails the save and returns the error to the caller — **that is the
legitimate way for a plugin to refuse a save**, and it is better than
rewriting silently.

**It is called on every save**: the admin's editor, `mallok publish` and
`mallok import`, a starter's content at setup — they all go through
`POST /_mallok/api/content`, and that is where the hook runs. (Until
`0.1.0-rc.9` this hook was documented and never called.) The draft is what
was submitted:

```ts
interface ContentDraft {
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly title: string;
  readonly markdown: string;                       // front matter included
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly status: string;                         // draft | scheduled | published, as requested
}
```

The order on the save path, which decides what a hook can rely on:

1. The submitted Markdown is parsed; its kind, locale, slug and title are
   settled. **A hook cannot change those**: the slug and locale are the
   item's identity, and they are taken from what was submitted even when a
   hook rewrites the front matter.
2. **The hooks run**, in the order the site lists its plugins, each receiving
   the Markdown the one before it returned.
3. The result is parsed again. It must still be a document that can be saved
   — front matter with a title, within the size limit — or the save fails
   with 422 and nothing is stored.
4. The length safety net applies **to the result**: a hook that makes a body
   too long to render safely gets the item saved as a draft, like any other
   over-long item (`ARCHITECTURE §5`).
5. **The result is compared with what is stored.** If nothing would change,
   the save answers `unchanged` and writes nothing.
6. Stage one renders the result, and the result is what is stored.

Three things follow:

- **A hook must be idempotent**: given its own output, it returns it
  unchanged; given the same input, it returns the same output. Step 5 is what
  keeps a second `mallok publish` of the same file a no-op, and it only works
  if the hook gives the same answer twice. A hook that stamps a timestamp
  makes every publish a change.
- **What is stored is what the hook returned**, so an export contains it and
  the file in the author's repository does not. A hook that rewrites
  Markdown is changing the author's source of truth; prefer refusing.
- A refusal is answered **422** with `{ "error": <the message thrown>,
  "rejectedBy": <plugin id> }`, shown as it is by the admin and by
  `mallok publish`. Nothing is written and later hooks do not run. Write the
  message for the person saving.

**The hook's time is the save request's time.** A save already runs stage
one, which is the most expensive thing Mallok does; a hook that makes a
network call or a slow query can push a save past the platform's CPU limit,
where it is killed without an error the caller can read. Validate, look
something up in your own table, and return.

A draft has no id: a new item does not have one until it is stored. To keep
a plugin's own rows in step with content, key them by `kind`, `locale` and
`slug`, or attach them later (§7.5, Task 29).

### 5.5 `scheduled`

```ts
export async function scheduled(ctx: PluginContext): Promise<void>;
```

Runs inside the site's single cron (`* * * * *`). Every plugin's `scheduled`
**shares one invocation's 10 ms CPU budget** on the free plan. A plugin must
therefore batch its own work: do a little, leave the rest for the next minute,
and do not try to finish everything at once.

### 5.6 `renderData`

```ts
export async function renderData(
  ctx: PluginRenderDataContext,
): Promise<Readonly<Record<string, unknown>> | undefined>;
```

Plugin API 2; the manifest must declare `"pluginApi": 2` and list
`renderData` in `hooks`. It is the only hook on the render path that may read
the database, and it exists so that what a plugin stores — a price, an
availability state — is **in the cached HTML**, not fetched by the browser.

**When it runs.** Once per rendered page: a content page, a kind's list, a tag
archive, the home page. Never on a cache hit, never for a 404, and never in
`mallok build` or the admin's preview, which run no plugin code — there
`plugins` is empty. The hooks of all plugins run concurrently, alongside the
core's own second round trip.

**What it returns.** An object, or `undefined` for "nothing on this page".
The core passes it through `JSON.stringify`, so it must be JSON-serialisable:
a function is dropped, and a cycle or a `BigInt` fails the hook. Templates
read it as `plugins.<plugin_id>` — the plugin's id with hyphens written as
underscores, as in its table prefix (`THEME_FORMAT.md §7.9`). The core does
not rename keys; use `snake_case`, as the rest of the view does. **Return
values ready to display** — a price already formatted for `ctx.locale` — since
a plugin cannot register Liquid filters (§12). Strings are HTML-escaped by the
template engine like any other value.

**Structured data.** One key of the result is not for templates:
`structuredData`. It holds properties for the JSON-LD node the core already
emits for the page, so that a price a plugin puts on the page is in the
page's structured data too:

```ts
return {
  price: '$99.00',
  structuredData: {
    offers: { '@type': 'Offer', price: '99.00', priceCurrency: 'USD',
              availability: 'https://schema.org/InStock' },
  },
};
```

The core merges them into its own node and emits **one node**, through the
same serialisation and the same escaping as before (`SEO_PERFORMANCE.md §5`).
This is the only way in: a theme template may not contain an inline
`<script>`, a JSON-LD data block included, whether or not it declares
`clientScripts` (`THEME_FORMAT.md §9`). The rules:

- **An allow-list per node type decides what may be added.** Today it has one
  entry: `offers` on a `Product` node, which is what a content page of the
  `product` kind gets. Nothing may be added to an `Article`, `FAQPage` or the
  home page's node, and a page with no node — a plain page, a list, a tag
  archive — gets none from a plugin.
- **The core's own properties are never replaced**: `@context`, `@type`,
  `name`, `url` and whatever else the core set on that node.
- When two plugins offer the same property, the first in the site's plugin
  order keeps it.
- Every property that is not used is logged:
  `{"event":"structured_data_dropped","plugin":…,"key":…,"reason":…,"path":…}`
  with the reason `not_allowed`, `core_key`, `already_set`, `no_node`, or
  `not_object` when `structuredData` itself is not an object. Dropping is not
  a failure: the page is exactly what the core alone would have produced, and
  it is cached.
- `structuredData` is removed before the result reaches templates; there is
  no `plugins.<id>.structuredData`.
- **Offer only what the page shows** — the same price, in the same currency,
  and an availability the page prints. Search engines penalise structured
  data that says more than the page (`SEO_PERFORMANCE.md §5`), and the
  allow-list cannot check that for you.

**What it costs, and the limits that follow.** A cold render may make four D1
round trips (`ARCHITECTURE §4`) and the core uses two. So:

- **One database call per hook per render**: one query, or one `batch`. The
  `ctx.db` the hook receives counts calls and refuses a second. On a list or
  home page `ctx.items` holds every item shown, so one `IN (…)` query covers
  the page.
- **At most two plugins run `renderData` on a page.** They are the first two
  enabled plugins that implement it, in the order the site lists its plugins
  in `createMallok`. A further one is skipped, and
  `{"event":"render_data_skipped"}` is logged with its id; the page is
  otherwise normal and is cached.

**Read-only.** `ctx.db` accepts a single statement that starts with `SELECT`,
or with `WITH` and contains no `INSERT`, `UPDATE` or `DELETE`. Anything else
is refused before it reaches D1, as are `exec`, `dump`, `withSession` and a
statement prepared on another binding. **The check is by keyword, not by
parsing SQL**: it catches a mistake, it is not a sandbox (§2.1), and it can
refuse a legitimate query that spells one of those words or a `;` inside a
string literal — bind the value as a parameter instead.

**Deterministic.** The result may depend only on the database and on the
context below: not on the clock, a random source or anything about the
request, none of which the hook is given. The page is stored in the edge cache
and served to everyone, and identical database state must give identical
bytes.

**When it fails.** A hook that throws, makes a second call, attempts a write
or returns something that is not an object loses its own data and nothing
else: the page renders, the other plugins' data is present,
`{"event":"render_data_failed","plugin":…,"path":…,"reason":…}` is logged, and
**that response is not stored in the edge cache** (`cache-control: no-store`),
so the next request tries again. A hook that catches the refusal of its
second call and carries on is treated as failed all the same. A template must
therefore read `plugins.<id>` as optional.

**Freshness.** What the hook read is cached with the page. A later change in
the plugin's tables reaches visitors when that page's cache entry is purged or
expires. So the hook says what the page depends on, in a second reserved key:

```ts
return {
  price: '$99.00',
  cacheTags: [`product-${ctx.content.id}`],
};
```

Each tag is added to the page's `Cache-Tag` as `p:<plugin-id>:<tag>`, and the
route or action that changes the data calls
`ctx.purgeTags(['product-…'])` with the same short name (§9). Like
`structuredData`, `cacheTags` is removed before the result reaches templates.

### 5.7 `onContentDelete`

```ts
export async function onContentDelete(
  ref: ContentDeleteRef,
  ctx: PluginContext,
): Promise<void>;

interface ContentDeleteRef {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly translationGroup: string;
  readonly lastInGroup: boolean;
}
```

Plugin API 2. Called **after** content has been deleted through
`DELETE /_mallok/api/content/<id>`, so that a plugin can remove what it kept
for it — a product's variants and prices, say.

- **`lastInGroup`** is true when no other language of the item is left. One
  language of a product being deleted usually means "that translation is
  gone"; the last one means "the product is gone". Rows a plugin keys by
  `translationGroup` belong to the second case.
- **It cannot refuse the delete, and a failure does not undo it.** The
  content is already gone when the hook runs. A hook that throws is logged
  as `{"event":"content_delete_hook_failed",…}`, the other plugins' hooks
  still run, and the response carries `"hookFailed": [<plugin ids>]` so that
  whoever deleted the item knows a plugin's cleanup did not finish. Make the
  cleanup safe to repeat, and let `scheduled` sweep up what was missed.
- It is not called when content is unpublished or made a draft — that is a
  save, and `onContentSave` sees the new `status` — nor when a plugin is
  switched off at the time; a plugin that is later switched on finds no
  record of deletions it missed.
- Like a save hook, its time is the request's time. Delete rows; do not call
  out.

## 6. The context objects

All of these are exported from `mallok/worker`, so a third-party plugin
annotates its own handlers with the same types the official one uses:
`PluginContext`, `PluginRequestContext`, `PluginRenderContext`,
`PluginRenderDataContext`, `ContentDraft`, `ContentDeleteRef`, `RouteInput`, `PluginPageResult`,
`PluginRecordInput`, `PluginRecordHandlers`, `MoneyValue`, `EmailMessage`, `PluginSiteSettings`,
`PluginExportFile` and `PluginMigration`, plus `MallokPlugin` and
`PluginInput`. There is no private interface (§1), and before 0.1.0-rc.5 the
package exported only `MallokPlugin` with an opaque
manifest — enough to *name* a plugin and not enough to write one.


```ts
interface PluginContext {
  readonly db: D1Database;
  readonly media: R2Bucket;
  /** This plugin's values in plugin_state.settings, validated against the schema. */
  readonly settings: Readonly<Record<string, unknown>>;
  /** Decrypted secrets. Never logged, never returned to a client. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly site: SiteSettings;
  /** Provided by the core, see §7.6. */
  readonly sendEmail: (message: EmailMessage) => Promise<string>;
  /** Purge this plugin's own cache tags, or `site`; coalesced. See §9. */
  readonly purgeTags: (tags: readonly string[]) => Promise<unknown>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}
```

```ts
interface PluginRenderDataContext {
  /** One call per render, reads only (§5.6). Not the plain binding. */
  readonly db: D1Database;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly site: SiteSettings;
  readonly locale: string;
  readonly path: string;
  /** Content pages: the item being rendered. Home and list pages: null. */
  readonly content: {
    readonly id: string;
    readonly kind: string;
    readonly translationGroup: string;
    readonly frontmatter: Readonly<Record<string, unknown>>;
  } | null;
  /** Home and list pages: the items shown on this page. Empty on a content page. */
  readonly items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly translationGroup: string;
  }[];
}
```

`PluginRenderDataContext` has no secrets, no `media`, no `sendEmail` and no
request: it runs on the visitor path and its output is public and cached.

`PluginRequestContext` adds `request`, `url`, `locale`, `country` and the
one-way `ipHash`. For a route, `locale` is the request's locale segment when
there is one and the site default otherwise (§7.2); for `onRequest` it is the
site default. `PluginRenderContext` contains `settings`, `site`, `locale`,
`path` and the optional `{ id, kind }` content identity. It deliberately has
neither secrets nor database access.

**`ctx.db` is the full D1 binding** — a plugin can read and write any table.
The core enforces no table-level isolation, because that would offer a false
sense of security. The convention is: a plugin touches only its own
`p_<id>_`-prefixed tables, may read core tables, and needs a good reason to
write to one.

## 7. The seven capabilities

### 7.1 Tables

A plugin brings its own SQL migrations. **Table names must start with
`p_<plugin_id>_`** and migration ids with `plugin:<plugin_id>:`
(`DATA_MODEL §2.11`). The core's migrator runs them alongside the core
migrations, records them in the same `migration` table, and shares the same
`migration_lock`.

The `migrations` array is executable plugin input, not manifest JSON.
`definePlugin` rejects malformed entries, ids outside that prefix and
duplicate ids before the composition is installed.

The migration rules are the core's (`DATA_MODEL §2.10`): **additive changes
only** — new tables, new columns with defaults, new indexes. Dropping a column
or changing its meaning within one version is not allowed, because the old
Worker version is still serving during the migration.

Disabling or removing a plugin from the build **does not drop its tables**.
0.1 has no automated plugin-data deletion flow; removal leaves that data in
D1 unless an operator performs a separate, deliberate migration.

### 7.2 Routes

`/_mallok/p/<plugin_id>/<path>`, declared in `plugin.json`'s `routes`. The
core handles:

- matching the path, its parameters and its locale segment (below);
- body parsing (`application/json` and `application/x-www-form-urlencoded`);
- the server-side Turnstile `siteverify`, when `turnstile: true`;
- rate limiting, through the `RATE_LIMITER` Workers binding.

```ts
export const routes = {
  async submit(input: SubmitInput, ctx: PluginRequestContext): Promise<Response> { … },
};
```

**Paths (plugin API 2).** A path is one to six segments separated by `/`.
Each is a name (`orders`: lowercase letters, digits and hyphens, starting
with a letter) or a parameter (`:orderNo`: letters and digits); the first is
always a name.

```json
"routes": [
  { "path": "cart",            "method": "GET" },
  { "path": "orders/new",      "method": "GET" },
  { "path": "orders/:orderNo", "method": "GET" }
]
```

```ts
export const routes = {
  'orders/:orderNo': async (input: RouteInput, ctx: PluginRequestContext) => {
    const order = await findOrder(ctx.db, input.params.orderNo);
    …
  },
};
```

- A handler is keyed by the path exactly as declared.
- `input.params` holds what each parameter captured, percent-decoded. A
  segment that is not valid encoding, is empty, is longer than 200
  characters, or decodes to `.`, `..` or something containing `/` matches no
  route: the answer is 404. **A parameter is otherwise unvalidated text from
  the visitor** — bind it, never splice it into SQL or HTML.
- A name beats a parameter in the same position, so `orders/new` is not
  taken for an order number; between routes equally specific, the first
  declared wins. Two routes that would match the same requests
  (`orders/:orderNo` and `orders/:id`) are refused at build time.
- A doubled or trailing slash matches nothing.

**The locale segment (plugin API 2).** In
`/_mallok/p/<plugin_id>/<locale>/<path>`, a first segment that is one of the
site's enabled locales is the request's locale: it sets `ctx.locale` and is
not part of the path. `/_mallok/p/shop/de/cart` and `/_mallok/p/shop/cart`
are the same route `cart`, with `ctx.locale` `de` and the site default. Any
other first segment is part of the path, so `/_mallok/p/shop/fr/cart` on a
site without `fr` is a 404, not `cart` in the default language. The locale
sits after the plugin id, not before `/_mallok`, so that a plugin can scope a
cookie to `/_mallok/p/<plugin_id>` and reach every language with it.

A site's locales are settings and can change after a build. So that a route
can never be hidden by a locale added later, **a version 2 route may not
start with a segment shaped like a locale code** — two letters, optionally
followed by `-` and two to four more. `de`, `go` and `my-cart` are refused at
build time; `cart`, `checkout` and `my-orders` are fine. Only the first
segment is affected.

**A plugin declaring `"pluginApi": 1` is routed as before**: one segment,
matched literally, with `ctx.locale` always the site default, and its route
names are not checked against the locale shape. Declaring several segments
or a parameter under version 1 is refused at build time.

**Bodies.** `input.fields` holds form fields, or the string-valued top-level
members of a JSON object, as in version 1. `input.json` is the body of an
`application/json` request, whole — numbers, booleans, `null`, arrays and
nested objects included — and `undefined` for a form or a GET. A JSON body
must be an object or an array; anything else is answered 400 before the
handler runs. Neither is validated beyond that: the handler checks what it
reads.

The route handler validates its own parsed fields.

**Rate limiting.** A route asks for one of two tiers, each a Workers
rate-limit binding in the site's `wrangler.jsonc`:

| `rateLimit` | Binding | In the site template |
| --- | --- | --- |
| `"strict"`, or `true` | `RATE_LIMITER` | 10 requests per 60 seconds |
| `"relaxed"` (plugin API 2) | `RATE_LIMITER_RELAXED` | 120 requests per 60 seconds |
| `false`, or omitted | none | — |

- **The numbers belong to the site, not to the plugin.** A manifest names a
  tier; the limit and period are in `wrangler.jsonc`, where the site's owner
  can change them and the runtime can enforce them. Pick `strict` for an
  action that costs something each time it succeeds — a form that sends
  email, a checkout — and `relaxed` for one a visitor repeats in normal use,
  such as changing a cart.
- **Each route has its own count per visitor.** The key is
  `<plugin-id>:<route path as declared>:<connecting-ip>`, so two routes never
  share a budget even on the same tier, and `orders/:orderNo` is one budget
  whatever order number is tried. The locale segment is not part of the key.
- **A site without `RATE_LIMITER_RELAXED`** — one created before the tier
  existed, until its owner adds the binding (`CLOUDFLARE_RESOURCES.md §4`) —
  guards a `relaxed` route with `RATE_LIMITER` instead and logs
  `{"event":"rate_limit_binding_missing",…}`: tighter than asked for, never
  unguarded. With no rate-limit binding at all, requests proceed, as before.
- **What a binding can express** (Cloudflare's rate-limit binding
  documentation, read 2026-10-05): the period is 10 or 60 seconds, nothing
  longer, so "ten per ten minutes" cannot be configured. Counting is, in
  Cloudflare's words, permissive and eventually consistent, kept per
  Cloudflare location, and Cloudflare advises against keying on IP
  addresses — which an anonymous form has nothing better than. **It is
  best-effort abuse control and must not back billing, stock or any exact
  quota**; a plugin that needs an exact limit counts in its own table.
- A refused request is answered 429 before the body is read or the handler
  runs.

**Pages (plugin API 2).** A route that declares `"render": "page"` and a
`layout` is a page of the site: its handler returns a view, and the theme's
layout of that name renders it inside the site's own header, navigation and
language switcher. **The plugin owns the route and the data; the theme owns
the look.**

```json
{ "path": "cart",     "method": "GET",  "render": "page", "layout": "shop/cart" },
{ "path": "cart/add", "method": "POST", "render": "page", "layout": "shop/cart" }
```

```ts
export const routes = {
  cart: async (_input: RouteInput, ctx: PluginRequestContext) => ({
    title: 'Your cart',
    view: { lines: await readCart(ctx), total: '$248.00' },
  }),
  'cart/add': async (input: RouteInput, ctx: PluginRequestContext) => {
    const problem = await addToCart(ctx, input.fields);
    if (problem !== null) {
      return { status: 422, view: { error: problem } };
    }
    return new Response(null, { status: 303, headers: { location: '/_mallok/p/shop/cart' } });
  },
};
```

- The handler returns a `PluginPageResult` — `{ view, title?, description?,
  status?, headers? }` — or a `Response`, which is passed through unchanged;
  that is how a POST redirects. `view` must be JSON-serialisable, like a
  `renderData` result, and reaches the layout as `plugin_page`
  (`THEME_FORMAT.md §16`). `headers` is for `set-cookie` and the like.
- **The page is private and unindexed, always**: `Cache-Control: private,
  no-store` and `X-Robots-Tag: noindex`, whatever the handler sets.
  `/_mallok/` is disallowed in `robots.txt` as well. It is one visitor's
  cart, rendered per request; nothing about it is cacheable.
- The layout sees the same view a content page does — `site`, `t`, `theme`,
  `page` — with `page.kind` `plugin` and `page.alternates` pointing at the
  same page under each of the site's locales (the locale segment above), so
  the theme's language switcher works. `page.head` is empty and
  `renderData` hooks do not run: the page is the plugin's own.
- **The layout name is a contract between a plugin and a theme**, not with
  the core: `shop/cart` means whatever the plugin's documentation says the
  view under it contains. **A theme that does not provide it** leaves the
  page to a plain built-in layout that names what is missing and lists the
  view's top-level text, number and boolean values — enough to see the route
  work, not a usable page. `{"event":"plugin_layout_missing",…}` is logged
  per request and the admin's plugin page lists the layouts the theme lacks.
- A page route returning something that is neither a view nor a `Response`,
  or a plain route returning a view, is answered 500 with
  `{"event":"plugin_route_bad_result",…}` in the log.
- `afterRender` hooks do not run on a plugin page.

**The cross-site check, for every plugin.** A `POST` to any plugin route is
refused with 403 when the browser says another site caused it: when
`Sec-Fetch-Site` is `cross-site`, or — for a browser that sends no such
header — when `Origin` names a host other than the one requested.
`same-origin`, `same-site` and `none` pass. **A request with neither header
passes**: no current browser sends a form or a `fetch` POST without one, so
it comes from a script or a server, which carries no visitor's cookies and
gains nothing by forging one. A `GET` is never checked — a link from an order
email or another site has to work — so **a handler must not change state on
`GET`**. The check runs before rate limiting, body parsing and the handler.
This is what lets a page route trust a session cookie scoped to
`/_mallok/p/<plugin_id>`; it does not replace Turnstile for a public form.

**Raw bodies (plugin API 2).** A route that declares `"body": "raw"` is for a
webhook: another server calls it and proves who it is with a signature over
the bytes of the body. Parsing those bytes first would destroy what the
signature is over.

```json
{ "path": "stripe-webhook", "method": "POST", "body": "raw" }
```

```ts
'stripe-webhook': async (_input, ctx) => {
  const payload = await ctx.request.text();          // exactly what was sent
  if (!(await verify(payload, ctx.request.headers.get('stripe-signature'), ctx.secrets.signing_secret))) {
    return new Response('bad signature', { status: 400 });
  }
  ctx.waitUntil(followUp(ctx, payload));
  return new Response(null, { status: 200 });
},
```

- **`ctx.request` carries the bytes as they arrived**, readable once, as text
  or as a buffer. `input.fields` is empty and `input.json` is `undefined`:
  the core parsed nothing.
- **The handler's status code is passed through unchanged.** A sender such as
  Stripe decides from it whether to deliver again — 2xx is delivered, anything
  else is retried — so answer 400 for a signature that does not verify and
  5xx for a failure worth retrying. A handler that throws answers 500.
- **No cross-site check.** It is not a browser calling. **The signature is
  the only authentication**: a raw route that does not verify one is open to
  anyone.
- **A size cap.** 256 KiB unless the route declares `maxBytes`, up to 1 MiB;
  a larger body is answered 413 before the handler runs, and a stream of
  unknown length is cut off as it is read. Stripe's documentation states no
  maximum event size (read 2026-10-06), so the default is a judgement, not a
  figure from the sender; raise it for a route that receives large events.
- It cannot use Turnstile or be a page route, and both are refused at build
  time. `rateLimit` is as declared: leave it out for a sender that delivers
  from a few addresses.
- Secrets, `ctx.db` and `ctx.waitUntil` are as for any route.

Every plugin-route response is rewritten to `Cache-Control: private,
no-store`; `Cloudflare-CDN-Cache-Control`, `CDN-Cache-Control` and
`Surrogate-Control` are all forced to `no-store`, and any `Cache-Tag` supplied
by a handler is removed. Route caching is not part of the 0.1 contract.

### 7.3 Settings and secrets

- `settings`: stored in cleartext in `plugin_state.settings`; the admin
  generates the form from the schema.
- `secrets`: **AES-GCM** encrypted with a key derived from `MALLOK_SECRET`
  through HKDF and stored in `plugin_state.secrets`, with a fresh random IV on
  every write (`DATA_MODEL §2.7`).
- A plugin may declare `checkSecrets` (added 2026-08-30): a read-only
  validation function per secret name, behind a "Test" button next to the
  secret in the admin. **The core cannot tell a good third-party key from a
  bad one; the plugin can.** The check must be read-only or safe to repeat, and
  **only the verdict is returned — the secret value never leaves the Worker.**

**The management API returns only "set" or "not set", and never echoes a
secret value.** Rotation is supported: writing a new value overwrites.
`SECURITY.md` defines the derivation and encoding.

### 7.4 Scheduled work

The `scheduled` hook runs from Mallok's single once-a-minute trigger. 0.1 does
not expose a generic `enqueue` capability: there is no public consumer and
retry protocol for arbitrary plugin jobs. A plugin needing durable state owns
its own `p_<id>_` table and advances a bounded batch from `scheduled`.

### 7.5 Declarative admin panels

**A plugin ships no frontend code.** It declares a panel and the admin app
renders it.

```jsonc
"panels": [
  {
    "id": "inquiries",
    "label": "Inquiries",
    "type": "table",
    "table": "p_inquiry_inquiry",
    "columns": [
      { "field": "created_at", "label": "Received", "type": "datetime" },
      { "field": "name",       "label": "Name" },
      { "field": "email",      "label": "Email",   "type": "email" },
      { "field": "country",    "label": "Country" },
      { "field": "status",     "label": "Status",  "type": "badge" }
    ],
    "filters": [
      "status",
      "created_at"
    ],
    "detail": ["message", "company", "phone", "source_path", "user_agent"],
    "actions": [
      { "id": "mark_replied", "label": "Mark replied" },
      { "id": "mark_spam",    "label": "Mark spam" },
      { "id": "export_csv",   "label": "Export CSV", "type": "download" }
    ]
  }
]
```

Ids declared in `actions` correspond to keys in the implementation passed to
`definePlugin`:

```ts
export const actions = {
  async mark_replied(ids: readonly string[], ctx: PluginContext): Promise<Response | undefined> { … },
  async export_csv(ids: readonly string[], ctx: PluginContext): Promise<Response> { … },
};
```

Action ids are unique across the whole plugin, because the implementation map
is plugin-wide even when the declarations appear in different panels.

Scopes, for API tokens (a signed-in session holds every scope):

| Request | Scope |
| --- | --- |
| Reading a panel's rows | `export` — panel rows are plugin business data, guarded like the site export |
| A `download` action | `export` |
| Any other action | `content:write` |

**Sorting and search (plugin API 2).** Both are declared, and both apply to
either type of panel:

```jsonc
"columns": [
  { "field": "name", "label": "Name", "sortable": true },
  { "field": "code", "label": "Code", "sortable": true }
],
"search": ["name", "code"]
```

- A `sortable` column's heading orders the list by it, ascending then
  descending. The list request carries `sort=<field>&dir=asc|desc`; **a field
  the manifest does not mark sortable is ignored**, and the panel's `orderBy`
  applies. Field names never come from the request.
- `search` adds a search box. The request's `q` is matched as a substring
  against each listed column, case-insensitively for ASCII (SQLite's `LIKE`),
  with `%` and `_` taken literally. It is a scan of the table, not an index:
  fine for hundreds of rows, not a search engine.

**Editable records (plugin API 2).** A panel of `"type": "records"` is a
list with a form: the admin can create, edit and — if the plugin allows —
delete what it lists.

```jsonc
{
  "id": "variants",
  "label": "Variants",
  "type": "records",
  "table": "p_shop_variant",
  "columns": [{ "field": "sku", "label": "SKU", "sortable": true }],
  "search": ["sku"],
  "fields": {
    "sku":    { "type": "string", "label": "SKU", "required": true },
    "status": { "type": "select", "label": "Status", "choices": ["active", "archived"] },
    "price":  { "type": "money",  "label": "Price", "currencies": ["USD", "EUR"] },
    "tiers":  {
      "type": "rows", "label": "Quantity prices", "max": 10,
      "fields": {
        "from":  { "type": "number", "label": "From quantity", "min": 1, "required": true },
        "price": { "type": "money",  "label": "Unit price", "currencies": ["USD", "EUR"] }
      }
    }
  }
}
```

```ts
export const records = {
  variants: {
    load: async (id: string, ctx: PluginContext) => { … },          // the record, or null
    save: async (record: PluginRecordInput, ctx: PluginContext) => { … },
    remove: async (id: string, ctx: PluginContext) => { … },         // optional
  },
};
```

- **The admin never writes to a plugin's table.** The list is still read from
  `table`, as for a `table` panel, and its rows need an `id` column. Opening
  a record calls `load`; saving calls `save`; deleting calls `remove`. How a
  record maps onto tables — one row, or a parent and its children — is the
  plugin's business, which is why `load` is the plugin's too.
- **Field types** are the settings vocabulary — `string`, `text`, `number`,
  `boolean`, `date`, `select`, `string[]`, `color`, `keyvalue` — and two
  more:
  - **`money`**: `{ "amount": 9900, "currency": "USD" }`. `amount` is a whole
    number of the currency's **minor units** — cents — never a decimal, so
    nothing is lost to floating point. `currencies` lists the ISO 4217 codes
    allowed. The form shows and takes `99.00`, and converts using the
    currency's own number of decimal places. Negative amounts need a `min`
    below zero.
  - **`rows`**: an array of objects, each with the declared sub-fields —
    variants under a product, lines under an order. `max` bounds the number
    of rows (50 when absent). A row's fields are scalar; rows do not nest.
- **What `save` receives is already checked** against the declaration:
  required fields are present, a `select` holds a listed choice, a number is
  in range, money is whole minor units in a listed currency, rows are within
  their limit. An empty optional field arrives as `null` and an empty `rows`
  field as `[]`. **Only declared fields arrive**: anything else in the
  request is dropped before the handler runs, so a handler can trust the
  keys. `record.id` is `null` for a new record.
- **`save` answers `{ id }`, or `{ errors }`** keyed by field name, for what
  only the plugin can judge — a SKU already in use. The admin shows each
  message beside its field. A problem in a row is keyed
  `<field>.<row index>.<sub-field>`.
- `load` returns the values in the shape `save` takes, or `null` when the
  record is gone.
- Without `remove`, the form has no delete.
- `definePlugin` refuses a records panel without `load` and `save`, and
  handlers for a panel that is not one.

**Attached to content (plugin API 2).** A records panel can belong to
content of one kind, and is then edited where that content is edited:

```jsonc
{
  "id": "variants", "type": "records", "table": "p_shop_variant",
  "attachTo": { "kind": "product" },
  …
}
```

- In the admin the panel appears **under the editor of every `product`**,
  listing the records of the item that is open, and nowhere else: the
  plugins page only says where to find it.
- **Records are keyed by the item's translation group**, not by its id: a
  product's variants are the same whichever language of it is open. The
  panel's table needs a column holding the group — `translation_group`, or
  the name given as `attachTo.column` — which is what the list filters on.
- **`save` is told which item**: `record.attachedTo` is
  `{ translationGroup, kind }`. The core has checked that content of that
  kind with that group exists; a request naming none, or another kind's, is
  refused before the handler runs. For a panel that is not attached it is
  `null`.
- A new item has no group until it is first saved, so the panel appears once
  it has been.
- The panel's records are saved by its own Save, independently of the item's
  Publish.
- **Cleaning up is the plugin's job, through `onContentDelete`** (§5.7): when
  the hook reports `lastInGroup`, the item is gone in every language and its
  records should go. The core never deletes from a plugin's table. A plugin
  with an attached panel and no delete hook leaves orphans.

| Request | Scope |
| --- | --- |
| `GET …/panels/<panel>/records/<id>` | `export`, like the list |
| `POST …/records`, `PUT …/records/<id>`, `DELETE …/records/<id>` | `content:write` |

Validation failures answer **422** with `{ "error", "errors": { <field>:
<message> } }`. A signed-in session's writes carry the CSRF token, as every
write does.

The inquiry list, and any future order list, is a panel of this kind. **This
mechanism exists so that a plugin never needs to write React or Preact code**
— the moment a plugin can inject frontend code into the admin, both the
admin's size budget and its security boundary are gone.

### 7.6 Sending email

```ts
interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
}
```

The only implementation in 0.1 is Resend, called through its HTTP API with
`fetch` and **no SDK** (`TECH_STACK §5`). Delivery records and retries live in
the core's `job` table.

`sendEmail` is **an internal function boundary, not a provider abstraction**
(`ARCHITECTURE §17`). 0.1 builds no adapter for a mail provider it might use
one day.

**The Resend key and the sender address are site settings** (Settings →
Email in the admin, `PUT /_mallok/api/settings/email`), entered once and used
by every plugin. A plugin declares neither. When a message is attempted — at
send time, not when it is queued — the core picks:

| | First choice | Otherwise |
| --- | --- | --- |
| Key | The calling plugin's own `resend_api_key` secret, when one is stored and can be decrypted | The site's key |
| Sender | The calling plugin's `from_address` setting, when it is a non-empty string | The site's sender |

The plugin-level entries exist for two reasons: a plugin written before site
email keeps working with the key it already stores, and a plugin may send from
an address of its own (the official `inquiry` plugin keeps an optional
`from_address` for that). **A new plugin should declare no `resend_api_key`
secret.** With no usable key, or no sender, the job fails with a message that
says which is missing and is retried on the usual schedule, so a message
queued shortly before the operator enters the key is still delivered.

`POST /_mallok/api/settings/email/check` asks Resend whether the stored key
works and returns only the verdict. Both endpoints need `settings:write`; the
key is never returned by any endpoint.

A plugin builds its own messages, with two helpers exported from
`mallok/worker` for that purpose:

```ts
import { escapeHtml, renderTextTemplate } from 'mallok/worker';

escapeHtml(value: string): string;
renderTextTemplate(source: string, data: Readonly<Record<string, unknown>>): Promise<string>;
```

`renderTextTemplate` renders a plain-text Liquid template — typically one the
operator edits in the plugin's settings — with the same restricted engine
themes use (strict filters, own properties only, bounded parsing and
memory). **Its output is text and is not HTML-escaped.** An HTML body is the
plugin's own markup, and every value in it, rendered template text included,
goes through `escapeHtml`; that is what keeps what a buyer typed from becoming
markup in the email. The official `inquiry` plugin does exactly this
(`src/plugins/inquiry/emails.ts`), and a broken operator template falls back
to built-in text rather than losing the message.

### 7.7 Export files

A plugin that owns portable business data implements `exportFiles`:

```ts
export async function exportFiles(
  ctx: PluginContext,
): Promise<readonly PluginExportFile[]>;
```

Each result is `{ path, text }`. Paths use forward slashes and must be
relative and portable: no absolute or drive path, backslash, dot or empty
segment, control character, reserved Windows filename, trailing dot or space,
or overlong segment. Case-only and canonically equivalent Unicode names count
as the same path. A plugin cannot replace a core export file or another
plugin's file, and one invalid entry rejects that plugin's entire contribution
rather than leaving half of it in the manifest. Cross-plugin conflicts are
resolved deterministically by plugin id.

The manifest names every plugin whose export failed. Both the CLI and the
browser refuse to produce a backup when that list is non-empty, so an archive
without inquiries or other plugin-owned data cannot be reported as complete.

## 8. Lifecycle

| Stage | How |
| --- | --- |
| Discovery | Static imports at compile time; the site passes plugins to `createMallok` |
| Migration | Runs with the core migrations on a Worker cold start |
| Enable | `plugin_state.enabled = 1`, immediate |
| Disable | `enabled = 0`; hooks and routes stop at once, **tables and data are kept** |
| Removal | Delete the static import and redeploy; 0.1 leaves the plugin's tables intact |

**Dynamic `import` and remote loading are forbidden** (`TECH_STACK §12`). The
plugin registry is a compile-time constant.

## 9. Plugins and the cache

A plugin declares through `affectsFragmentCache` whether it changes stage-one
output:

- a plugin declaring a `beforeRender` hook **must** set it to `true`;
- when `true`, the plugin's id, version and settings enter the `render_cache`
  key (`pluginHash` in `src/worker/render.ts`), so changing a setting
  invalidates every fragment;
- a plugin that is `false` and only has `afterRender` stays out of the
  fragment key, but **the edge cache must still be purged** — the core purges
  the `site` tag automatically when it is enabled, disabled or reconfigured.

`renderData` (§5.6) is stage two: what it returns is in the page, never in
the fragment, so it does not enter the `render_cache` key and a plugin using
only that hook leaves `affectsFragmentCache` false. Its data is cached with
the page in the edge cache and is refreshed by purging the page.

### 9.1 A plugin's own cache tags

Every public page carries tags the core chose — `site`, `c:<content-id>`,
`k:<kind>:<locale>`, `home:<locale>` and so on (`ARCHITECTURE §6`). A
plugin adds its own from `renderData` (§5.6), so that when one price changes,
only the pages showing that price are purged.

- **On the page.** A tag `t` returned in `cacheTags` by the plugin `shop`
  appears as `p:shop:t`, after the core's tags. Home, list and tag-archive
  pages are tagged the same way, so a plugin that prints prices on a list
  returns the tag of every item it printed.
- **Purging.** `ctx.purgeTags(['t'])` purges `p:shop:t`. **A plugin can purge
  only its own namespace, and `site`.** Whatever it passes is prefixed with
  its own id, so `ctx.purgeTags(['c:123'])` asks for `p:shop:c:123` — a tag no
  page has — rather than the core's `c:123`, and another plugin's
  `p:other:t` cannot be named at all. `site` is passed through, for a change
  that can affect any page. This applies to every plugin, whichever API
  version it declares (§13.3).
- **What a tag may be.** Cloudflare's rules, read 2026-10-05
  ([purge by tags](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/)):
  printable ASCII, no spaces, no commas, compared without regard to case; the
  whole header at most 16 KB; a tag in a purge call at most 1,024 characters,
  prefix included. A tag that breaks a rule, or would overflow the header, is
  left off the page and `{"event":"cache_tag_rejected","tag":…,"reason":…}` is
  logged; the core's tags come first, so they are never the ones to go. A
  `cacheTags` that is not an array of strings is ignored as a whole and
  `cache_tags_dropped` is logged. Neither stops the page from being cached.
- **What purging costs.** One purge call carries at most 100 tags; more are
  sent as several calls. Calls within two seconds are coalesced into one. On
  the Free plan Cloudflare allows 5 purge calls a minute with a burst of 25,
  shared by every zone of that plan on the account
  ([purge limits](https://developers.cloudflare.com/cache/how-to/purge-cache/),
  read 2026-10-05). **A bulk change should purge `site` once, not a tag per
  row.** Without `CF_API_TOKEN` and `CF_ZONE_ID` nothing is purged and pages
  expire by their TTL, as for the core's own purges.
- A page a failed `renderData` hook kept out of the cache carries no tags;
  there is nothing to purge.

Declaring this wrongly means changing a setting and still seeing old content.
At install the core rejects a plugin that declares `beforeRender` alongside
`affectsFragmentCache: false`.

## 10. The size budget

Pre-bundling the official plugins is only possible while the total fits
(`ARCHITECTURE §12`). The rules:

1. Every added plugin must come with a before-and-after `pnpm bundle:size` in
   the commit.
2. A plugin must not introduce a second implementation of something the render
   layer already has — a second Markdown parser, a second validation library.
3. A plugin must not introduce a vendor SDK; call the API with `fetch`.
4. The current baseline is 202.65 KiB gzip for the Worker, measured as
   wrangler's Total Upload, against Mallok's own 3 MiB gzip render-path
   budget. Cloudflare's limit is 64 MiB uncompressed on either plan.

## 11. The official plugin

0.1 has one (`PRODUCT_VISION §6`):

**`inquiry`** — the heart of 0.1's acceptance. The path is in
`ARCHITECTURE §13`:

```
A native <form> on the product page (hidden content_id and locale; a honeypot field; the Turnstile widget)
  → POST /_mallok/p/inquiry/submit
  → zod validation → honeypot and submission-timing checks → Turnstile verification → rate limit
  → write p_inquiry_inquiry (with request.cf.country, the user agent, ip_hash)
  → two jobs: notify the site owner (Reply-To is the buyer's address) and auto-acknowledge the buyer (template chosen by locale)
  → attempt delivery immediately; the cron retries failures
  → 302 to that locale's thank-you page, which is cacheable
```

It is the only thing in 0.1 permitted to inject client-side JavaScript — the
Turnstile script (`PRODUCT_VISION §5.6`).

## 12. Deliberately not done

- No plugin sandbox, and no pretence that one exists.
- No plugin marketplace runtime, no remote installation, no upload-and-install
  in the browser. That is a 1.0 direction, and it will be a marketplace of
  source too.
- Plugins may not inject frontend code into the admin; declarative panels
  only.
- Plugins may not register Liquid filters or tags, which would break through
  the theme security boundary.
- Plugins may not add a Cron Trigger; a site has exactly one.
- No KV, Queues or Durable Objects for plugins (`TECH_STACK §12`).
- No inter-plugin dependency declarations or version solving. With one
  official plugin in 0.1, that would be premature abstraction.

## 13. Plugin API 2

- Status: **in progress** (phase six of `docs/IMPLEMENTATION_PLAN.md`,
  Tasks 18–35). Each row below is filled in when its task lands; until then a
  row names what is planned, not what exists, and nothing marked planned may
  be relied on.

Version 2 exists for site-level plugins such as the Nundar shop plugin, which
ship as source inside a site. Every addition is generic: none of them knows
about prices, orders or stock, and each must make sense for any plugin — an
inquiry cart or a booking plugin as much as a shop.

### 13.1 The compatibility rule

- **Version 2 only adds.** A new hook, a new key in a route or panel
  declaration, a new member on a context object. Nothing defined by version 1
  changes meaning or goes away, so a plugin declaring `pluginApi: 1`, or
  omitting it, runs unchanged on a build that supports 2. The official
  `inquiry` plugin is the standing proof and is not edited to pass.
- A plugin declaring `pluginApi: 2` is refused at build time by a build that
  supports only 1 — "This plugin needs plugin API 2; this build supports 1"
  (`src/core/plugin.ts`) — rather than degrading silently.
- A security check added for **every** plugin, whichever version it declares,
  is listed in §13.3 and in the release's upgrade notes. Tightening a check is
  the one kind of change that can affect a version 1 plugin, and it is never
  made silently.
- The build's supported version (`PLUGIN_API_VERSION` in `src/core/plugin.ts`)
  **is 2 as of Task 22** (`renderData`), the first addition that changes what
  a `plugin.json` may declare. Releases up to `0.1.0-rc.9` support 1 and
  refuse a plugin declaring 2. Additions that are plain exports, such as the
  public helpers, need no declaration and are usable under version 1.
- **A version 2 hook needs a version 2 declaration.** A manifest that lists
  `renderData` and declares `"pluginApi": 1` is refused at build time: "The
  renderData hook needs plugin API 2; this plugin declares 1." A manifest that
  omits `pluginApi` gets the build's own version, as before.
- **The rows of §13.2 still marked Planned are not in this build.** A plugin
  declaring 2 is accepted from here on, so the table, not the version number,
  says what can be relied on until the phase closes.

### 13.2 Additions

| Addition | Where it is documented | Task | Status |
| --- | --- | --- | --- |
| Public helpers: `escapeHtml`, `renderTextTemplate` | §7.6 and the `mallok/worker` exports | 20 | Done |
| Site-level email settings used by `ctx.sendEmail` | §7.6 | 21 | Done |
| `renderData`: plugin data read while rendering a page | §5.6, §6; `THEME_FORMAT.md §7.9` | 22 | Done |
| `renderData` adds `offers` to the page's `Product` structured data | §5.6; `SEO_PERFORMANCE.md §5` | 41 | Done |
| Plugin cache tags (`p:<plugin-id>:<tag>`) | §5.6, §9.1 | 23 | Done |
| Multi-segment routes with parameters, a locale segment, `input.json` | §7.2 | 24 | Done |
| Rate-limit tiers (`rateLimit: "strict" \| "relaxed"`), counted per route | §7.2; `CLOUDFLARE_RESOURCES.md §4` | 25 | Done |
| Plugin pages rendered through theme layouts (`render: "page"`) | §7.2; `THEME_FORMAT.md §16` | 26 | Done |
| `onContentSave` called on every save path; `onContentDelete` | §5.4, §5.7 | 27 | Done |
| Editable `records` panels with `money` and `rows` fields, sorting, search | §7.5 | 28 | Done |
| Panels attached to the content editor (`attachTo`) | §7.5 | 29 | Done |
| Raw-body routes (`body: "raw"`) | §7.2 | 31 | Done |
| Action parameters and related rows | §7.5 | 32 | Planned |
| Per-plugin isolation of `scheduled`, and a job API (`ctx.enqueue`) | §5.5, §7.4 | 33 | Planned |

Theme-side changes in the same phase are documented in `THEME_FORMAT.md`:
layouts for plugin pages (§16, Task 26), which are optional, and the script
check for themes that declare `clientScripts` (§9, Task 30, done), which is a
tightening — a theme that declared one script and also carried inline script
or an `on…=` attribute no longer builds. The five official themes pass
unchanged.

### 13.3 Checks that apply to every plugin

| Check | Effect on a version 1 plugin | Task | Status |
| --- | --- | --- | --- |
| Reading a panel's rows requires the `export` scope (§7.5) | A token without `export` gets 403 instead of the rows; the admin's own session is unaffected | 19 | Done, ships as `0.1.0-rc.8` |
| `ctx.purgeTags` purges only the calling plugin's own tags, and `site` (§9.1) | A plugin that purged a core tag such as `c:<id>` or `home:<locale>` no longer does: the tag it names is now inside its own namespace. The official `inquiry` plugin never calls `purgeTags` | 23 | Done |
| `onContentSave` is called, as §5.4 always said (§5.4) | A version 1 plugin that declares the hook now has it run on every save: it can rewrite what is stored and refuse saves, where before it silently did nothing | 27 | Done |
| A cross-site `POST` to any plugin route is refused with 403 (§7.2) | A same-site form, such as the inquiry form, still submits; a request with neither `Sec-Fetch-Site` nor `Origin` is allowed. A form on **another** site that posted to a plugin route — an inquiry form embedded on a partner's page — no longer works | 26 | Done |
