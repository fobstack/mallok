import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from '../../src/db/migrate.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import { decryptSecret, encryptSecret } from '../../src/worker/secrets.js';
import { moveInquiryEmail } from '../../src/worker/site-email.js';

/**
 * Site-level email settings (docs/PLUGIN_API.md §7.6).
 *
 * The Resend key and sender address used to live in each plugin that sends
 * email, so a second sending plugin meant entering the same key twice. They
 * are a site setting now: entered once, encrypted like a plugin secret, and
 * never returned.
 */
const ORIGIN = 'https://site-email.example';
const EMAIL = 'mail@example.com';
const PASSWORD = 'a sufficiently long password';
const KEY = 're_site_key_abcdefgh';

const realFetch = globalThis.fetch;
let resendReply: { status: number; body: unknown } = { status: 200, body: {} };
let resendAuthorization = '';
const resendSends: { authorization: string; body: Record<string, unknown> }[] =
  [];
let settingsToken = '';
let publishToken = '';

async function api(
  token: string,
  method: string,
  path: string,
  body?: unknown,
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

function submitInquiry(email: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/p/inquiry/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: 'Ada Buyer',
      email,
      message: 'Please quote 2t of grade 5 bar.',
      locale: 'en',
      source_path: '/',
      website: '',
    }).toString(),
    redirect: 'manual',
  });
}

async function until(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Condition not reached in time.');
}

/** Waits for the email job of one inquiry and returns how it ended. */
async function jobFor(
  email: string,
): Promise<{ status: string; last_error: string | null }> {
  let job: { status: string; last_error: string | null } | null = null;
  await until(async () => {
    job = await env.DB.prepare(
      `SELECT job.status, job.last_error, job.attempts FROM job
         JOIN p_inquiry_inquiry AS i ON i.notify_job_id = job.id
        WHERE i.email = ? AND (job.status = 'done' OR job.attempts > 0)`,
    )
      .bind(email)
      .first();
    return job !== null;
  });
  if (job === null) {
    throw new Error('No job.');
  }
  return job;
}

/** Puts the inquiry plugin's state back to a known shape. */
async function setInquiryState(
  settings: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE plugin_state SET enabled = 1, settings = ?, secrets = ? WHERE plugin_id = 'inquiry'",
  )
    .bind(JSON.stringify(settings), JSON.stringify(secrets))
    .run();
}

