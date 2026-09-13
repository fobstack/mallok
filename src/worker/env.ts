/** Bindings and secrets available to the Worker (see wrangler.jsonc). */
export interface Env {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  /** Site slug, informational only. */
  readonly MALLOK_SITE: string;
  /**
   * The custom domain this site was provisioned with, if any.
   *
   * Written into `wrangler.jsonc` by `mallok create --domain`, and copied into
   * `site.domain` when the wizard finishes. Provisioning knows the domain;
   * before this, the database only learned it if somebody typed it again in
   * the admin, and a site with a bound domain and an empty `site.domain`
   * emits canonical URLs for the wrong host.
   */
  readonly MALLOK_DOMAIN?: string;
  /** Random 32-byte secret set at deploy time. */
  readonly MALLOK_SECRET: string;
  /**
   * One-time credential for the first-run wizard, set by `mallok create`.
   *
   * A site without one refuses to create an administrator at all. That is the
   * **default** (docs/SECURITY.md §3.7): it used to depend on a var asking
   * for it, and the var's absence meant "let anyone in".
   */
  readonly MALLOK_SETUP_KEY?: string;
  /**
   * Local development only: allows the wizard to run with no setup key.
   *
   * A setup key is required by default (`admin-auth.ts`). This is the one way
   * to get a keyless wizard, spelled out in full so that nobody sets it by
   * accident: `assertUsableConfig` refuses a `wrangler.jsonc` carrying it,
   * the project shell never ships it, and `mallok create` will not deploy a
   * configuration containing it.
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
