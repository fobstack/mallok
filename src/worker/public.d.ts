/**
 * The declarations published as `mallok/worker`.
 *
 * Shipped instead of the emitted declaration tree, which could not be
 * consumed. `tsc` follows every `.d.ts` it loads, and the emitted one reached
 * `zod`, `mdast` and `hast` through the core barrel. Any site that turned
 * `skipLibCheck` off got unresolved-module errors before compiling a line of
 * its own code.
 *
 * The alternative was to add those three to the package's dependencies. That
 * would make every site install a schema library and an HTML AST in order to
 * name a theme. The one deliberate type dependency is `@types/mdast`, because
 * `beforeRender` really does expose mdast and authors must be able to inspect
 * and modify its full tree without casts.
 *
 * Hand-written declarations normally rot away from the code they describe.
 * These cannot: `test/types/public-surface.ts` type-checks the real
 * implementation against this file on every `pnpm typecheck`, and it fails if
 * a value export appears on one side and not the other, or if `Env` stops
 * matching exactly.
 */

import type { Root as MdastRoot } from 'mdast';

/** Bindings and secrets the Worker reads (see `wrangler.jsonc`). */
export interface Env {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  /** Site slug, informational only. */
  readonly MALLOK_SITE: string;
  /**
   * The custom domain this site was provisioned with, if any.
   *
   * Written into `wrangler.jsonc` by `mallok create --domain`, and copied
   * into `site.domain` when the wizard finishes.
   */
  readonly MALLOK_DOMAIN?: string;
  /** Random 32-byte secret set at deploy time. */
  readonly MALLOK_SECRET: string;
  /**
   * One-time credential for the first-run wizard, set by `mallok create`.
   *
   * A site without one refuses to create an administrator at all — that is
   * the default, not an opt-in (`docs/SECURITY.md §3.7`).
   */
  readonly MALLOK_SETUP_KEY?: string;
  /**
   * Local development only: lets the wizard run with no setup key.
   *
   * `wrangler dev` has no `mallok create` behind it to mint a secret, so
   * there is one way to get a keyless wizard and it is spelled out in full.
   * A deployed site must never carry it: `mallok create` refuses to deploy a
   * configuration that does, and the project shell never ships it.
   */
  readonly MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY?: string;
  /** Zone-scoped token with Cache Purge permission; optional. */
  readonly CF_API_TOKEN?: string;
  readonly CF_ZONE_ID?: string;
  /** Static Assets binding; serves the admin app and theme assets. */
  readonly ASSETS?: Fetcher;
  /** Workers rate-limit binding; optional, best-effort only. */
  readonly RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  /**
   * The second rate-limit binding, for routes that declare the `relaxed`
   * tier. Optional: without it those routes use `RATE_LIMITER`.
   */
  readonly RATE_LIMITER_RELAXED?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

/**
 * A theme as it exists inside the Worker bundle.
 *
 * The manifest is described here by the four fields a site has any reason to
 * read — the name to show in the admin, the version to print, the contract
 * number to compare. The rest of `theme.json` (content kinds, field schemas,
 * configuration declarations) is the theme format's business, validated when
 * the build loads it, and documented in `docs/THEME_FORMAT.md` rather than in
 * a type a site would have to satisfy by hand.
 */
export interface BundledTheme {
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly themeApi: number;
  };
  /** Templates, partials and locale bundles, keyed by path inside the theme. */
  readonly files: Readonly<Record<string, string>>;
}

/** The plugin author's surface (docs/PLUGIN_API.md §4–§7). */

/** An email handed to `ctx.sendEmail` (§7.6). */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
}

/**
 * A site's settings, as a plugin sees them.
 *
 * Declared in full rather than narrowed to the fields that seemed useful. A
 * narrowed copy is not the same type: the context is passed *into* a handler,
 * so a subset here would make an author's correctly-typed handler unusable by
 * the runtime, and `test/types/public-surface.ts` catches exactly that.
 */
export interface PluginSiteSettings {
  readonly name: string;
  readonly tagline: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  readonly nav: Readonly<
    Record<string, readonly { readonly label: string; readonly href: string }[]>
  >;
  readonly themeOptions: Readonly<Record<string, unknown>>;
  readonly domain: string | null;
  readonly mediaBaseUrl: string;
  readonly cacheTtl: number;
}

