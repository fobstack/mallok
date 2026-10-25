import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Slugs of several segments within a kind (Task 50, itick M3;
 * docs/CONTENT_FORMAT.md §3.1): `/en/rest-api/crypto/crypto-quote` is the
 * `rest-api` item with the slug `crypto/crypto-quote`. Run on a site that
 * prefixes its default locale, as itick.dev's docs site does.
 */

const ORIGIN = 'https://nested.example';
const EMAIL = 'nested@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

interface Saved {
  readonly id: string;
  readonly path: string;
  readonly translationGroup: string;
}

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

async function save(input: Record<string, unknown>): Promise<Response> {
  return api('POST', '/_mallok/api/content', input);
}

async function saved(input: Record<string, unknown>): Promise<Saved> {
  const response = await save(input);
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return (await response.json()) as Saved;
}

async function refusal(input: Record<string, unknown>): Promise<string> {
  const response = await save(input);
  expect(response.status).toBe(400);
  return ((await response.json()) as { error: string }).error;
}

async function get(path: string): Promise<Response> {
  await caches.default.delete(new Request(`${ORIGIN}${path}`));
  return SELF.fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
}

interface ExportFile {
  readonly path: string;
  readonly text?: string;
}

async function exportFiles(): Promise<Map<string, ExportFile>> {
  const response = await api('GET', '/_mallok/api/export');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { files: ExportFile[] };
  return new Map(body.files.map((file) => [file.path, file]));
}

const quote = (body = 'Latest price.') =>
  `---\ntitle: Crypto quote\n---\n\n## Request\n\n${body}\n`;

