# The Mallok plugin API

- Status: 0.1 baseline
- Date: 2026-08-28
- Standing: the only contract a plugin has. Official and third-party plugins
  use the same mechanism; there is no private interface. The boundaries
  described here must match the wording in the admin interface — **nothing may
  imply a sandbox exists**.

## 1. In one sentence

**A plugin is real JavaScript or TypeScript that reaches five hooks and six
capabilities through a declarative `plugin.json`. It runs in the user's own
Cloudflare account with the Worker's full permissions.**

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

## 3. Package structure

```text
src/plugins/inquiry/
├── plugin.json           # declares hooks, routes, settings, secrets, migrations, panels, injected client JS
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
  "official": true,                  // shown in the interface to indicate origin; does not change how it is bundled
  "pluginApi": 1,                    // the version of this contract

  "hooks": ["afterRender", "onContentSave", "scheduled"],

  "routes": [
    {
      "path": "submit",              // actually /_mallok/p/inquiry/submit
      "method": "POST",
      "cache": false,                // defaults to false; `ttl` is required when true
      "turnstile": true,             // the core performs the server-side siteverify
      "rateLimit": { "key": "ip", "limit": 5, "period": 60 }
    }
  ],

  "settings": {                      // stored in cleartext in plugin_state.settings
    "recipient":     { "type": "string",  "label": "Recipient email", "required": true },
    "from_address":  { "type": "string",  "label": "From address",    "required": true },
    "autoreply":     { "type": "boolean", "label": "Send auto-reply", "default": true },
    "block_countries": { "type": "string[]", "label": "Blocked countries" }
  },

  "secrets": {                       // AES-GCM encrypted into plugin_state.secrets
    "resend_api_key": { "label": "Resend API key", "required": true }
  },

  "migrations": ["migrations/0001_inquiry.sql"],

  "panels": [ /* §7.5 */ ],

  "affectsFragmentCache": false,     // see §9
  "clientScripts": [
    { "src": "https://challenges.cloudflare.com/turnstile/v0/api.js",
      "purpose": "Turnstile bot protection", "bytes": 0 }
  ]
}
```

The field types in `settings` match the table in `THEME_FORMAT.md §5.2`,
excluding `image`, `file` and `reference`. Validation uses zod, with the
schema generated from `plugin.json`.

## 5. Hooks

0.1 exposes five (`ARCHITECTURE §12`). Each is a named export from `index.ts`.

| Hook | When | Whose CPU it costs | Typical use |
| --- | --- | --- | --- |
| `onRequest` | A request arrives, **before the cache lookup** | The visitor request | Redirects, access control |
| `beforeRender` | Stage one, once the mdast exists | **The save request** | Shortcodes, custom syntax |
| `afterRender` | After the complete HTML is generated | The visitor request, on a cache miss | Injecting meta, structured data, form markup |
| `onContentSave` | When content is saved | The save request | Validation, auto-summaries, notifying something external |
| `scheduled` | Inside the once-a-minute cron | The cron invocation | Retries, syncing, cleanup |

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
> `pluginApi` must go to 2 rather than degrade silently. 0.1 defines the
> contract against unified and mdast.

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
): Promise<ContentDraft | void>;
```

Returning a modified draft adopts it; returning `void` changes nothing.
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

## 6. The context objects

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
  readonly sendEmail: (message: EmailMessage) => Promise<void>;
  /** Enqueue a job (§7.4). */
  readonly enqueue: (type: string, payload: unknown, runAt?: Date) => Promise<string>;
  /** Purge by tag, coalesced automatically. */
  readonly purgeTags: (tags: readonly string[]) => Promise<void>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}
```

`PluginRequestContext` adds `request`, `url` and `locale`;
`PluginRenderContext` adds `content`, `page` and `locale`.

**`ctx.db` is the full D1 binding** — a plugin can read and write any table.
The core enforces no table-level isolation, because that would offer a false
sense of security. The convention is: a plugin touches only its own
`p_<id>_`-prefixed tables, may read core tables, and needs a good reason to
write to one.

## 7. The six capabilities

### 7.1 Tables