export type PluginHookName =
  | 'onRequest'
  | 'beforeRender'
  | 'afterRender'
  | 'onContentSave'
  | 'scheduled'
  | 'renderData'
  | 'onContentDelete';

export interface PluginSettingDeclaration {
  readonly type:
    | 'string'
    | 'text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'select'
    | 'string[]'
    | 'color'
    | 'keyvalue';
  readonly label?: string | undefined;
  readonly required: boolean;
  readonly help?: string | undefined;
  readonly group?: string | undefined;
  readonly default?: unknown;
  readonly choices?: readonly string[] | undefined;
  readonly max?: number | undefined;
  readonly min?: number | undefined;
}

export interface PluginRouteDeclaration {
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly turnstile: boolean;
  /** `true` is `"strict"`; `false` is no rate limit (§7.2). */
  readonly rateLimit: boolean | 'strict' | 'relaxed';
  /** `"page"`: the handler's view is rendered by a theme layout (§7.2). */
  readonly render: 'response' | 'page';
  /** The plugin layout a `"page"` route asks the theme for. */
  readonly layout?: string | undefined;
  /** `"raw"`: the handler reads the untouched body from `ctx.request` (§7.2). */
  readonly body: 'parsed' | 'raw';
  /** `"raw"` only: the largest body accepted, in bytes. */
  readonly maxBytes?: number | undefined;
}

/** A field of a record that holds one value (§7.5). */
export interface PluginRecordScalarField {
  readonly type:
    | 'string'
    | 'text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'select'
    | 'string[]'
    | 'color'
    | 'keyvalue'
    | 'money';
  readonly label?: string | undefined;
  readonly required: boolean;
  readonly help?: string | undefined;
  readonly group?: string | undefined;
  readonly default?: unknown;
  readonly choices?: readonly string[] | undefined;
  /** `money` only. */
  readonly currencies?: readonly string[] | undefined;
  readonly max?: number | undefined;
  readonly min?: number | undefined;
}

/** A repeatable group of scalar fields (§7.5). */
export interface PluginRecordRowsField {
  readonly type: 'rows';
  readonly label?: string | undefined;
  readonly required: boolean;
  readonly help?: string | undefined;
  readonly group?: string | undefined;
  readonly fields: Readonly<Record<string, PluginRecordScalarField>>;
  readonly max?: number | undefined;
}

export type PluginRecordField = PluginRecordScalarField | PluginRecordRowsField;

/** A `money` value: whole minor units and an ISO 4217 currency code. */
export interface MoneyValue {
  readonly amount: number;
  readonly currency: string;
}

export interface PluginPanelDeclaration {
  readonly id: string;
  readonly label: string;
  readonly type: 'table' | 'records';
  /** `records` only. */
  readonly fields?: Readonly<Record<string, PluginRecordField>> | undefined;
  /** `records` only: shown in the editor of content of this kind (§7.5). */
  readonly attachTo?:
    | { readonly kind: string; readonly column: string }
    | undefined;
  readonly search: readonly string[];
  readonly table: string;
  readonly columns: readonly {
    readonly field: string;
    readonly label: string;
    readonly type: 'text' | 'email' | 'datetime' | 'badge';
    readonly sortable: boolean;
  }[];
  readonly filters: readonly string[];
  readonly detail: readonly string[];
  readonly orderBy: string;
  readonly actions: readonly {
    readonly id: string;
    readonly label: string;
    readonly type: 'update' | 'download';
    /** Values the admin asks for before running the action (§7.5). */
    readonly params?:
      | Readonly<Record<string, PluginRecordScalarField>>
      | undefined;
  }[];
  /** Child tables shown read-only with one row of the panel (§7.5). */
  readonly related: readonly {
    readonly id: string;
    readonly label: string;
    readonly table: string;
    readonly foreignKey: string;
    readonly columns: readonly {
      readonly field: string;
      readonly label: string;
      readonly type: 'text' | 'email' | 'datetime' | 'badge';
      readonly sortable: boolean;
    }[];
    readonly orderBy?: string | undefined;
  }[];
}

