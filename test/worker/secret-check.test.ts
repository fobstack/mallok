import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Checking a plugin's secret before it is needed for real.
 *
 * The core cannot tell a good Turnstile secret from a bad one; the plugin declares
 * how (docs/PLUGIN_API.md §7.3). What matters here is that the stored value
 * never leaves the Worker — only the verdict does.
 */

const ORIGIN = 'https://secret-check.example';
const EMAIL = 'check@example.com';
const PASSWORD = 'a sufficiently long password';
// Deliberately not shaped like a real credential: `scripts/scan-secrets.mjs`
// scans the whole history for credential *shapes*, and a fixture that looks
// like the real thing trains everyone to wave the scanner through.
const KEY = 'fixture-not-a-credential-0123456789';

let token = '';
const realFetch = globalThis.fetch;
let turnstileReply: unknown = { success: false, 'error-codes': [] };

async function api(method: string, path: string, body?: unknown) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('checking a plugin secret', () => {
  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https://challenges.cloudflare.com/')) {
        return new Response(JSON.stringify(turnstileReply), {
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected outbound fetch: ${url}`);
    }) as typeof fetch;

    await SELF.fetch(`${ORIGIN}/`);
    await SELF.fetch(`${ORIGIN}/_mallok/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const cookie =
      (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const { csrf } = (await session.json()) as { csrf: string };
    const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'check', scopes: ['settings:write'] }),
    });
    token = ((await minted.json()) as { token: string }).token;
    await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: true,
    });
    await api('PUT', '/_mallok/api/plugins/inquiry/secrets', {
      turnstile_secret: KEY,
    });
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('reports a secret the provider accepts', async () => {
    // The check sends a deliberately invalid token, so "invalid response" with
    // no complaint about the secret is the passing answer.
    turnstileReply = {
      success: false,
      'error-codes': ['invalid-input-response'],
    };
    const response = await api(
      'POST',
      '/_mallok/api/plugins/inquiry/secrets/turnstile_secret',
    );
    const verdict = (await response.json()) as { ok: boolean; message: string };
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain('accepted');
  });

  it('reports a rejected secret', async () => {
    turnstileReply = {
      success: false,
      'error-codes': ['invalid-input-secret'],
    };
    const verdict = (await (
      await api('POST', '/_mallok/api/plugins/inquiry/secrets/turnstile_secret')
    ).json()) as { ok: boolean; message: string };
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('rejected');
  });

  it('never returns the stored value', async () => {
    const text = await (
      await api('POST', '/_mallok/api/plugins/inquiry/secrets/turnstile_secret')
    ).text();
    expect(text).not.toContain(KEY);
  });

  it('404s for a secret the plugin cannot check', async () => {
    const response = await api(
      'POST',
      '/_mallok/api/plugins/inquiry/secrets/nonexistent',
    );
    expect(response.status).toBe(404);
  });

  it('no longer checks a Resend key through the plugin', async () => {
    // The key is a site setting now (POST /settings/email/check).
    const response = await api(
      'POST',
      '/_mallok/api/plugins/inquiry/secrets/resend_api_key',
    );
    expect(response.status).toBe(404);
  });
});
