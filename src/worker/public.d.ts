/**
 * The declarations published as `mallok/worker`.
 *
 * Shipped instead of the emitted declaration tree, which could not be
 * consumed. `tsc` follows every `.d.ts` it loads, and the emitted one reached
 * `zod`, `mdast` and `hast` through the core barrel — three packages the
 * published `mallok` does not depend on. Any site that turns `skipLibCheck`
 * off, which is what a careful project does, got three unresolved-module
 * errors before compiling a line of its own code.
 *
 * The alternative was to add those three to the package's dependencies. That
 * would make every site install a schema library, a Markdown AST and an HTML
 * AST in order to name a theme — for types that describe how a manifest is
 * *validated*, which is Mallok's business and not the site's.
 *
 * Hand-written declarations normally rot away from the code they describe.
 * These cannot: `test/types/public-surface.ts` type-checks the real
 * implementation against this file on every `pnpm typecheck`, and it fails if
 * a value export appears on one side and not the other, or if `Env` stops
 * matching exactly.
 */

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
  /** One-time credential for the first-run wizard, set by `mallok create`. */
  readonly MALLOK_SETUP_KEY?: string;
  /**
   * `"true"` on a site that insists on a setup key.
   *
   * A plain var rather than a secret, because it has to be readable in the
   * window where the secret is missing: that is when a site is claimable by a
   * stranger, and "no key configured" must then mean "refuse".
   */
  readonly MALLOK_REQUIRE_SETUP_KEY?: string;
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

/**
 * A plugin compiled into this build (docs/PLUGIN_API.md §5–§7).
 *
 * Also described by its manifest alone. A site *names* plugins; writing one
 * means working inside `src/plugins/` against the hooks the documentation
 * describes, and the context types those hooks receive are Worker-internal.
 */
export interface MallokPlugin {
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly pluginApi: number;
  };
}

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
  readonly plugins?: readonly MallokPlugin[];
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
