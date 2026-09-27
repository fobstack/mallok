import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A slug becomes a directory name in an export, so `saveContent` refuses any
 * value `slugify` would change. The admin normalises the field before saving
 * (`src/admin/slug.ts`), but the CLI and direct API callers reach this refusal,
 * and a rule stated without the value that would satisfy it is not actionable.
 */

const ORIGIN = 'https://slug-contract.example';
const EMAIL = 'slug@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

async function save(slug: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/api/content`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'article',
      slug,
      markdown: '---\ntitle: A slug test\n---\n\nShort body.',
      assets: {},
    }),
  });
}

describe('the stored slug contract', () => {
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
      body: JSON.stringify({ name: 'slug-test', scopes: ['content:write'] }),
    });
    token = ((await minted.json()) as { token: string }).token;
  });

  it('names the slug it would have accepted', async () => {
    const response = await save('ASTM B265');
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain('astm-b265');
  });

  it('says what to do when nothing usable can be derived', async () => {
    const response = await save('钛板');
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toMatch(/Latin/);
  });

  it('still accepts a canonical slug', async () => {
    const response = await save('astm-b265');
    expect(response.status).toBe(201);
  });
});
