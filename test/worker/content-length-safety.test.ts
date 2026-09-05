import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `AC-CONTENT-10` (docs/ACCEPTANCE.md §4, §14.2 item 7): stage-one rendering
 * measured 60–726 ms on real workerd across 2–128 KB of Markdown
 * (docs/tasks/TASK-01.md §5) — already past the Free plan's 10 ms CPU budget
 * at every size tested, with no length that guarantees safety. Past
 * `MAX_SAFE_RENDER_BYTES`, the save must skip rendering rather than risk the
 * platform killing the request mid-write: the item is stored as a draft,
 * nothing is lost, and the response says why.
 */

const ORIGIN = 'https://content-length-safety.example';
const EMAIL = 'safety@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

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

describe('the content-length safety net', () => {
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
    const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      method: 'POST',
      headers: {
        cookie,
        'x-mallok-csrf': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'safety-test', scopes: ['content:write'] }),
    });
    token = ((await minted.json()) as { token: string }).token;
  });

  it('saves oversized content as a draft instead of rendering it, and says why', async () => {
    // Just over 50 KB of body text, well past MAX_SAFE_RENDER_BYTES.
    const body = 'Titanium round bar, mill certified. '.repeat(1500);
    expect(body.length).toBeGreaterThan(50 * 1024);
    const markdown = `---\ntitle: An unusually long article\n---\n\n${body}`;

    const response = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'unusually-long',
      markdown,
      status: 'published', // requested published; the safety net overrides it
      assets: {},
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      path: string;
      status: string;
      warning?: string;
    };
    expect(created.status).toBe('draft');
    expect(created.warning).toContain('draft');
    expect(created.warning).toContain('CPU');

    // A draft never appears on a public URL (AC-CONTENT-05).
    const page = await SELF.fetch(`${ORIGIN}${created.path}`);
    expect(page.status).toBe(404);
  });

  it('renders and publishes normally when the body is a realistic size', async () => {
    const markdown =
      '---\ntitle: A normal-length article\n---\n\nJust a short body.';
    const response = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'normal-length',
      markdown,
      assets: {},
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      status: string;
      warning?: string;
    };
    expect(created.status).toBe('published');
    expect(created.warning).toBeUndefined();
  });
});
