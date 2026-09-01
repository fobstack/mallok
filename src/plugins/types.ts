/**
 * What a compiled-in plugin looks like to the runtime
 * (docs/PLUGIN_API.md §5–§7). Plugins are Worker-layer code: they may use
 * D1 and R2, so these types do not live in `src/core`.
 */

import type { Root as MdastRoot } from 'mdast';
import type { PluginManifest } from '../core/index.js';
import type { Migration } from '../db/migrate.js';
import type { SiteSettings } from '../worker/site.js';

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

/** A compiled-in plugin: manifest plus implementation. */
export interface MallokPlugin {
  readonly manifest: PluginManifest;
  readonly migrations?: readonly Migration[];
  readonly hooks?: {
    readonly onRequest?: (
      request: Request,
      ctx: PluginContext,
    ) => Promise<Response | undefined>;
    readonly beforeRender?: (
      tree: MdastRoot,
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
  };
  /** Handlers keyed by the route `path` declared in the manifest. */
  readonly routes?: Readonly<
    Record<
      string,
      (input: RouteInput, ctx: PluginRequestContext) => Promise<Response>
    >
  >;
  /**
   * Files this plugin adds to a site export (docs/CONTENT_FORMAT.md §5).
   *
   * The core does not know that inquiries exist; a plugin that owns business
   * data says so here, and the export includes it. Secrets and settings are
   * never exported, so this returns content only.
   */
  readonly exportFiles?: (
    ctx: PluginContext,
  ) => Promise<readonly { readonly path: string; readonly text: string }[]>;
  /**
   * Checks a configured secret, so a wrong key is found now rather than when
   * the first real message fails.
   *
   * Keyed by secret name. The check must be read-only or otherwise harmless
   * to repeat: it runs whenever someone presses the button.
   */
  readonly checkSecrets?: Readonly<
    Record<
      string,
      (ctx: PluginContext) => Promise<{ ok: boolean; message: string }>
    >
  >;
  /** Panel action handlers (docs/PLUGIN_API.md §7.5). */
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
