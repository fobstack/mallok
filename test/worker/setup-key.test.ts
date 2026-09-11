import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * The race a deployed-but-unclaimed site used to lose.
 *
 * Between `wrangler deploy` and a person reaching the wizard, the site has no
 * administrator and its address is not secret: a `.workers.dev` name is
 * guessable, and certificate transparency publishes a custom domain within
 * minutes of its first request. Whoever posted to
 * `/_mallok/api/setup/admin` first became the administrator — of somebody
 * else's site.
 *
 * `mallok create` now sets a one-time `MALLOK_SETUP_KEY` and prints it once.
 * These tests run against a Worker whose environment has one.
 */

const ORIGIN = 'https://setup-key.example';
const KEY = 'a-one-time-setup-key-for-this-test';

async function bootstrap(body: Record<string, unknown>): Promise<Response> {
  return await SELF.fetch(`${ORIGIN}/_mallok/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('the first-run wizard, with a setup key', () => {
  it('says that it will ask for one', async () => {
    const status = await SELF.fetch(`${ORIGIN}/_mallok/api/setup/status`);
    const body = (await status.json()) as { requiresSetupKey: boolean };

    expect(status.status).toBe(200);
    expect(body.requiresSetupKey).toBe(true);
    // The status endpoint is public. It may say that a key is needed; it may
    // never say what the key is.
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('refuses to create an administrator without the key', async () => {
    const response = await bootstrap({
      email: 'scanner@example.com',
      password: 'a-sufficiently-long-password',
    });

    expect(response.status).toBe(403);
    const body = (await response.text()).toLowerCase();
    expect(body).toContain('setup key');
    // The refusal must not be a hint about the value.
    expect(body).not.toContain(KEY.toLowerCase());
  });

  it('refuses a wrong key', async () => {
    const response = await bootstrap({
      email: 'scanner@example.com',
      password: 'a-sufficiently-long-password',
      setupKey: 'not-the-key',
    });

    expect(response.status).toBe(403);
  });

  it('accepts the right key exactly once', async () => {
    const accepted = await bootstrap({
      email: 'owner@example.com',
      password: 'a-sufficiently-long-password',
      setupKey: KEY,
    });
    expect(accepted.status).toBe(201);

    // Spent. Even with the right key, and even if the administrator were
    // somehow removed, this route is closed.
    const replay = await bootstrap({
      email: 'second@example.com',
      password: 'a-sufficiently-long-password',
      setupKey: KEY,
    });
    expect(replay.status).toBe(409);

    const site = await env.DB.prepare(
      'SELECT setup_key_used_at FROM site',
    ).first<{ setup_key_used_at: string | null }>();
    expect(site?.setup_key_used_at).not.toBeNull();
  });
});

/**
 * The domain a site was provisioned with reaches the database.
 *
 * `site.domain` decides canonical URLs, hreflang and the sitemap. Before the
 * Worker was told its own domain, the database only learned it if somebody
 * retyped it in the admin — so a site serving example.com published canonical
 * links to its `.workers.dev` preview until they did.
 */
describe('provisioning and site.domain', () => {
  it('copies MALLOK_DOMAIN into the site row when setup finishes', async () => {
    // The administrator created by the test above, in this file's database.
    // Logging in as somebody else and skipping when that fails would be a
    // test that passes by doing nothing.
    const login = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@example.com',
        password: 'a-sufficiently-long-password',
      }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const csrf = ((await login.json()) as { csrf: string }).csrf;

    const site = await SELF.fetch(`${ORIGIN}/_mallok/api/setup/site`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-mallok-csrf': csrf,
      },
      body: JSON.stringify({
        name: 'Provisioned',
        defaultLocale: 'en',
        locales: ['en'],
      }),
    });
    expect(site.status).toBe(200);

    const finished = await SELF.fetch(`${ORIGIN}/_mallok/api/setup/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-mallok-csrf': csrf,
      },
      body: '{}',
    });
    expect(finished.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT domain, media_base_url FROM site',
    ).first<{ domain: string | null; media_base_url: string | null }>();
    expect(row?.domain).toBe('provisioned.example');
    // And the media domain is *not* invented: `media.provisioned.example` is
    // attached in the dashboard, so it is checked before it is written, and
    // this environment has nothing at that hostname.
    expect(row?.media_base_url ?? null).toBeNull();
  });
});
