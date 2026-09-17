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
  | 'scheduled';

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
  readonly rateLimit: boolean;
}

export interface PluginPanelDeclaration {
  readonly id: string;
  readonly label: string;
  readonly type: 'table';
  readonly table: string;
  readonly columns: readonly {
    readonly field: string;
    readonly label: string;
    readonly type: 'text' | 'email' | 'datetime' | 'badge';
  }[];
  readonly filters: readonly string[];
  readonly detail: readonly string[];
  readonly orderBy: string;
  readonly actions: readonly {
    readonly id: string;
    readonly label: string;
    readonly type: 'update' | 'download';
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
  /** Queues and sends via the configured provider; returns the job id. */
  readonly sendEmail: (message: EmailMessage) => Promise<string>;
  readonly purgeTags: (tags: readonly string[]) => Promise<unknown>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
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
  readonly path: string;
  /** Kind and id of the content being rendered; null on home and list pages. */
  readonly content: { readonly id: string; readonly kind: string } | null;
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
export interface RouteInput {
  readonly fields: Readonly<Record<string, string>>;
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
  readonly scheduled?: (ctx: PluginContext) => Promise<void>;
}

export type PluginRouteHandler = (
  input: RouteInput,
  ctx: PluginRequestContext,
) => Promise<Response>;

export interface PluginMigration {
  readonly id: string;
  readonly sql: string;
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

/** What a site declares about itself at build time. */
export interface MallokOptions {
  /** The theme this deployment renders with. */
  readonly theme: BundledTheme;
  /** Plugins compiled into this deployment. Defaults to none. */
  readonly plugins?: readonly PluginInput[];
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