/** A manifest after {@link definePlugin} has validated and defaulted it. */
export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly pluginApi: number;
  readonly hooks: readonly PluginHookName[];
  readonly routes: readonly PluginRouteDeclaration[];
  readonly settings: Readonly<Record<string, PluginSettingDeclaration>>;
  readonly secrets: Readonly<
    Record<string, { readonly label: string; readonly required: boolean }>
  >;
  readonly panels: readonly PluginPanelDeclaration[];
  readonly affectsFragmentCache: boolean;
  readonly clientScripts: readonly {
    readonly src: string;
    readonly purpose: string;
    readonly bytes?: number | undefined;
  }[];
}

/** Capabilities every plugin call receives (§7). */
export interface PluginContext {
  readonly db: D1Database;
  readonly media: R2Bucket;
  /** This plugin's settings, validated against its manifest. */
  readonly settings: Readonly<Record<string, unknown>>;
  /** Decrypted secrets. Never logged, never returned to a client. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly site: PluginSiteSettings;
  /**
   * Queues a message and sends it with the site's Resend key and sender
   * (Settings → Email, §7.6); returns the job id.
   */
  readonly sendEmail: (message: EmailMessage) => Promise<string>;
  /**
   * Purges this plugin's own cache tags — the names it returned as
   * `cacheTags` from `renderData` — or `site` (§9.1). Nothing else can be
   * named: every other tag is taken to be one of the plugin's own.
   */
  readonly purgeTags: (tags: readonly string[]) => Promise<unknown>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
  /**
   * Queues one of this plugin's jobs (§7.4) and returns its id. The job runs
   * in a later cron tick, at least once, with retries.
   */
  readonly enqueue: (
    name: string,
    payload: unknown,
    options?: { readonly runAt?: Date },
  ) => Promise<string>;
  /**
   * The same, as a statement for the plugin's own `db.batch`: the job is
   * queued if and only if the batch commits.
   */
  readonly enqueueStatement: (
    name: string,
    payload: unknown,
    options?: { readonly runAt?: Date },
  ) => D1PreparedStatement;
}

/** Context for a plugin route call (§7.2). */
export interface PluginRequestContext extends PluginContext {
  readonly request: Request;
  readonly url: URL;
  readonly locale: string;
  /** ISO country from the edge, when the platform provides it. */
  readonly country: string | null;
  /** `sha256(ip || MALLOK_SECRET)`; the raw address is never stored. */
  readonly ipHash: string | null;
}

/**
 * Context for `afterRender` (§5.3).
 *
 * Secrets are deliberately absent: it runs on the visitor path, and public
 * markup never needs them.
 */
export interface PluginRenderContext {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly site: PluginSiteSettings;
  readonly locale: string;
  /**
   * The active theme's language pack for this page — what its templates read
   * as `t` — so that markup a plugin injects can speak the page's language.
   * A key the theme does not define is absent; fall back to your own text.
   */
  readonly t: Readonly<Record<string, string>>;
  readonly path: string;
  /** Kind and id of the content being rendered; null on home and list pages. */
  readonly content: { readonly id: string; readonly kind: string } | null;
}

/**
 * Context for `renderData` (§5.6).
 *
 * `db` is not the plain binding: it allows one call per render — one query or
 * one `batch` — and refuses anything but a read. There are no secrets, for
 * the reason `afterRender` has none.
 */
export interface PluginRenderDataContext {
  readonly db: D1Database;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly site: PluginSiteSettings;
  readonly locale: string;
  readonly path: string;
  /** Content pages: the item being rendered. Home and list pages: null. */
  readonly content: {
    readonly id: string;
    readonly kind: string;
    readonly translationGroup: string;
    readonly frontmatter: Readonly<Record<string, unknown>>;
  } | null;
  /**
   * Home and list pages: the items shown on this page, so one `IN` query
   * covers them. Empty on a content page.
   */
  readonly items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly translationGroup: string;
  }[];
}

/** The draft `onContentSave` sees before anything is written (§5.4). */
export interface ContentDraft {
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly title: string;
  readonly markdown: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly status: string;
}

