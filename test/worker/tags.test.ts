import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Tag archives (docs/CONTENT_FORMAT.md §3.1).
 *
 * `tags` is a general front-matter field, so an archive lists **across
 * kinds** — a product and an article carrying the same tag appear together.
 */

const ORIGIN = 'https://tags.example';
const EMAIL = 'tags@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

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

describe('tag archives', () => {
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
        name: 'tags',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    await api('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'de'],
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: 'products' },
      },
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'tagged-article',
      markdown:
        '---\ntitle: Tagged article\ntags: [titanium, aerospace]\n---\n\nBody.',
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'product',
      slug: 'tagged-product',
      markdown: '---\ntitle: Tagged product\ntags: [titanium]\n---\n\nBody.',
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'untagged',
      markdown: '---\ntitle: No tags here\n---\n\nBody.',
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'draft-tagged',
      markdown:
        '---\ntitle: Draft\ndraft: true\ntags: [titanium]\n---\n\nBody.',
      status: 'draft',
    });
  });

  it('lists every kind carrying the tag', async () => {
    const page = await SELF.fetch(`${ORIGIN}/tags/titanium`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Tagged article');
    expect(html).toContain('Tagged product');
    expect(html).not.toContain('No tags here');
  });

  it('never shows a draft', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/tags/titanium`)).text();
    expect(html).not.toContain('>Draft<');
  });

  it('names the tag as the page title', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/tags/aerospace`)).text();
    expect(html).toMatch(/<h1[^>]*>aerospace<\/h1>/);
  });

  it('404s for a tag nobody uses', async () => {
    // Otherwise every string anyone types becomes a thin page.
    expect((await SELF.fetch(`${ORIGIN}/tags/nonexistent`)).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/tags/`)).status).toBe(404);
  });

  it('is per locale', async () => {
    // The German locale has no tagged content, so its archive does not exist.
    expect((await SELF.fetch(`${ORIGIN}/de/tags/titanium`)).status).toBe(404);
  });

  it('carries its own cache tag', async () => {
    await caches.default.delete(new Request(`${ORIGIN}/tags/titanium`));
    const page = await SELF.fetch(`${ORIGIN}/tags/titanium`);
    expect(page.headers.get('cache-tag')).toBe('site,tag:en');
  });

  it('handles a tag needing URL encoding', async () => {
    await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'spaced-tag',
      markdown: '---\ntitle: Spaced\ntags: ["heat exchangers"]\n---\n\nBody.',
    });
    const page = await SELF.fetch(`${ORIGIN}/tags/heat%20exchangers`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Spaced');
  });
});
