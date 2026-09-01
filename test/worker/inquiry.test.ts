import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesSpamRules } from '../../src/plugins/inquiry/index.js';

/**
 * Outbound fetch is mocked by replacing `globalThis.fetch`: the Workers
 * Vitest integration removed its `fetchMock` export and documents global
 * fetch mocking as the replacement. `SELF` runs the Worker in this same
 * isolate, so the Worker's subrequests hit this stub.
 */
interface ResendRule {
  status: number;
  remaining: number;
}

const realFetch = globalThis.fetch;
const resendQueue: ResendRule[] = [];
const resendCalls: Record<string, unknown>[] = [];
const turnstileQueue: { success: boolean }[] = [];

function installFetchStub(): void {
  const stub = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      input instanceof Request ? input.url : new URL(String(input)).toString();
    if (url.startsWith('https://api.resend.com/')) {
      const rule = resendQueue[0];
      if (rule === undefined) {
        throw new Error('Unexpected Resend call.');
      }
      rule.remaining -= 1;
      if (rule.remaining === 0) {
        resendQueue.shift();
      }
      resendCalls.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      return new Response(JSON.stringify({ id: 'mock' }), {
        status: rule.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('https://challenges.cloudflare.com/')) {
      const verdict = turnstileQueue.shift();
      if (verdict === undefined) {
        throw new Error('Unexpected Turnstile call.');
      }
      return new Response(JSON.stringify(verdict), {
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected outbound fetch in test: ${url}`);
  };
  globalThis.fetch = stub as typeof fetch;
}

const ORIGIN = 'https://inquiry-test.example';
const EMAIL = 'owner@example.com';
const PASSWORD = 'a sufficiently long password';
const RESEND_KEY = 're_test_abcdefgh';

let token = '';
let productPath = '';
let productId = '';

async function api(
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

function submit(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/p/inquiry/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
}

const VALID = {
  name: 'Ada Buyer',
  email: 'buyer@example.net',
  company: 'Buyer GmbH',
  phone: '+49 151 000',
  message: 'Please quote 2t of grade 5 bar.',
  locale: 'en',
  source_path: '/products/grade-5-bar',
  website: '',
};

async function until(
  check: () => Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Condition not reached in time.');
}

async function forgetCached(path: string): Promise<void> {
  await caches.default.delete(new Request(`${ORIGIN}${path}`));
}

function mockResend(status: number, times: number): void {
  resendQueue.push({ status, remaining: times });
}

describe('inquiry plugin', () => {
  beforeAll(async () => {
    installFetchStub();

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
      body: JSON.stringify({
        name: 'inquiry-test',
        scopes: ['content:write', 'settings:write', 'export'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    await api('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: 'products' },
      },
    });
    await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: true,
    });
    await api('PATCH', '/_mallok/api/plugins/inquiry/settings', {
      recipient: 'sales@example.com',
      from_address: 'Acme <inquiry@example.com>',
      autoreply: true,
      thanks_path: '/thank-you',
    });
    await api('PUT', '/_mallok/api/plugins/inquiry/secrets', {
      resend_api_key: RESEND_KEY,
    });

    const created = await api('POST', '/_mallok/api/content', {
      kind: 'product',
      markdown:
        '---\ntitle: Grade 5 bar\ndescription: Titanium round bar.\n---\n\nSpecs here.\n\n[[inquiry]]\n',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; path: string };
    productId = body.id;
    productPath = body.path;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    expect(resendQueue).toEqual([]);
    expect(turnstileQueue).toEqual([]);
  });

  it('swaps the [[inquiry]] marker for the form at stage two', async () => {
    await forgetCached(productPath);
    const page = await (await SELF.fetch(`${ORIGIN}${productPath}`)).text();
    expect(page).toContain('<form class="mallok-inquiry"');
    expect(page).toContain('action="/_mallok/p/inquiry/submit"');
    expect(page).toContain(`name="content_id" value="${productId}"`);
    expect(page).toContain('name="website"');
    expect(page).not.toContain('[[inquiry]]');
    // No Turnstile sitekey configured: the page stays zero-JavaScript.
    expect(page).not.toContain('challenges.cloudflare.com');
  });

  it('keeps the marker paragraph in the stored Markdown', async () => {
    const detail = await SELF.fetch(
      `${ORIGIN}/_mallok/api/content/${productId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = (await detail.json()) as { markdown: string };
    expect(body.markdown).toContain('[[inquiry]]');
  });

  it('accepts a valid submission, stores it and queues both emails', async () => {
    mockResend(200, 2);
    const response = await submit({ ...VALID, content_id: productId });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/thank-you`);

    const row = await env.DB.prepare(
      'SELECT * FROM p_inquiry_inquiry WHERE email = ?',
    )
      .bind(VALID.email)
      .first<Record<string, unknown>>();
    expect(row?.status).toBe('new');
    expect(row?.content_id).toBe(productId);
    expect(row?.source_path).toBe(VALID.source_path);
    expect(row?.notify_job_id).toBeTruthy();
    expect(row?.autoreply_job_id).toBeTruthy();

    await until(async () => {
      const jobs = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM job WHERE type = 'email' AND status = 'done'",
      ).first<{ n: number }>();
      return jobs?.n === 2;
    });

    // One notification to the owner with Reply-To set to the buyer, one
    // confirmation to the buyer, both from the configured sender.
    expect(resendCalls).toHaveLength(2);
    const notify = resendCalls.find((call) => call.reply_to === VALID.email);
    const autoreply = resendCalls.find((call) => call.reply_to === undefined);
    expect(notify?.to).toEqual(['sales@example.com']);
    expect(notify?.from).toBe('Acme <inquiry@example.com>');
    expect(autoreply?.to).toEqual([VALID.email]);
    expect(String(notify?.text)).toContain(VALID.message);
  });

  it('silently drops a submission that filled the honeypot', async () => {
    const response = await submit({
      ...VALID,
      email: 'bot@example.net',
      website: 'https://spam.example',
    });
    expect(response.status).toBe(302);
    const row = await env.DB.prepare(
      'SELECT id FROM p_inquiry_inquiry WHERE email = ?',
    )
      .bind('bot@example.net')
      .first();
    expect(row).toBeNull();
  });

  it('rejects a submission without a usable email', async () => {
    const response = await submit({ ...VALID, email: 'not-an-email' });
    expect(response.status).toBe(400);
  });

  it('applies country and keyword spam rules', () => {
    const settings = {
      blocked_countries: ['ru'],
      blocked_keywords: ['casino'],
    };
    expect(matchesSpamRules(settings, { country: 'RU', text: 'hello' })).toBe(
      true,
    );
    expect(
      matchesSpamRules(settings, { country: 'DE', text: 'Best CASINO deal' }),
    ).toBe(true);
    expect(matchesSpamRules(settings, { country: 'DE', text: 'hello' })).toBe(
      false,
    );
    expect(matchesSpamRules({}, { country: 'RU', text: 'casino' })).toBe(false);
  });

  it('stores a keyword match as spam and sends no email', async () => {
    await api('PATCH', '/_mallok/api/plugins/inquiry/settings', {
      recipient: 'sales@example.com',
      from_address: 'Acme <inquiry@example.com>',
      autoreply: true,
      thanks_path: '/thank-you',
      blocked_keywords: ['crypto'],
    });
    // No Resend mock is queued: any send attempt would throw and fail this
    // request, so a 302 also proves nothing was sent.
    const response = await submit({
      ...VALID,
      email: 'spammer@example.net',
      message: 'Great CRYPTO opportunity',
    });
    expect(response.status).toBe(302);
    const row = await env.DB.prepare(
      'SELECT status, notify_job_id FROM p_inquiry_inquiry WHERE email = ?',
    )
      .bind('spammer@example.net')
      .first<{ status: string; notify_job_id: string | null }>();
    expect(row?.status).toBe('spam');
    expect(row?.notify_job_id).toBeNull();
  });

  it('renders an operator Liquid template for the autoreply', async () => {
    await api('PATCH', '/_mallok/api/plugins/inquiry/settings', {
      recipient: 'sales@example.com',
      from_address: 'Acme <inquiry@example.com>',
      autoreply: true,
      thanks_path: '/thank-you',
      autoreply_subject: 'Thanks from {{ site_name }}',
      autoreply_body: 'Dear {{ name }}, we saw: {{ message }}',
    });
    mockResend(200, 2);
    const response = await submit({ ...VALID, email: 'custom@example.net' });
    expect(response.status).toBe(302);
    await until(async () => {
      const jobs = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM job WHERE type = 'email' AND status = 'done'",
      ).first<{ n: number }>();
      return jobs?.n === 4;
    });
    const autoreply = resendCalls.find(
      (call) => Array.isArray(call.to) && call.to[0] === 'custom@example.net',
    );
    expect(autoreply?.subject).toBe('Thanks from My Mallok site');
    expect(String(autoreply?.text)).toBe(
      `Dear ${VALID.name}, we saw: ${VALID.message}`,
    );
  });

  it('keeps a failed send as a pending job with backoff', async () => {
    mockResend(500, 2);
    const response = await submit({
      ...VALID,
      email: 'retry@example.net',
    });
    expect(response.status).toBe(302);
    await until(async () => {
      const failed = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM job WHERE status = 'pending' AND attempts = 1",
      ).first<{ n: number }>();
      return failed?.n === 2;
    });
    const job = await env.DB.prepare(
      "SELECT last_error, run_at, updated_at FROM job WHERE status = 'pending' LIMIT 1",
    ).first<{ last_error: string; run_at: string; updated_at: string }>();
    expect(job?.last_error).toContain('500');
    expect(job !== null && job.run_at > job.updated_at).toBe(true);
  });

  it('lists inquiries in the admin panel and updates status via actions', async () => {
    const panel = await api(
      'GET',
      '/_mallok/api/plugins/inquiry/panels/inquiries?status=new',
    );
    expect(panel.status).toBe(200);
    const { rows } = (await panel.json()) as {
      rows: { id: string; email: string; status: string }[];
    };
    const mine = rows.find((row) => row.email === VALID.email);
    expect(mine).toBeDefined();

    const action = await api(
      'POST',
      '/_mallok/api/plugins/inquiry/panels/inquiries/actions/mark_spam',
      { ids: [mine?.id] },
    );
    expect(action.status).toBe(200);
    const updated = await env.DB.prepare(
      'SELECT status FROM p_inquiry_inquiry WHERE id = ?',
    )
      .bind(mine?.id)
      .first<{ status: string }>();
    expect(updated?.status).toBe('spam');
  });

  it('exports inquiries as CSV through the download action', async () => {
    const response = await api(
      'POST',
      '/_mallok/api/plugins/inquiry/panels/inquiries/actions/export_csv',
      { ids: [] },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const csv = await response.text();
    expect(csv).toContain(VALID.email);
    expect(csv.split('\r\n')[0]).toContain('email');
  });

  it('verifies Turnstile server-side once a secret is configured', async () => {
    await api('PATCH', '/_mallok/api/plugins/inquiry/settings', {
      recipient: 'sales@example.com',
      from_address: 'Acme <inquiry@example.com>',
      autoreply: false,
      turnstile_sitekey: '0x4AAAAAAA',
      thanks_path: '/thank-you',
    });
    await api('PUT', '/_mallok/api/plugins/inquiry/secrets', {
      turnstile_secret: '0x4BBBBBBB',
    });

    await forgetCached(productPath);
    const page = await (await SELF.fetch(`${ORIGIN}${productPath}`)).text();
    expect(page).toContain('data-sitekey="0x4AAAAAAA"');
    expect(page).toContain(
      'https://challenges.cloudflare.com/turnstile/v0/api.js',
    );

    const missing = await submit({ ...VALID, email: 'ts@example.net' });
    expect(missing.status).toBe(403);

    turnstileQueue.push({ success: false });
    const rejected = await submit({
      ...VALID,
      email: 'ts@example.net',
      'cf-turnstile-response': 'bad-token',
    });
    expect(rejected.status).toBe(403);

    turnstileQueue.push({ success: true });
    mockResend(200, 1);
    const accepted = await submit({
      ...VALID,
      email: 'ts@example.net',
      'cf-turnstile-response': 'good-token',
    });
    expect(accepted.status).toBe(302);
    const row = await env.DB.prepare(
      'SELECT status FROM p_inquiry_inquiry WHERE email = ?',
    )
      .bind('ts@example.net')
      .first<{ status: string }>();
    expect(row?.status).toBe('new');
  });

  it('hides the route again when the plugin is disabled', async () => {
    await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: false,
    });
    const response = await submit({ ...VALID, email: 'late@example.net' });
    expect(response.status).toBe(404);

    await forgetCached(productPath);
    const page = await (await SELF.fetch(`${ORIGIN}${productPath}`)).text();
    // With the plugin off, stage two leaves the marker paragraph alone.
    expect(page).toContain('[[inquiry]]');
    expect(page).not.toContain('mallok-inquiry');

    await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: true,
    });
  });
});