A plugin brings its own SQL migrations. **Table names must start with
`p_<plugin_id>_`** and migration ids with `plugin:<plugin_id>:`
(`DATA_MODEL §2.11`). The core's migrator runs them alongside the core
migrations, records them in the same `migration` table, and shares the same
`migration_lock`.

The migration rules are the core's (`DATA_MODEL §2.10`): **additive changes
only** — new tables, new columns with defaults, new indexes. Dropping a column
or changing its meaning within one version is not allowed, because the old
Worker version is still serving during the migration.

Disabling a plugin **does not drop its tables**. Uninstalling one makes the
admin ask explicitly whether to delete the data, defaulting to no.

### 7.2 Routes

`/_mallok/p/<plugin_id>/<path>`, declared in `plugin.json`'s `routes`. The
core handles:

- body parsing (`application/json` and `application/x-www-form-urlencoded`);
- zod validation against the schema;
- the server-side Turnstile `siteverify`, when `turnstile: true`;
- rate limiting, through the `RATE_LIMITER` Workers binding.

```ts
export const routes = {
  async submit(input: SubmitInput, ctx: PluginRequestContext): Promise<Response> { … },
};
```

The rate-limit binding **counts per data centre and is eventually consistent**
(`TECH_STACK §5`). Use it to deter abuse only; it **must not** back billing,
quotas, or anything requiring an exact count.

Routes default to `Cache-Control: private, no-store`. A route declaring
`cache: true` must also give a `ttl`, and the core refuses to enable caching
on a route that declares `turnstile` or `rateLimit`.

### 7.3 Settings and secrets

- `settings`: stored in cleartext in `plugin_state.settings`; the admin
  generates the form from the schema.
- `secrets`: **AES-GCM** encrypted with a key derived from `MALLOK_SECRET`
  through HKDF and stored in `plugin_state.secrets`, with a fresh random IV on
  every write (`DATA_MODEL §2.7`).
- A plugin may declare `checkSecrets` (added 2026-08-30): a read-only
  validation function per secret name, behind a "Test" button next to the
  secret in the admin. **The core cannot tell a good Resend key from a bad
  one; the plugin can.** The check must be read-only or safe to repeat, and
  **only the verdict is returned — the secret value never leaves the Worker.**

**The management API returns only "set" or "not set", and never echoes a
secret value.** Rotation is supported: writing a new value overwrites.
`SECURITY.md` defines the derivation and encoding.

### 7.4 Scheduled work

The `scheduled` hook plus the core's `job` table.
`ctx.enqueue(type, payload, runAt)` writes a `job` row, with `type`
automatically prefixed `plugin:<id>:`. Failures retry with exponential
backoff; past `max_attempts` (5 by default) the job becomes `failed` and is
visible in the admin.

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
      { "field": "created_at", "label": "Received", "type": "datetime", "sortable": true },
      { "field": "name",       "label": "Name" },
      { "field": "email",      "label": "Email",   "type": "email" },
      { "field": "country",    "label": "Country" },
      { "field": "status",     "label": "Status",  "type": "badge" }
    ],
    "filters": [
      { "field": "status", "type": "select", "choices": ["new", "replied", "spam"] },
      { "field": "created_at", "type": "daterange" }
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

Ids declared in `actions` correspond to exports from `index.ts`:

```ts
export const actions = {
  async mark_replied(ids: readonly string[], ctx: PluginContext): Promise<void> { … },
  async export_csv(query: PanelQuery, ctx: PluginContext): Promise<Response> { … },
};
```

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

Email templates live at `emails/<name>.<locale>.liquid` and go through the
same restricted engine as themes, so **what a buyer typed is escaped by
default in the email too**.

## 8. Lifecycle

| Stage | How |
| --- | --- |
| Discovery | Static imports at compile time; the registry is `src/plugins/index.ts` |
| Migration | Runs with the core migrations on a Worker cold start |
| Enable | `plugin_state.enabled = 1`, immediate |
| Disable | `enabled = 0`; hooks and routes stop at once, **tables and data are kept** |
| Removal | Delete from the repository and redeploy. The admin asks whether to delete the data, defaulting to no |

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
   wrangler's Total Upload, against a 3 MB free-plan ceiling.

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
