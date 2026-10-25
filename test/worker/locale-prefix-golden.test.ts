import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import golden from '../fixtures/locale-prefix-off.json';

/**
 * Upgrade guarantee for Task 49 (itick M2): a site that leaves
 * `prefixDefaultLocale` off serves exactly the URLs it served before the
 * setting existed.
 *
 * `test/fixtures/locale-prefix-off.json` was recorded from this test on the
 * code before Task 49 (commit c6c6894). What is compared is every URL a
 * visitor or a crawler is given — stored paths, statuses, redirects, and each
 * `href`, `src`, `action`, `<loc>` and `<link>` in pages, sitemaps and feeds
 * — not whole pages, whose markup other tasks may change.
 */

const ORIGIN = 'https://prefix-golden.example';
const EMAIL = 'golden@example.com';
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

async function save(input: Record<string, unknown>): Promise<{
  path: string;
  translationGroup: string;
}> {
  const response = await api('POST', '/_mallok/api/content', input);
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as { path: string; translationGroup: string };
}

/** Every URL in a body, in document order, made relative to the origin. */
function urlsIn(body: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:\b(?:href|src|action)="([^"]*)")|(?:<loc>([^<]*)<\/loc>)|(?:<link>([^<]*)<\/link>)|(?:<guid[^>]*>([^<]*)<\/guid>)|(?:^(?:Sitemap|Allow|Disallow): (\S+)$)/gm;
  for (const match of body.matchAll(pattern)) {
    const url = match.slice(1).find((part) => part !== undefined) ?? '';
    found.push(url.replaceAll(ORIGIN, ''));
  }
  return found;
}

/** The addresses the fixture site answers, in both locales. */
const PATHS = [
  '/',
  '/zh',
  '/about',
  '/zh/about',
  '/en/about',
  '/notes',
  '/notes/page/2',
  '/zh/notes',
  '/notes/hello',
  '/zh/notes/hello',
  '/en/notes/hello',
  '/notes/second',
  '/products',
  '/products/widget',
  '/families/metals',
  '/tags/alpha',
  '/zh/tags/alpha',
  '/missing-page',
  '/sitemap.xml',
  '/feed.xml',
  '/zh/feed.xml',
  '/en/feed.xml',
  '/robots.txt',
];

describe('URLs with prefixDefaultLocale off', () => {
  const stored: Record<string, string> = {};

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
        name: 'golden',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    const settings = await api('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'zh'],
      kinds: {
        page: { base: '' },
        article: { base: 'notes' },
        product: { base: 'products' },
        category: { base: 'families' },
      },
      nav: {
        en: [{ label: 'Products', href: '/products' }],
        zh: [{ label: '产品', href: '/zh/products' }],
      },
    });
    expect(settings.status).toBe(200);

    const about = await save({
      kind: 'page',
      slug: 'about',
      markdown: '---\ntitle: About\n---\n\nAbout us.',
    });
    stored['page en about'] = about.path;
    stored['page zh about'] = (
      await save({
        kind: 'page',
        locale: 'zh',
        slug: 'about',
        translationGroup: about.translationGroup,
        markdown: '---\ntitle: 关于\n---\n\n关于我们。',
      })
    ).path;
    const hello = await save({
      kind: 'article',
      slug: 'hello',
      markdown:
        '---\ntitle: Hello\ndate: 2026-01-02T00:00:00Z\ntags: [alpha]\n---\n\n## Section\n\nBody.',
    });
    stored['article en hello'] = hello.path;
    stored['article zh hello'] = (
      await save({
        kind: 'article',
        locale: 'zh',
        slug: 'hello',
        translationGroup: hello.translationGroup,
        markdown:
          '---\ntitle: 你好\ndate: 2026-01-02T00:00:00Z\ntags: [alpha]\n---\n\n正文。',
      })
    ).path;
    stored['article en second'] = (
      await save({
        kind: 'article',
        slug: 'second',
        markdown:
          '---\ntitle: Second\ndate: 2026-01-03T00:00:00Z\ntags: [alpha]\n---\n\nMore.',
      })
    ).path;
    stored['category en metals'] = (
      await save({
        kind: 'category',
        slug: 'metals',
        markdown: '---\ntitle: Metals\n---\n\nMetals.',
      })
    ).path;
    stored['product en widget'] = (
      await save({
        kind: 'product',
        slug: 'widget',
        markdown: '---\ntitle: Widget\ncategory: metals\n---\n\nA widget.',
      })
    ).path;
  });

  it('serves the URLs recorded before the setting existed', async () => {
    const responses: Record<string, unknown> = {};
    for (const path of PATHS) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, {
        redirect: 'manual',
      });
      const body = await response.text();
      responses[path] = {
        status: response.status,
        location: (response.headers.get('location') ?? '').replaceAll(
          ORIGIN,
          '',
        ),
        // The sitemap is ordered by translation group, a random id, so its
        // URLs are compared as a set; everything else in document order.
        urls: path === '/sitemap.xml' ? urlsIn(body).sort() : urlsIn(body),
      };
    }
    const actual = { stored, responses };
    if (JSON.stringify(actual) !== JSON.stringify(golden)) {
      // What to write into the fixture when the change is intended.
      console.log(`GOLDEN ${JSON.stringify(actual)}`);
    }
    expect(actual).toEqual(golden);
  });
});
