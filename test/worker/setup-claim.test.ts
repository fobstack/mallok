import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Claiming a site: the one moment when a stranger can become its owner.
 *
 * This project runs with `MALLOK_REQUIRE_SETUP_KEY=true` and **no**
 * `MALLOK_SETUP_KEY`, which is the state a site is in between its first
 * deploy and its secrets being set. A site in that state must refuse to be
 * claimed at all — not fall back to "no key configured, anyone may proceed",
 * which is precisely the window an automated scanner needs.
 */

const ORIGIN = 'https://claim.example';

async function bootstrap(body: Record<string, unknown>): Promise<Response> {
  return await SELF.fetch(`${ORIGIN}/_mallok/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('a site that requires a key it has not been given', () => {
  it('refuses to create an administrator at all', async () => {
    const response = await bootstrap({
      email: 'scanner@example.com',
      password: 'a-sufficiently-long-password',
    });

    // 503, not 403: the site is not misconfigured by the caller, it is not
    // ready. Either way it must not be claimable.
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body.toLowerCase()).toContain('not finished');
  });

  it('refuses even when a key is supplied', async () => {
    // There is nothing to compare against. Accepting anything here would mean
    // the first caller to guess *any* string wins.
    const response = await bootstrap({
      email: 'scanner@example.com',
      password: 'a-sufficiently-long-password',
      setupKey: 'anything-at-all',
    });

    expect(response.status).toBe(503);
  });

  it('says so on the public status endpoint', async () => {
    const status = await SELF.fetch(`${ORIGIN}/_mallok/api/setup/status`);
    const body = (await status.json()) as {
      requiresSetupKey: boolean;
      ready: boolean;
    };

    expect(body.requiresSetupKey).toBe(true);
    // The wizard needs to be able to say "this site is not ready yet" rather
    // than presenting a form that cannot succeed.
    expect(body.ready).toBe(false);
  });

  it('creates no administrator as a side effect of any of that', async () => {
    const admins = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM admin_user',
    ).first<{ n: number }>();

    expect(admins?.n).toBe(0);
  });
});
