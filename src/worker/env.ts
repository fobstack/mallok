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
   * Optional: a site deployed by hand has none, and the wizard then behaves
   * as it did before this existed (docs/SECURITY.md §4).
   */
  readonly MALLOK_SETUP_KEY?: string;
  /**
   * `"true"` on a site that insists on a setup key.
   *
   * A plain var rather than a secret, because it has to be readable in the
   * window where the secret is missing: that is when a site is claimable by
   * a stranger, and when "no key configured" must mean "refuse" rather than
   * "let anyone in".
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
