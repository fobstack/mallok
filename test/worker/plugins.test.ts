import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../src/worker/secrets.js';

const ORIGIN = 'https://plugins-test.example';
const EMAIL = 'plugins@example.com';
const PASSWORD = 'a sufficiently long password';

let fullToken = '';
let readToken = '';

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = fullToken,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('plugin admin API', () => {
  beforeAll(async () => {
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
    const mint = async (scopes: string[]): Promise<string> => {
      const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
        method: 'POST',
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: `plugins-${scopes.length}`, scopes }),
      });
      return ((await minted.json()) as { token: string }).token;
    };
    fullToken = await mint(['content:write', 'settings:write', 'export']);
    readToken = await mint(['content:write']);
  });

  it('lists compiled-in plugins, disabled by default', async () => {
    const response = await api('GET', '/_mallok/api/plugins');
    expect(response.status).toBe(200);
    const { plugins } = (await response.json()) as {
      plugins: {
        id: string;
        enabled: boolean;
        official: boolean;
        hooks: string[];
        runsOnEveryRequest: boolean;
        secrets: { name: string; configured: boolean }[];
        values: Record<string, unknown>;
      }[];
    };
    const inquiry = plugins.find((plugin) => plugin.id === 'inquiry');
    expect(inquiry).toBeDefined();
    expect(inquiry?.enabled).toBe(false);
    expect(inquiry?.official).toBe(true);
    expect(inquiry?.hooks).toEqual(['afterRender']);
    expect(inquiry?.runsOnEveryRequest).toBe(false);
    // Declared setting defaults are seeded at boot.
    expect(inquiry?.values.autoreply).toBe(true);
    expect(inquiry?.values.thanks_path).toBe('/thank-you');
    expect(
      inquiry?.secrets.find((secret) => secret.name === 'resend_api_key')
        ?.configured,
    ).toBe(false);
  });

  it('refuses plugin management without the settings:write scope', async () => {
    const toggle = await api(
      'POST',
      '/_mallok/api/plugins/inquiry/enabled',
      { enabled: true },
      readToken,
    );
    expect(toggle.status).toBe(403);
    const secrets = await api(
      'PUT',
      '/_mallok/api/plugins/inquiry/secrets',
      { resend_api_key: 'x' },
      readToken,
    );
    expect(secrets.status).toBe(403);
  });

  it('rejects settings the manifest does not declare', async () => {
    const response = await api(
      'PATCH',
      '/_mallok/api/plugins/inquiry/settings',
      { recipient: 'sales@example.com', from_address: 'no@x.co', bogus: 1 },
    );
    expect(response.status).toBe(400);
  });

  it('stores settings and flips the enable switch instantly', async () => {
    const patched = await api(
      'PATCH',
      '/_mallok/api/plugins/inquiry/settings',
      {
        recipient: 'sales@example.com',
        from_address: 'Mallok <inquiry@example.com>',
        autoreply: true,
        thanks_path: '/thank-you',
      },
    );
    expect(patched.status).toBe(200);
    const toggled = await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: true,
    });
    expect(toggled.status).toBe(200);
    const list = await api('GET', '/_mallok/api/plugins');
    const { plugins } = (await list.json()) as {
      plugins: { id: string; enabled: boolean }[];
    };
    expect(plugins.find((plugin) => plugin.id === 'inquiry')?.enabled).toBe(
      true,
    );
  });

  it('encrypts stored secrets and never echoes their values', async () => {
    const value = 're_live_1234567890';
    const put = await api('PUT', '/_mallok/api/plugins/inquiry/secrets', {
      resend_api_key: value,
    });
    expect(put.status).toBe(200);
    const body = JSON.stringify(await put.json());
    expect(body).not.toContain(value);
    expect(body).toContain('resend_api_key');

    const row = await env.DB.prepare(
      "SELECT secrets FROM plugin_state WHERE plugin_id = 'inquiry'",
    ).first<{ secrets: string }>();
    expect(row?.secrets).not.toContain(value);
    const stored = JSON.parse(row?.secrets ?? '{}') as Record<string, string>;
    const decrypted = await decryptSecret(
      'test-secret-do-not-use',
      'inquiry',
      'resend_api_key',
      stored.resend_api_key ?? '',
    );
    expect(decrypted).toBe(value);

    const list = await api('GET', '/_mallok/api/plugins');
    const listBody = JSON.stringify(await list.json());
    expect(listBody).not.toContain(value);
  });

  it('rejects an undeclared secret name', async () => {
    const response = await api('PUT', '/_mallok/api/plugins/inquiry/secrets', {
      aws_key: 'nope',
    });
    expect(response.status).toBe(400);
  });

  it('scopes ciphertext to plugin and secret name', async () => {
    const secret = 'test-secret-do-not-use';
    const cipher = await encryptSecret(
      secret,
      'inquiry',
      'resend_api_key',
      'v',
    );
    expect(
      await decryptSecret(secret, 'inquiry', 'resend_api_key', cipher),
    ).toBe('v');
    // A different plugin or name derives a different key, so decryption fails
    // closed instead of leaking across plugins.
    expect(await decryptSecret(secret, 'other', 'resend_api_key', cipher)).toBe(
      null,
    );
    expect(
      await decryptSecret(secret, 'inquiry', 'turnstile_secret', cipher),
    ).toBe(null);
    expect(
      await decryptSecret(secret, 'inquiry', 'resend_api_key', 'garbage'),
    ).toBe(null);
  });

  it('returns 404 for a plugin not compiled into the build', async () => {
    const response = await api('POST', '/_mallok/api/plugins/ghost/enabled', {
      enabled: true,
    });
    expect(response.status).toBe(404);
  });
});