describe('slugs of several segments', () => {
  const ids: Record<string, string> = {};

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
        name: 'nested',
        scopes: ['content:write', 'settings:write', 'export'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    // The kinds a docs site declares. Atelier gives `faq` a list layout and
    // has none for the others, which is enough: the paths are the core's.
    expect(
      (
        await api('PATCH', '/_mallok/api/settings', {
          locales: ['en', 'zh-cn'],
          kinds: {
            page: { base: '' },
            article: { base: 'rest-api' },
            faq: { base: 'faq' },
            case: { base: '' },
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api('POST', '/_mallok/api/settings/locale-prefix', {
          enabled: true,
          confirm: true,
        })
      ).status,
    ).toBe(200);
  });

  it('serves an item at its base followed by every segment of its slug', async () => {
    const item = await saved({
      kind: 'article',
      slug: 'crypto/crypto-quote',
      markdown: quote(),
    });
    ids.quote = item.id;
    expect(item.path).toBe('/en/rest-api/crypto/crypto-quote');
    const page = await get('/en/rest-api/crypto/crypto-quote');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(
      `<link rel="canonical" href="${ORIGIN}/en/rest-api/crypto/crypto-quote">`,
    );
    expect(html).toContain('<h2 id="request">Request</h2>');

    const translated = await saved({
      kind: 'article',
      locale: 'zh-cn',
      slug: 'crypto/crypto-quote',
      translationGroup: item.translationGroup,
      markdown: '---\ntitle: 加密货币报价\n---\n\n最新价格。\n',
    });
    expect(translated.path).toBe('/zh-cn/rest-api/crypto/crypto-quote');
    expect(
      await (await get('/en/rest-api/crypto/crypto-quote')).text(),
    ).toContain(
      `hreflang="zh-cn" href="${ORIGIN}/zh-cn/rest-api/crypto/crypto-quote"`,
    );
  });

  it('takes the slug from front matter, slashes included', async () => {
    const item = await saved({
      kind: 'article',
      markdown:
        '---\ntitle: Symbol list\nslug: basics/symbol-list\n---\n\nAll.',
    });
    expect(item.path).toBe('/en/rest-api/basics/symbol-list');
  });

  it('serves a nested slug in a kind with no base, at the root of its locale', async () => {
    const item = await saved({
      kind: 'page',
      slug: 'guides/getting-started',
      markdown: '---\ntitle: Getting started\n---\n\nHello.',
    });
    expect(item.path).toBe('/en/guides/getting-started');
    expect((await get('/en/guides/getting-started')).status).toBe(200);
  });

  it('answers 404 at an intermediate address with no item of its own', async () => {
    expect((await get('/en/rest-api/crypto')).status).toBe(404);
    expect((await get('/en/guides')).status).toBe(404);
    // Unless an item has exactly that slug: a parent and its children are
    // independent items.
    const parent = await saved({
      kind: 'article',
      slug: 'crypto',
      markdown: '---\ntitle: Crypto\n---\n\nOverview.',
    });
    expect(parent.path).toBe('/en/rest-api/crypto');
    expect((await get('/en/rest-api/crypto')).status).toBe(200);
    expect((await get('/en/rest-api/crypto/crypto-quote')).status).toBe(200);
  });

  it('keeps list pages working beside nested items', async () => {
    await saved({
      kind: 'faq',
      slug: 'renewal',
      markdown: '---\ntitle: Renewal\n---\n\nYearly.',
    });
    expect((await get('/en/faq')).status).toBe(200);
    expect((await get('/en/faq/renewal')).status).toBe(200);
  });

  it('refuses a slug that would be a list page', async () => {
    expect(
      await refusal({
        kind: 'faq',
        slug: 'page/2',
        markdown: '---\ntitle: Two\n---\n\nX.',
      }),
    ).toContain('"page/2"');
    // `page` alone, or followed by a word, is an ordinary slug.
    await saved({
      kind: 'faq',
      slug: 'page/billing',
      markdown: '---\ntitle: Billing page\n---\n\nX.',
    });
  });

  it('refuses malformed slugs and names the value that would be accepted', async () => {
    expect(
      await refusal({
        kind: 'article',
        slug: 'Crypto/Crypto Quote',
        markdown: quote(),
      }),
    ).toContain('Use "crypto/crypto-quote"');
    expect(
      await refusal({ kind: 'article', slug: 'a//b', markdown: quote() }),
    ).toContain('empty segment');
    expect(
      await refusal({ kind: 'article', slug: '/a/b', markdown: quote() }),
    ).toContain('Use "a/b"');
    expect(
      await refusal({ kind: 'article', slug: 'a/b/c/d/e', markdown: quote() }),
    ).toContain('at most 4');
    expect(
      await refusal({
        kind: 'article',
        slug: 'crypto/行情',
        markdown: quote(),
      }),
    ).toContain('Segment 2');
  });

  it('refuses a first segment the site already answers, in a kind with no base', async () => {
    for (const [slug, reason] of [
      ['tags/x', 'answers that address itself'],
      ['media/x', 'answers that address itself'],
      ['rest-api/x', 'the kind "article"'],
      ['faq/x', 'the kind "faq"'],
      ['zh-cn/x', 'the language "zh-cn"'],
    ] as const) {
      expect(
        await refusal({
          kind: 'page',
          slug,
          markdown: '---\ntitle: Clash\n---\n\nX.',
        }),
      ).toContain(reason);
    }
    // A kind with a base nests under it, so the same words are harmless.
    await saved({
      kind: 'article',
      slug: 'tags/list',
      markdown: '---\ntitle: Tag list\n---\n\nX.',
    });
  });

  it('answers 409 naming the item that holds a path, not 500', async () => {
    const response = await save({
      kind: 'case',
      slug: 'guides/getting-started',
      markdown: '---\ntitle: Same path\n---\n\nX.',
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain(
      '/en/guides/getting-started is already the address of the page \\"guides/getting-started\\" (en)',
    );
  });

  it('keeps slugs unique per kind and locale, not across kinds', async () => {
    const other = await saved({
      kind: 'faq',
      slug: 'crypto/crypto-quote',
      markdown: '---\ntitle: The FAQ one\n---\n\nX.',
    });
    expect(other.path).toBe('/en/faq/crypto/crypto-quote');
  });

  it('lists nested items in the sitemap', async () => {
    const sitemap = await (await get('/sitemap.xml')).text();
    expect(sitemap).toContain(
      `<loc>${ORIGIN}/en/rest-api/crypto/crypto-quote</loc>`,
    );
    expect(sitemap).toContain(
      `<loc>${ORIGIN}/zh-cn/rest-api/crypto/crypto-quote</loc>`,
    );
    expect(sitemap).toContain(`<loc>${ORIGIN}/en/guides/getting-started</loc>`);
  });

  it('redirects from the old address when a nested slug changes', async () => {
    await saved({
      id: ids.quote,
      kind: 'article',
      slug: 'crypto/quote',
      markdown: quote('Latest price, renamed.'),
    });
    const old = await get('/en/rest-api/crypto/crypto-quote');
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe(
      `${ORIGIN}/en/rest-api/crypto/quote`,
    );
  });

  it('exports a nested slug in a flat folder and takes it back unchanged', async () => {
    const first = await exportFiles();
    const folder = 'content/article/crypto-quote';
    const markdown = first.get(`${folder}/index.md`)?.text;
    const identityText = first.get(`${folder}/mallok.json`)?.text ?? '';
    expect(markdown).toBe(quote('Latest price, renamed.'));
    const identity = JSON.parse(identityText) as {
      translation_group: string;
      items: Record<string, { id: string; slug: string; path: string }>;
    };
    expect(identity.items.en).toMatchObject({
      slug: 'crypto/quote',
      path: '/en/rest-api/crypto/quote',
    });
    expect(identity.items['zh-cn']?.slug).toBe('crypto/crypto-quote');

    // Into an empty site: remove the items, then save them back from the
    // export alone, the way `mallok publish` reads a bundle (the slug from
    // the identity, since the folder name is flattened).
    for (const locale of ['en', 'zh-cn']) {
      const id = identity.items[locale]?.id ?? '';
      expect((await api('DELETE', `/_mallok/api/content/${id}`)).status).toBe(
        200,
      );
    }
    for (const [locale, item] of Object.entries(identity.items)) {
      const file = locale === 'en' ? 'index.md' : `index.${locale}.md`;
      await saved({
        id: item.id,
        kind: 'article',
        locale,
        slug: item.slug,
        translationGroup: identity.translation_group,
        markdown: first.get(`${folder}/${file}`)?.text ?? '',
      });
    }

    const second = await exportFiles();
    expect(second.get(`${folder}/index.md`)?.text).toBe(markdown);
    expect(second.get(`${folder}/index.zh-cn.md`)?.text).toBe(
      first.get(`${folder}/index.zh-cn.md`)?.text,
    );
    const again = JSON.parse(
      second.get(`${folder}/mallok.json`)?.text ?? '{}',
    ) as typeof identity;
    expect(again.items.en?.slug).toBe('crypto/quote');
    expect(again.items.en?.path).toBe('/en/rest-api/crypto/quote');
    expect((await get('/en/rest-api/crypto/quote')).status).toBe(200);
    const stored = await env.DB.prepare(
      "SELECT slug FROM content WHERE kind = 'article' AND locale = 'zh-cn'",
    ).first<{ slug: string }>();
    expect(stored?.slug).toBe('crypto/crypto-quote');
  });
});
