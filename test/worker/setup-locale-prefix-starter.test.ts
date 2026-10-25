import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import type { Starter } from '../../src/starters/types.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { createMallok } from '../../src/worker/framework.js';

/**
 * A starter that prefixes the default locale (Task 49): the setting is
 * applied before the starter's documents are saved, so they land at their
 * prefixed paths and nothing redirects on a fresh site.
 */

const ORIGIN = 'https://prefix-starter.example';
const EMAIL = 'docs@example.com';
const PASSWORD = 'a sufficiently long password';

const docs: Starter = {
  id: 'docs',
  name: 'Docs',
  description: 'Every language under its prefix.',
  theme: 'atelier',
  plugins: [],
  settings: {
    tagline: '',
    locales: ['en', 'zh-cn'],
    prefixDefaultLocale: true,
    kinds: { page: { base: '' }, faq: { base: 'faq' } },
    nav: {},
    themeOptions: {},
  },
  documents: [
    {
      kind: 'page',
      slug: 'getting-started',
      markdown: '---\ntitle: Getting started\n---\n\nHello.',
      translations: {
        'zh-cn': {
          slug: 'getting-started',
          markdown: '---\ntitle: 快速开始\n---\n\n你好。',
        },
      },
    },
    {
      kind: 'faq',
      slug: 'renewal',
      markdown: '---\ntitle: Renewal\n---\n\nYearly.',
    },
  ],
  records: [],
};

let cookie = '';
let csrf = '';

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie === '' ? {} : { cookie, 'x-mallok-csrf': csrf }),
    },
    body: JSON.stringify(body),
  });
}

describe('a starter that prefixes the default locale', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };

  beforeAll(async () => {
    createMallok({
      theme: original.theme,
      plugins: [inquiryPlugin],
      starters: [docs],
    });
    resetBootForTests();
    await SELF.fetch(`${ORIGIN}/`);
    await post('/_mallok/api/setup/admin', {
      email: EMAIL,
      password: PASSWORD,
    });
    const session = await post('/_mallok/api/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    cookie = (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    csrf = ((await session.json()) as { csrf: string }).csrf;
    await post('/_mallok/api/setup/site', {
      name: 'Docs',
      defaultLocale: 'en',
      locales: ['en'],
    });
  });

  afterAll(() => {
    configure(original);
    resetBootForTests();
  });

  it('saves its documents at prefixed paths, with no redirect to make', async () => {
    const response = await post('/_mallok/api/setup/starter', {
      starter: 'docs',
    });
    expect(response.status).toBe(200);
    const rows = await env.DB.prepare(
      'SELECT path FROM content ORDER BY path',
    ).all<{ path: string }>();
    expect(rows.results.map((row) => row.path)).toEqual([
      '/en/faq/renewal',
      '/en/getting-started',
      '/zh-cn/getting-started',
    ]);
    const redirects = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM redirect',
    ).first<{ n: number }>();
    expect(redirects?.n).toBe(0);
    const site = await env.DB.prepare(
      'SELECT prefix_default_locale FROM site WHERE id = 1',
    ).first<{ prefix_default_locale: number }>();
    expect(site?.prefix_default_locale).toBe(1);
  });

  it('serves the site under the prefix, and the root only redirects', async () => {
    const root = await SELF.fetch(`${ORIGIN}/`, { redirect: 'manual' });
    expect(root.status).toBe(301);
    expect(root.headers.get('location')).toBe(`${ORIGIN}/en`);
    expect((await SELF.fetch(`${ORIGIN}/en/getting-started`)).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/getting-started`)).status).toBe(404);
  });
});