describe('site email settings', () => {
  beforeAll(async () => {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url =
        input instanceof Request
          ? input.url
          : new URL(String(input)).toString();
      if (url.startsWith('https://api.resend.com/')) {
        resendAuthorization =
          new Headers(init?.headers).get('authorization') ?? '';
        if (url.endsWith('/emails')) {
          resendSends.push({
            authorization: resendAuthorization,
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          });
        }
        return new Response(JSON.stringify(resendReply.body), {
          status: resendReply.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected outbound fetch in test: ${url}`);
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
    const mint = async (scopes: string[]): Promise<string> => {
      const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
        method: 'POST',
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: scopes.join('+'), scopes }),
      });
      return ((await minted.json()) as { token: string }).token;
    };
    settingsToken = await mint(['settings:write']);
    publishToken = await mint(['content:write']);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('starts with nothing configured', async () => {
    const settings = (await (
      await api(settingsToken, 'GET', '/_mallok/api/settings')
    ).json()) as { email: unknown };
    expect(settings.email).toEqual({
      fromAddress: '',
      resendConfigured: false,
    });
  });

  it('refuses a token without settings:write', async () => {
    const response = await api(
      publishToken,
      'PUT',
      '/_mallok/api/settings/email',
      { fromAddress: 'Acme <hello@example.com>', resendApiKey: KEY },
    );
    expect(response.status).toBe(403);
    const check = await api(
      publishToken,
      'POST',
      '/_mallok/api/settings/email/check',
    );
    expect(check.status).toBe(403);
  });

  it('stores the key encrypted and never returns it', async () => {
    const saved = await api(
      settingsToken,
      'PUT',
      '/_mallok/api/settings/email',
      {
        fromAddress: 'Acme <hello@example.com>',
        resendApiKey: KEY,
      },
    );
    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    expect(savedText).not.toContain(KEY);
    expect(JSON.parse(savedText)).toEqual({
      fromAddress: 'Acme <hello@example.com>',
      resendConfigured: true,
    });

    const read = await (
      await api(settingsToken, 'GET', '/_mallok/api/settings')
    ).text();
    expect(read).not.toContain(KEY);
    expect((JSON.parse(read) as { email: unknown }).email).toEqual({
      fromAddress: 'Acme <hello@example.com>',
      resendConfigured: true,
    });

    const row = await env.DB.prepare(
      'SELECT email_from, email_resend_key FROM site WHERE id = 1',
    ).first<{ email_from: string; email_resend_key: string }>();
    expect(row?.email_from).toBe('Acme <hello@example.com>');
    expect(row?.email_resend_key).not.toContain(KEY);
    expect(row?.email_resend_key.length).toBeGreaterThan(KEY.length);
  });

  it('changes the sender without touching the key, and the reverse', async () => {
    await api(settingsToken, 'PUT', '/_mallok/api/settings/email', {
      fromAddress: 'Acme <orders@example.com>',
    });
    const before = await env.DB.prepare(
      'SELECT email_from, email_resend_key FROM site WHERE id = 1',
    ).first<{ email_from: string; email_resend_key: string }>();
    expect(before?.email_from).toBe('Acme <orders@example.com>');
    expect(before?.email_resend_key).not.toBeNull();

    await api(settingsToken, 'PUT', '/_mallok/api/settings/email', {
      resendApiKey: 're_another_key_12345',
    });
    const after = await env.DB.prepare(
      'SELECT email_from, email_resend_key FROM site WHERE id = 1',
    ).first<{ email_from: string; email_resend_key: string }>();
    expect(after?.email_from).toBe('Acme <orders@example.com>');
    expect(after?.email_resend_key).not.toBe(before?.email_resend_key);
  });

  it('checks the stored key against Resend without sending anything', async () => {
    await api(settingsToken, 'PUT', '/_mallok/api/settings/email', {
      resendApiKey: KEY,
    });
    resendReply = {
      status: 200,
      body: { data: [{ name: 'example.com', status: 'verified' }] },
    };
    const good = (await (
      await api(settingsToken, 'POST', '/_mallok/api/settings/email/check')
    ).json()) as { ok: boolean; message: string };
    expect(good.ok).toBe(true);
    expect(good.message).toContain('example.com');
    // The request Resend saw carried the key that was stored, decrypted.
    expect(resendAuthorization).toBe(`Bearer ${KEY}`);

    resendReply = { status: 401, body: { message: 'invalid' } };
    const bad = (await (
      await api(settingsToken, 'POST', '/_mallok/api/settings/email/check')
    ).json()) as { ok: boolean; message: string };
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('rejected');
    expect(bad.message).not.toContain(KEY);
  });

  it('removes the key when it is cleared', async () => {
    const cleared = await api(
      settingsToken,
      'PUT',
      '/_mallok/api/settings/email',
      { resendApiKey: null },
    );
    expect((await cleared.json()) as object).toMatchObject({
      resendConfigured: false,
    });
    const verdict = (await (
      await api(settingsToken, 'POST', '/_mallok/api/settings/email/check')
    ).json()) as { ok: boolean; message: string };
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('No key is stored');
  });

  it('rejects a body it does not understand', async () => {
    const response = await api(
      settingsToken,
      'PUT',
      '/_mallok/api/settings/email',
      { fromAddress: 42 },
    );
    expect(response.status).toBe(400);
  });

  describe('sending', () => {
    it('sends a plugin email with the site key and sender', async () => {
      await api(settingsToken, 'PUT', '/_mallok/api/settings/email', {
        fromAddress: 'Acme <hello@example.com>',
        resendApiKey: KEY,
      });
      // The plugin holds neither a key nor a sender of its own.
      await setInquiryState(
        { recipient: 'sales@example.com', autoreply: false },
        {},
      );
      resendReply = { status: 200, body: { id: 'mock' } };
      resendSends.length = 0;

      expect((await submitInquiry('site-key@example.net')).status).toBe(302);
      expect((await jobFor('site-key@example.net')).status).toBe('done');
      expect(resendSends).toHaveLength(1);
      expect(resendSends[0]?.authorization).toBe(`Bearer ${KEY}`);
      expect(resendSends[0]?.body.from).toBe('Acme <hello@example.com>');
    });

    it("prefers a plugin's own key and sender", async () => {
      // What a plugin written before site-level email keeps in its own state.
      await setInquiryState(
        {
          recipient: 'sales@example.com',
          from_address: 'Plugin <plugin@example.com>',
          autoreply: false,
        },
        {
          resend_api_key: await encryptSecret(
            env.MALLOK_SECRET,
            'inquiry',
            'resend_api_key',
            'plugin-own-key',
          ),
        },
      );
      resendSends.length = 0;

      await submitInquiry('plugin-key@example.net');
      expect((await jobFor('plugin-key@example.net')).status).toBe('done');
      expect(resendSends[0]?.authorization).toBe('Bearer plugin-own-key');
      expect(resendSends[0]?.body.from).toBe('Plugin <plugin@example.com>');
    });

    it('falls back to the site key when the plugin one cannot be read', async () => {
      await setInquiryState(
        { recipient: 'sales@example.com', autoreply: false },
        { resend_api_key: 'not-a-ciphertext' },
      );
      resendSends.length = 0;

      await submitInquiry('unreadable@example.net');
      expect((await jobFor('unreadable@example.net')).status).toBe('done');
      expect(resendSends[0]?.authorization).toBe(`Bearer ${KEY}`);
    });

    it('keeps the job and says why when no sender is configured', async () => {
      await api(settingsToken, 'PUT', '/_mallok/api/settings/email', {
        fromAddress: null,
      });
      await setInquiryState(
        { recipient: 'sales@example.com', autoreply: false },
        {},
      );
      resendSends.length = 0;

      expect((await submitInquiry('no-sender@example.net')).status).toBe(302);
      const job = await jobFor('no-sender@example.net');
      expect(job.status).toBe('pending');
      expect(job.last_error).toBe('No sender address is configured.');
      expect(resendSends).toHaveLength(0);
    });

    it('keeps the job and says why when no key is configured', async () => {
      await api(settingsToken, 'PUT', '/_mallok/api/settings/email', {
        fromAddress: 'Acme <hello@example.com>',
        resendApiKey: null,
      });

      expect((await submitInquiry('no-key@example.net')).status).toBe(302);
      const job = await jobFor('no-key@example.net');
      expect(job.status).toBe('pending');
      expect(job.last_error).toBe('No usable Resend API key is configured.');
      expect(resendSends).toHaveLength(0);
    });
  });

  describe('moving the inquiry key on upgrade', () => {
    /** Recreates what a site set up before site-level email looks like. */
    async function legacySite(
      site: { from: string | null; key: string | null },
      settings: Record<string, unknown>,
      secrets: Record<string, string>,
    ): Promise<void> {
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE site SET email_from = ?, email_resend_key = ? WHERE id = 1',
        ).bind(site.from, site.key),
        env.DB.prepare(
          "DELETE FROM migration WHERE id = '0005_move_inquiry_email'",
        ),
      ]);
      await setInquiryState(settings, secrets);
    }

    async function state(): Promise<{
      from: string | null;
      key: string | null;
      settings: Record<string, unknown>;
      secrets: Record<string, string>;
    }> {
      const site = await env.DB.prepare(
        'SELECT email_from, email_resend_key FROM site WHERE id = 1',
      ).first<{ email_from: string | null; email_resend_key: string | null }>();
      const plugin = await env.DB.prepare(
        "SELECT settings, secrets FROM plugin_state WHERE plugin_id = 'inquiry'",
      ).first<{ settings: string; secrets: string }>();
      return {
        from: site?.email_from ?? null,
        key: site?.email_resend_key ?? null,
        settings: JSON.parse(plugin?.settings ?? '{}') as Record<
          string,
          unknown
        >,
        secrets: JSON.parse(plugin?.secrets ?? '{}') as Record<string, string>,
      };
    }

    const legacyKey = (): Promise<string> =>
      encryptSecret(env.MALLOK_SECRET, 'inquiry', 'resend_api_key', KEY);

    it('moves the key and the sender, and removes the plugin copies', async () => {
      await legacySite(
        { from: null, key: null },
        {
          recipient: 'sales@example.com',
          from_address: 'Acme <inquiry@example.com>',
        },
        { resend_api_key: await legacyKey(), turnstile_secret: 'kept' },
      );

      const applied = await ensureMigrated(env.DB, [moveInquiryEmail(env)]);
      expect(applied).toEqual(['0005_move_inquiry_email']);

      const after = await state();
      expect(after.from).toBe('Acme <inquiry@example.com>');
      // Re-encrypted for the site: readable as the site's secret only.
      expect(
        await decryptSecret(
          env.MALLOK_SECRET,
          '@site',
          'resend_api_key',
          after.key ?? '',
        ),
      ).toBe(KEY);
      expect(
        await decryptSecret(
          env.MALLOK_SECRET,
          'inquiry',
          'resend_api_key',
          after.key ?? '',
        ),
      ).toBeNull();
      expect(after.secrets).toEqual({ turnstile_secret: 'kept' });
      expect(after.settings).toEqual({ recipient: 'sales@example.com' });

      // The admin sees it configured, and the moved key is the one checked.
      resendReply = {
        status: 200,
        body: { data: [{ name: 'example.com', status: 'verified' }] },
      };
      const verdict = (await (
        await api(settingsToken, 'POST', '/_mallok/api/settings/email/check')
      ).json()) as { ok: boolean };
      expect(verdict.ok).toBe(true);
      expect(resendAuthorization).toBe(`Bearer ${KEY}`);
    });

    it('runs once', async () => {
      const before = await state();
      expect(await ensureMigrated(env.DB, [moveInquiryEmail(env)])).toEqual([]);
      expect(await state()).toEqual(before);
    });

    it('never overwrites what the site already has', async () => {
      const siteKey = await encryptSecret(
        env.MALLOK_SECRET,
        '@site',
        'resend_api_key',
        'site-own-key',
      );
      const pluginKey = await legacyKey();
      await legacySite(
        { from: 'Site <site@example.com>', key: siteKey },
        { recipient: 'sales@example.com', from_address: 'Old <old@x.co>' },
        { resend_api_key: pluginKey },
      );

      await ensureMigrated(env.DB, [moveInquiryEmail(env)]);

      const after = await state();
      expect(after.from).toBe('Site <site@example.com>');
      expect(after.key).toBe(siteKey);
      // Left alone: the plugin's own values still win when it sends.
      expect(after.secrets).toEqual({ resend_api_key: pluginKey });
      expect(after.settings.from_address).toBe('Old <old@x.co>');
    });

    it('leaves a key it cannot decrypt where it is', async () => {
      await legacySite(
        { from: null, key: null },
        { recipient: 'sales@example.com' },
        { resend_api_key: 'not-a-ciphertext' },
      );

      const applied = await ensureMigrated(env.DB, [moveInquiryEmail(env)]);
      expect(applied).toEqual(['0005_move_inquiry_email']);

      const after = await state();
      expect(after.key).toBeNull();
      expect(after.secrets).toEqual({ resend_api_key: 'not-a-ciphertext' });
    });

    it('upgrades a database left by the previous release on the next request', async () => {
      // Exactly what rc.9 leaves behind: no email columns, neither migration
      // recorded, the key and sender inside the plugin.
      await env.DB.batch([
        env.DB.prepare('ALTER TABLE site DROP COLUMN email_from'),
        env.DB.prepare('ALTER TABLE site DROP COLUMN email_resend_key'),
        env.DB.prepare(
          "DELETE FROM migration WHERE id IN ('0004_site_email', '0005_move_inquiry_email')",
        ),
      ]);
      await setInquiryState(
        {
          recipient: 'sales@example.com',
          from_address: 'Acme <inquiry@example.com>',
          autoreply: false,
        },
        { resend_api_key: await legacyKey() },
      );
      resetBootForTests();

      const settings = (await (
        await api(settingsToken, 'GET', '/_mallok/api/settings')
      ).json()) as { email: unknown };
      expect(settings.email).toEqual({
        fromAddress: 'Acme <inquiry@example.com>',
        resendConfigured: true,
      });
      const after = await state();
      expect(after.secrets).toEqual({});

      // Delivery goes on with the moved key and sender.
      resendReply = { status: 200, body: { id: 'mock' } };
      resendSends.length = 0;
      await submitInquiry('upgraded@example.net');
      expect((await jobFor('upgraded@example.net')).status).toBe('done');
      expect(resendSends[0]?.authorization).toBe(`Bearer ${KEY}`);
      expect(resendSends[0]?.body.from).toBe('Acme <inquiry@example.com>');
    });

    it('does nothing on a site that never configured the plugin', async () => {
      await legacySite({ from: null, key: null }, {}, {});
      await ensureMigrated(env.DB, [moveInquiryEmail(env)]);
      const after = await state();
      expect(after.from).toBeNull();
      expect(after.key).toBeNull();
    });
  });
});