/** Body already parsed and, when declared, Turnstile already verified (§7.2). */
/** The content a delete removed, as `onContentDelete` is told (§5.7). */
export interface ContentDeleteRef {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly translationGroup: string;
  /**
   * True when this was the last language of its translation group: nothing
   * of the item is left, in any language.
   */
  readonly lastInGroup: boolean;
}

export interface RouteInput {
  /** Form fields, or the string-valued top-level members of a JSON body. */
  readonly fields: Readonly<Record<string, string>>;
  /** What the route's `:parameters` captured, percent-decoded. */
  readonly params: Readonly<Record<string, string>>;
  /**
   * The body of an `application/json` request, whole: numbers, booleans and
   * nested values included. `undefined` for a form or a GET. Unvalidated.
   */
  readonly json: unknown;
}

export type PluginMarkdownRoot = MdastRoot;

export interface PluginHooks {
  readonly onRequest?: (
    request: Request,
    ctx: PluginRequestContext,
  ) => Promise<Response | undefined>;
  readonly beforeRender?: (
    tree: PluginMarkdownRoot,
    ctx: {
      readonly frontmatter: Readonly<Record<string, unknown>>;
      readonly settings?: Readonly<Record<string, unknown>>;
    },
  ) => void | Promise<void>;
  readonly afterRender?: (
    html: string,
    ctx: PluginRenderContext,
  ) => string | Promise<string>;
  readonly onContentSave?: (
    draft: ContentDraft,
    ctx: PluginContext,
  ) =>
    | undefined
    | Partial<Pick<ContentDraft, 'markdown'>>
    | Promise<undefined | Partial<Pick<ContentDraft, 'markdown'>>>;
  /**
   * Called after content has been deleted, so a plugin can remove what it
   * kept for it. The delete has already happened and cannot be refused.
   */
  readonly onContentDelete?: (
    ref: ContentDeleteRef,
    ctx: PluginContext,
  ) => void | Promise<void>;
  readonly scheduled?: (ctx: PluginContext) => Promise<void>;
  /**
   * Reads what this plugin shows on the page being rendered. The result must
   * be JSON-serialisable; templates see it as `plugins.<plugin_id>`.
   */
  readonly renderData?: (
    ctx: PluginRenderDataContext,
  ) => Promise<Readonly<Record<string, unknown>> | undefined>;
}

/**
 * What a `"render": "page"` route returns for the theme to render (§7.2).
 *
 * `view` reaches the layout as `plugin_page`, as plain JSON data. A handler
 * may still return a `Response` — a redirect after a POST, typically.
 */
export interface PluginPageResult {
  readonly view: Readonly<Record<string, unknown>>;
  /** The page's title; the site's name when absent. */
  readonly title?: string;
  readonly description?: string;
  /** Defaults to 200. */
  readonly status?: number;
  /** Extra response headers, such as `set-cookie`. Caching is not yours to set. */
  readonly headers?: HeadersInit;
}

export type PluginRouteHandler = (
  input: RouteInput,
  ctx: PluginRequestContext,
) => Promise<Response | PluginPageResult>;

export interface PluginMigration {
  readonly id: string;
  readonly sql: string;
}

/** A record as a records panel's `save` handler receives it (§7.5). */
export interface PluginRecordInput {
  /** The id of the record being edited, or `null` for a new one. */
  readonly id: string | null;
  /**
   * The declared fields, already checked against their declarations: an
   * empty optional field is `null`, a `money` field is a `MoneyValue`, a
   * `rows` field is an array of objects.
   */
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * For a panel attached to content (`attachTo`): the item the record
   * belongs to. `null` for a panel that is not attached. The core has
   * checked that content of that kind with that translation group exists.
   */
  readonly attachedTo: {
    readonly translationGroup: string;
    readonly kind: string;
  } | null;
}

/**
 * What `save` answers: the record's id, or messages keyed by field for what
 * only the plugin can judge — a SKU that is already taken.
 */
export type PluginRecordSaved =
  | { readonly id: string }
  | { readonly errors: Readonly<Record<string, string>> };

/** The handlers behind one `records` panel (§7.5). */
export interface PluginRecordHandlers {
  /** The record for the edit form, in the shape `save` takes; `null` if gone. */
  readonly load: (
    id: string,
    ctx: PluginContext,
  ) => Promise<Readonly<Record<string, unknown>> | null>;
  readonly save: (
    record: PluginRecordInput,
    ctx: PluginContext,
  ) => Promise<PluginRecordSaved>;
  /** Without it the admin offers no delete. */
  readonly remove?: (id: string, ctx: PluginContext) => Promise<void>;
}

