import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { resetThemeCacheForTests } from '../../src/worker/theme-cache.js';

/**
 * A kind with an address and no list page (docs/THEME_FORMAT.md §7.4).
 *
 * A theme may give a kind a layout for its items and none for a list of
 * them. Its items are served under the kind's base; the base itself names
 * nothing, and used to answer 500.
 */

const ORIGIN = 'https://no-list.example';
const EMAIL = 'nolist@example.com';
const PASSWORD = 'a sufficiently long password';

describe('a kind the theme gives no list layout', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };
  let admin: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<Response>;

  beforeAll(async () => {
    const page = original.theme.manifest.kinds.page;
    if (page === undefined) {
      throw new Error('the theme under test declares a page kind');
    }
    configure({
      plugins: original.plugins,
      theme: {
        ...original.theme,
        manifest: {
          ...original.theme.manifest,
          kinds: {
            ...original.theme.manifest.kinds,
            // Laid out like a page, addressed under its own base, not listed.
            tool: { layout: page.layout },
          },
        },
      },
    });
    resetThemeCacheForTests();
    resetBootForTests();
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
    admin = (method, path, body) =>
      SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    await admin('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'de'],
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        tool: { base: 'tools' },
      },
    });
    for (const [kind, slug, title] of [
      ['tool', 'calculator', 'Weight calculator'],
      ['article', 'hello', 'Hello'],
    ]) {
      const created = await admin('POST', '/_mallok/api/content', {
        kind,
        slug,
        status: 'published',
        markdown: `---\ntitle: ${title}\n---\n\nBody.`,
      });
      expect(created.status).toBe(201);
    }
  });

  afterAll(() => {
    configure(original);
    resetThemeCacheForTests();
    resetBootForTests();
  });

  it('serves its items under the base', async () => {
    const response = await SELF.fetch(`${ORIGIN}/tools/calculator`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Weight calculator');
  });

  it('answers 404 with the themed page at the base itself, not 500', async () => {
    for (const path of ['/tools', '/tools/page/2']) {
      const response = await SELF.fetch(`${ORIGIN}${path}`);
      expect(response.status).toBe(404);
      const html = await response.text();
      // The theme's page, not a JSON error.
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('<html lang="en"');
    }
  });

  it('answers it in the language of the address', async () => {
    const response = await SELF.fetch(`${ORIGIN}/de/tools`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('<html lang="de"');
  });

  it('still lists a kind that has a list layout', async () => {
    const response = await SELF.fetch(`${ORIGIN}/news`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Hello');
  });
});
