/** Bindings and secrets available to the Worker (see wrangler.jsonc). */
export interface Env {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  /** Site slug, informational only. */
  readonly MALLOK_SITE: string;
  /** Random 32-byte secret set at deploy time. */
  readonly MALLOK_SECRET: string;
  /**
   * One-time credential for the first-run wizard, set by `mallok create`.
   *
   * Optional: a site deployed by hand has none, and the wizard then behaves
   * as it did before this existed (docs/SECURITY.md §4).
   */
  readonly MALLOK_SETUP_KEY?: string;
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