export interface PluginExportFile {
  readonly path: string;
  readonly text: string;
}

export interface PluginSecretVerdict {
  readonly ok: boolean;
  readonly message: string;
}

export interface PluginImplementation {
  readonly migrations?: readonly PluginMigration[];
  readonly hooks?: PluginHooks;
  readonly routes?: Readonly<Record<string, PluginRouteHandler>>;
  readonly exportFiles?: (
    ctx: PluginContext,
  ) => Promise<readonly PluginExportFile[]>;
  readonly checkSecrets?: Readonly<
    Record<string, (ctx: PluginContext) => Promise<PluginSecretVerdict>>
  >;
  /**
   * Background jobs this plugin can queue with `ctx.enqueue`, keyed by name
   * (§7.4). A handler may run more than once for one job and must be safe to
   * repeat; throwing makes the core try again later.
   */
  readonly jobs?: Readonly<
    Record<string, (payload: unknown, ctx: PluginContext) => Promise<void>>
  >;
  /**
   * Handlers of the plugin's `records` panels, keyed by panel id. Every
   * write the admin makes to a plugin's data goes through one of these.
   */
  readonly records?: Readonly<Record<string, PluginRecordHandlers>>;
  readonly actions?: Readonly<
    Record<
      string,
      (
        ids: readonly string[],
        ctx: PluginContext,
        /**
         * The values of the action's declared `params`, already checked
         * against them; `{}` for an action that declares none.
         */
        params: Readonly<Record<string, unknown>>,
      ) => Promise<Response | undefined>
    >
  >;
}

/** What {@link definePlugin} accepts: a plugin whose manifest is unparsed. */
export interface PluginInput extends PluginImplementation {
  readonly manifest: unknown;
}

/** A plugin compiled into this build. */
export interface MallokPlugin extends PluginImplementation {
  readonly manifest: PluginManifest;
}

/** A refusal from {@link definePlugin}, carrying what to do about it. */
export declare class PluginDefinitionError extends Error {
  readonly hint: string;
  constructor(message: string, hint: string);
}

/**
 * Validates and normalises a plugin. Call it once, at module scope.
 *
 * It runs the manifest through the same schema `plugin.json` goes through,
 * filling the defaults the runtime reads without checking — a hand-written
 * manifest with no `hooks` used to make the runtime throw
 * `Cannot read properties of undefined` on a visitor request, from inside
 * Mallok, naming nothing the author could act on.
 *
 * It also checks the two halves against each other: a hook the manifest
 * declares must be implemented, and an implemented hook must be declared.
 * Neither mistake is visible to a type system, and both are silent at run
 * time.
 *
 * ```ts
 * import { definePlugin } from 'mallok/worker';
 * import manifest from './plugin.json';
 *
 * export default definePlugin({ manifest, hooks: { … }, routes: { … } });
 * ```
 */
export declare function definePlugin(input: PluginInput): MallokPlugin;

/**
 * Escapes text for safe interpolation into HTML: `&`, `<`, `>`, `"` and `'`.
 *
 * For a plugin's own markup — a form it injects, the HTML body of an email.
 * Theme templates escape their output already and do not need it.
 */
export declare function escapeHtml(value: string): string;

/**
 * Renders a small plain-text Liquid template, such as an email body an
 * operator edits in the plugin's settings, against `data`.
 *
 * The engine is the restricted one themes use: unknown filters are an error,
 * only own properties are read, and parsing and memory are bounded. The output
 * is **text and is not HTML-escaped**; for an HTML body, build the markup
 * yourself and pass each value through {@link escapeHtml}.
 */
export declare function renderTextTemplate(
  source: string,
  data: Readonly<Record<string, unknown>>,
): Promise<string>;

/** The five official themes, ready to pass to {@link createMallok}. */
export declare const atelier: BundledTheme;
export declare const folio: BundledTheme;
export declare const gazette: BundledTheme;
export declare const journal: BundledTheme;
export declare const manual: BundledTheme;

