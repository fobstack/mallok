import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A translation group holds one item per language (docs/DATA_MODEL.md §2.2).
 *
 * Saving into a group with a language it already has used to reach the
 * `UNIQUE (translation_group, locale)` constraint and answer 500: an admin
 * build that ignored the `?locale=` of "Create zh" saved a second English
 * item into the group. The save is refused with 409 naming the item that
 * holds that language, and nothing is written.
 */

const ORIGIN = 'https://translation-conflict.example';
const EMAIL = 'conflict@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

interface Saved {
  readonly id: string;
  readonly path: string;
  readonly translationGroup: string;
}

async function save(input: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/api/content`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

async function saved(input: Record<string, unknown>): Promise<Saved> {
  const response = await save(input);
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return (await response.json()) as Saved;
}

async function rowsIn(
  group: string,
): Promise<{ id: string; locale: string }[]> {
  const rows = await env.DB.prepare(
    'SELECT id, locale FROM content WHERE translation_group = ? ORDER BY locale',
  )
    .bind(group)
    .all<{ id: string; locale: string }>();
  return rows.results;
}

const page = (title: string) => `---\ntitle: ${title}\n---\n\n${title} body.\n`;

describe('saving a language a translation group already has', () => {
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
      body: JSON.stringify({
        name: 'conflict',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    const settings = await SELF.fetch(`${ORIGIN}/_mallok/api/settings`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ locales: ['en', 'zh'] }),
    });
    expect(settings.status).toBe(200);
  });

  it('answers 409 naming the item that holds the language, and writes nothing', async () => {
    const first = await saved({
      kind: 'page',
      slug: 'about-us',
      markdown: page('About us'),
    });

    const response = await save({
      kind: 'page',
      locale: 'en',
      slug: 'about-us-again',
      translationGroup: first.translationGroup,
      markdown: page('About us again'),
    });

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toBe(
      `This translation group already has an item in en: the page "about-us" at ${first.path} (id ${first.id}). Edit that item instead.`,
    );
    expect(await rowsIn(first.translationGroup)).toEqual([
      { id: first.id, locale: 'en' },
    ]);
    const stray = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM content WHERE slug = 'about-us-again'",
    ).first<{ n: number }>();
    expect(stray?.n).toBe(0);
  });

  it('still saves a language the group does not have yet', async () => {
    const first = await saved({
      kind: 'page',
      slug: 'contact',
      markdown: page('Contact'),
    });
    const second = await saved({
      kind: 'page',
      locale: 'zh',
      slug: 'contact',
      translationGroup: first.translationGroup,
      markdown: page('Contact zh'),
    });

    expect(second.translationGroup).toBe(first.translationGroup);
    expect(await rowsIn(first.translationGroup)).toEqual([
      { id: first.id, locale: 'en' },
      { id: second.id, locale: 'zh' },
    ]);
  });

  it('answers 409 when an item is moved to a language its group already has', async () => {
    const english = await saved({
      kind: 'page',
      slug: 'faq',
      markdown: page('FAQ'),
    });
    const chinese = await saved({
      kind: 'page',
      locale: 'zh',
      slug: 'faq',
      translationGroup: english.translationGroup,
      markdown: page('FAQ zh'),
    });

    const response = await save({
      id: chinese.id,
      kind: 'page',
      locale: 'en',
      slug: 'faq-zh',
      markdown: page('FAQ zh'),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain(
      `the page "faq" at ${english.path} (id ${english.id})`,
    );
    expect(await rowsIn(english.translationGroup)).toEqual([
      { id: english.id, locale: 'en' },
      { id: chinese.id, locale: 'zh' },
    ]);
  });

  it('lets an item be saved again in its own language', async () => {
    const item = await saved({
      kind: 'page',
      slug: 'terms',
      markdown: page('Terms'),
    });
    const again = await save({
      id: item.id,
      kind: 'page',
      slug: 'terms',
      translationGroup: item.translationGroup,
      markdown: page('Terms, revised'),
    });

    expect(again.status).toBe(200);
  });
});
