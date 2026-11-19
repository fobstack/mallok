import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Searching the admin's content list by title (docs/ADMIN_SIMPLE.md, G6):
 * `q` on `GET /_mallok/api/content` matches words in the title, with the
 * other filters, and takes what is typed literally.
 */

const ORIGIN = 'https://content-search.example';
const EMAIL = 'search@example.com';
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

describe('searching content by title', () => {
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
      body: JSON.stringify({ name: 'search-test', scopes: ['content:write'] }),
    });
    token = ((await minted.json()) as { token: string }).token;
    for (const [kind, slug, title] of [
      ['page', 'grade-5-bar', 'Grade 5 titanium bar'],
      ['page', 'grade-2-plate', 'Grade 2 titanium plate'],
      ['article', 'bar-news', 'Why bar prices move'],
      ['article', 'odd', '100% pure_titanium'],
    ] as const) {
      const saved = await api('POST', '/_mallok/api/content', {
        kind,
        slug,
        markdown: `---\ntitle: ${title}\n---\n\nBody.`,
        assets: {},
      });
      expect(saved.status).toBe(201);
    }
  });

  async function titles(query: string): Promise<string[]> {
    const response = await api('GET', `/_mallok/api/content?${query}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { title: string }[] };
    return body.items.map((item) => item.title).sort();
  }

  it('finds words anywhere in the title, whatever their case', async () => {
    expect(await titles('q=TITANIUM')).toEqual([
      '100% pure_titanium',
      'Grade 2 titanium plate',
      'Grade 5 titanium bar',
    ]);
  });

  it('narrows with the other filters', async () => {
    expect(await titles('q=bar&kind=page')).toEqual(['Grade 5 titanium bar']);
  });

  it('takes % and _ as typed, not as wildcards', async () => {
    expect(await titles(`q=${encodeURIComponent('100%')}`)).toEqual([
      '100% pure_titanium',
    ]);
    expect(await titles(`q=${encodeURIComponent('e_t')}`)).toEqual([
      '100% pure_titanium',
    ]);
    expect(await titles(`q=${encodeURIComponent('%')}&kind=page`)).toEqual([]);
  });

  it('lists everything when the box is empty or blank', async () => {
    expect(await titles('q=&kind=page')).toHaveLength(2);
    expect(
      await titles(`q=${encodeURIComponent('   ')}&kind=page`),
    ).toHaveLength(2);
  });
});
