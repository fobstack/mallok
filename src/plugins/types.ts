/**
 * What a compiled-in plugin looks like to the runtime
 * (docs/PLUGIN_API.md §5–§7). Plugins are Worker-layer code: they may use
 * D1 and R2, so these types do not live in `src/core`.
 */

import type { Root as MdastRoot } from 'mdast';
import type { PluginManifest as CorePluginManifest } from '../core/index.js';
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
  /** Queues and sends via the configured provider; returns the job id. */
  readonly sendEmail: (message: EmailMessage) => Promise<string>;
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

/** Body already parsed and, when declared, Turnstile already verified. */
export interface RouteInput {
  readonly fields: Readonly<Record<string, string>>;
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
  readonly scheduled?: (ctx: PluginContext) => Promise<void>;
}

export type PluginRouteHandler = (
  input: RouteInput,
  ctx: PluginRequestContext,
) => Promise<Response>;

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