/** The official inquiry plugin (docs/PLUGIN_API.md §9). */
export declare const inquiry: MallokPlugin;

/**
 * Builds a theme from a project's own files.
 *
 * The five official themes above are ready-made; this is for a theme that
 * lives in the site's repository. `files` is keyed by the theme's own paths
 * (`layouts/base.liquid`, `partials/header.liquid`, `locales/en.json`), with
 * the file's text as the value — `wrangler.jsonc` already declares the Text
 * rule that makes those imports strings.
 *
 * The manifest is validated here rather than at first render: a typo in
 * `theme.json` should fail the build, not the site.
 */
export declare function defineTheme(
  manifest: unknown,
  files: Readonly<Record<string, string>>,
): BundledTheme;

/** One example document a starter ships, with its translations. */
export interface StarterDocument {
  readonly kind: string;
  /** Slug in the site's default locale. */
  readonly slug: string;
  /** Full `index.md` text, stored verbatim like any other content. */
  readonly markdown: string;
  /**
   * Other locales of the same item, keyed by locale. They join the
   * default-locale item's translation group.
   */
  readonly translations?: Readonly<
    Record<string, { readonly slug: string; readonly markdown: string }>
  >;
}

/**
 * One sample record for a plugin that keeps data of its own
 * (docs/PLUGIN_API.md §7.5). The wizard hands `values` to the `save` handler
 * of the plugin's `records` panel, after checking them against the panel's
 * fields — what happens when someone fills in that form in the admin.
 */
export interface StarterRecord {
  /** The plugin's id. It must be one of the starter's `plugins`. */
  readonly plugin: string;
  /** The id of one of that plugin's `records` panels. */
  readonly panel: string;
  /** The panel's fields, as its form would submit them. */
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * For a panel attached to content (`attachTo`): the starter document the
   * record belongs to, by its kind and its default-locale slug.
   */
  readonly attachedTo?: { readonly kind: string; readonly slug: string };
}

/** Settings a starter proposes for a fresh site. */
export interface StarterSettings {
  /** Languages the starter's content covers; added to the operator's own. */
  readonly locales?: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  readonly nav: Readonly<
    Record<string, readonly { label: string; href: string }[]>
  >;
  readonly themeOptions: Readonly<Record<string, unknown>>;
  readonly tagline: string;
}

/** A starter, as the first-run wizard consumes it (docs/ARCHITECTURE.md §11). */
export interface Starter {
  /** Lower-case letters, digits and hyphens; unique in the site. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The id of the theme this starter's content and settings assume. */
  readonly theme: string;
  /** Ids of the plugins the wizard switches on. */
  readonly plugins: readonly string[];
  readonly settings: StarterSettings;
  readonly documents: readonly StarterDocument[];
  /** Sample plugin data, imported after the documents and in this order. */
  readonly records?: readonly StarterRecord[];
}

/** A starter as a site passes it to {@link createMallok}. */
export type StarterInput = Starter;

/** A refusal from {@link defineStarter} or from `createMallok({ starters })`. */
export declare class StarterDefinitionError extends Error {
  constructor(message: string);
}

/**
 * Checks a starter and returns it. Optional — `createMallok` checks every
 * starter it is given — but calling it where the starter is written puts the
 * error next to the mistake.
 */
export declare function defineStarter(input: Starter): Starter;

/** What a site declares about itself at build time. */
export interface MallokOptions {
  /** The theme this deployment renders with. */
  readonly theme: BundledTheme;
  /** Plugins compiled into this deployment. Defaults to none. */
  readonly plugins?: readonly PluginInput[];
  /**
   * Starters this site brings: example content, and sample data for its
   * plugins, that the first-run wizard offers before the one Mallok ships
   * (docs/ARCHITECTURE.md §11). Defaults to none.
   */
  readonly starters?: readonly StarterInput[];
}

/**
 * Declares a site's composition and returns its Worker handler.
 *
 * Call it once, at module scope, in the file `wrangler.jsonc` names as
 * `main`. Calling it inside a request would be too late: the theme is
 * compiled per isolate and plugin migrations run at boot.
 */
export declare function createMallok(
  options: MallokOptions,
): ExportedHandler<Env>;
