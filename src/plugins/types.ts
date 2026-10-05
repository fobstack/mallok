/**
 * What a compiled-in plugin looks like to the runtime
 * (docs/PLUGIN_API.md §5–§7). Plugins are Worker-layer code: they may use
 * D1 and R2, so these types do not live in `src/core`.
 */

import type { Root as MdastRoot } from 'mdast';
import type {
  PluginManifest as CorePluginManifest,
  RecordField,
  RecordRowsField,
  RecordScalarField,
} from '../core/index.js';
import type { Migration } from '../db/migrate.js';
import type { SiteSettings } from '../worker/site.js';

export type { PluginHookName } from '../core/index.js';
export type PluginMigration = Migration;
export type PluginSiteSettings = SiteSettings;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** The manifest after validation; plugin code may read it, never mutate it. */
export type PluginManifest = DeepReadonly<CorePluginManifest>;
export type PluginSettingDeclaration = PluginManifest['settings'][string];
export type PluginRouteDeclaration = PluginManifest['routes'][number];
export type PluginPanelDeclaration = PluginManifest['panels'][number];
export type PluginRecordField = DeepReadonly<RecordField>;
export type PluginRecordScalarField = DeepReadonly<RecordScalarField>;
export type PluginRecordRowsField = DeepReadonly<RecordRowsField>;
export type { MoneyValue } from '../core/index.js';

/** The real mdast root exposed to a pure `beforeRender` hook. */
export type PluginMarkdownRoot = MdastRoot;

/** An email handed to `ctx.sendEmail` (docs/PLUGIN_API.md §7.6). */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
}

/** Capabilities every plugin call receives. */
export interface PluginContext {
  readonly db: D1Database;
  readonly media: R2Bucket;
  /** This plugin's settings, validated against its manifest. */
  readonly settings: Readonly<Record<string, unknown>>;
  /** Decrypted secrets. Never logged, never returned to a client. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly site: SiteSettings;
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
}

/** Context for a plugin route call. */
export interface PluginRequestContext extends PluginContext {
  readonly request: Request;
  readonly url: URL;
  readonly locale: string;
  /** ISO country from the edge, when the platform provides it. */
  readonly country: string | null;
  /** `sha256(ip || MALLOK_SECRET)`; the raw address is never stored. */
  readonly ipHash: string | null;
}

/** Context for `afterRender`. Secrets are deliberately absent: it runs on
 * the visitor path and public markup never needs them. */
export interface PluginRenderContext {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly site: SiteSettings;
  readonly locale: string;
  readonly path: string;
  /** Kind and id of the content being rendered; null on home/list pages. */
  readonly content: { readonly id: string; readonly kind: string } | null;
}

/**
 * Context for `renderData` (docs/PLUGIN_API.md §5.6).
 *
 * `db` is not the plain binding: it allows one call per render — one query or
 * one `batch` — and refuses anything but a read. There are no secrets, for
 * the reason `afterRender` has none.
 */
export interface PluginRenderDataContext {
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

/** The draft `onContentSave` sees before anything is written. */
export interface ContentDraft {
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly title: string;
  readonly markdown: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly status: string;
}

/** The content a delete removed, as `onContentDelete` is told (docs/PLUGIN_API.md §5.7). */
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

/** Body already parsed and, when declared, Turnstile already verified. */
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

/** Hook implementations accepted by {@link definePlugin}. */
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
  readonly migrations?: readonly Migration[];
  readonly hooks?: PluginHooks;
  /** Handlers keyed by the route `path` declared in the manifest. */
  readonly routes?: Readonly<Record<string, PluginRouteHandler>>;
  readonly exportFiles?: (
    ctx: PluginContext,
  ) => Promise<readonly PluginExportFile[]>;
  readonly checkSecrets?: Readonly<
    Record<string, (ctx: PluginContext) => Promise<PluginSecretVerdict>>
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
      ) => Promise<Response | undefined>
    >
  >;
}

/** What `definePlugin` accepts before the manifest has been parsed. */
export interface PluginInput extends PluginImplementation {
  readonly manifest: unknown;
}

/** A compiled-in plugin: manifest plus implementation. */
export interface MallokPlugin extends PluginImplementation {
  readonly manifest: PluginManifest;
}
