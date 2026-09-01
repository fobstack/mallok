import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Checking a plugin's secret before it is needed for real.
 *
 * The core cannot tell a good Resend key from a bad one; the plugin declares
 * how (docs/PLUGIN_API.md §7.3). What matters here is that the stored value
 * never leaves the Worker — only the verdict does.
 */

const ORIGIN = 'https://secret-check.example';
const EMAIL = 'check@example.com';
const PASSWORD = 'a sufficiently long password';
const KEY = 're_live_supersecret_value';

let token = '';
const realFetch = globalThis.fetch;
let resendReply: { status: number; body: unknown } = { status: 200, body: {} };

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
      if (url.startsWith('https://api.resend.com/')) {
        return new Response(JSON.stringify(resendReply.body), {
          status: resendReply.status,
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
      resend_api_key: KEY,
    });
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('reports a working key and the verified sending domains', async () => {
    resendReply = {
      status: 200,
      body: { data: [{ name: 'example.com', status: 'verified' }] },
    };
    const response = await api(
      'POST',
      '/_mallok/api/plugins/inquiry/secrets/resend_api_key',
    );
    const verdict = (await response.json()) as { ok: boolean; message: string };
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain('example.com');
  });

  it('says the key works but no domain is verified', async () => {
    // The failure a trade site would otherwise discover on its first inquiry.
    resendReply = { status: 200, body: { data: [] } };
    const verdict = (await (
      await api('POST', '/_mallok/api/plugins/inquiry/secrets/resend_api_key')
    ).json()) as { ok: boolean; message: string };
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('no sending domain is verified');
  });

  it('reports a rejected key', async () => {
    resendReply = { status: 401, body: { message: 'invalid' } };
    const verdict = (await (
      await api('POST', '/_mallok/api/plugins/inquiry/secrets/resend_api_key')
    ).json()) as { ok: boolean; message: string };
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('rejected');
  });

  it('never returns the stored value', async () => {
    resendReply = {
      status: 200,
      body: { data: [{ name: 'example.com', status: 'verified' }] },
    };
    const text = await (
      await api('POST', '/_mallok/api/plugins/inquiry/secrets/resend_api_key')
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
});
