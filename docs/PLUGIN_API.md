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
      "rateLimit": true              // site's binding; key is plugin id + IP
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

0.1 exposes five (`ARCHITECTURE §12`); plugin API 2 adds `renderData`.
Implementations are properties of the `hooks` object passed to `definePlugin`.

| Hook | When | Whose CPU it costs | Typical use |
| --- | --- | --- | --- |
| `onRequest` | A request arrives, **before the cache lookup** | The visitor request | Redirects, access control |
| `beforeRender` | Stage one, once the mdast exists | **The save request** | Shortcodes, custom syntax |
| `afterRender` | After the complete HTML is generated | The visitor request, on a cache miss | Injecting meta, structured data, form markup |
| `onContentSave` | When content is saved | The save request | Validation, auto-summaries, notifying something external |
| `scheduled` | Inside the once-a-minute cron | The cron invocation | Retries, syncing, cleanup |
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
expires; a plugin purges with `ctx.purgeTags` from the route or action that
made the change. Cache tags of a plugin's own arrive with Task 23 (§13.2).

## 6. The context objects

All of these are exported from `mallok/worker`, so a third-party plugin
annotates its own handlers with the same types the official one uses:
`PluginContext`, `PluginRequestContext`, `PluginRenderContext`,
`PluginRenderDataContext`, `ContentDraft`, `RouteInput`, `EmailMessage`, `PluginSiteSettings`,
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
  /** Purge by tag, coalesced automatically. */
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
one-way `ipHash`. `PluginRenderContext` contains `settings`, `site`, `locale`,
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

- body parsing (`application/json` and `application/x-www-form-urlencoded`);
- the server-side Turnstile `siteverify`, when `turnstile: true`;
- rate limiting, through the `RATE_LIMITER` Workers binding.

```ts
export const routes = {
  async submit(input: SubmitInput, ctx: PluginRequestContext): Promise<Response> { … },
};
```

The route handler validates its own parsed fields. When `rateLimit: true`, the
core calls the site's single binding with the fixed key
`<plugin-id>:<connecting-ip>`; the limit and period belong to that binding's
`wrangler.jsonc`, not to a manifest value the runtime cannot enforce. It is
best-effort abuse control and must not back billing or exact quotas.

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
| Plugin cache tags (`p:<plugin-id>:<tag>`) | §9 | 23 | Planned |
| Multi-segment routes with parameters, a locale segment, `input.json` | §4, §7.2 | 24 | Planned |
| Rate-limit tiers | §7.2 | 25 | Planned |
| Plugin pages rendered through theme layouts (`render: "page"`) | §7.2; `THEME_FORMAT.md`, plugin page layouts | 26 | Planned |
| `onContentSave` called on every save path; `onContentDelete` | §5.4, and a new delete-hook section | 27 | Planned |
| Editable `records` panels with `money` and `rows` fields, sorting, search | §7.5 | 28 | Planned |
| Panels attached to the content editor (`attachTo`) | §7.5 | 29 | Planned |
| Raw-body routes (`body: "raw"`) | §7.2 | 31 | Planned |
| Action parameters and related rows | §7.5 | 32 | Planned |
| Per-plugin isolation of `scheduled`, and a job API (`ctx.enqueue`) | §5.5, §7.4 | 33 | Planned |

Theme-side additions in the same phase — layouts for plugin pages, and the
script check for themes that declare `clientScripts` (Task 30) — are
documented in `THEME_FORMAT.md`, and remain optional: the five official themes
pass unchanged.

### 13.3 Checks that apply to every plugin

| Check | Effect on a version 1 plugin | Task | Status |
| --- | --- | --- | --- |
| Reading a panel's rows requires the `export` scope (§7.5) | A token without `export` gets 403 instead of the rows; the admin's own session is unaffected | 19 | Done, ships as `0.1.0-rc.8` |
| Cross-site submissions to page routes and state-changing POSTs are refused | A same-site form, such as the inquiry form, still submits; a request with neither `Sec-Fetch-Site` nor `Origin` is allowed | 26 | Planned |
