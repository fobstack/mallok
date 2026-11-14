import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { preferredLanguages } from '../../src/worker/http.js';

/**
 * `GET /_mallok/api/theme` in the admin's interface language
 * (docs/THEME_FORMAT.md §10.1, docs/ADMIN_I18N_AND_UI.md D4).
 *
 * The active theme here is `atelier`, which ships `admin/zh-CN.json`.
 */

const ORIGIN = 'https://theme-catalog.example';
const EMAIL = 'admin@example.com';
const PASSWORD = 'a sufficiently long password';

interface ThemeBody {
  readonly kinds: Record<
    string,
    {
      label?: string;
      fields?: Record<string, { label?: string; group?: string }>;
    }
  >;
  readonly options: Record<string, { label: string }>;
  readonly name: string;
  readonly declared: {
    readonly kinds: ThemeBody['kinds'];
    readonly name: string;
  };
}

let cookie = '';

async function theme(acceptLanguage?: string): Promise<ThemeBody> {
  const response = await SELF.fetch(`${ORIGIN}/_mallok/api/theme`, {
    headers: {
      cookie,
      ...(acceptLanguage === undefined
        ? {}
        : { 'accept-language': acceptLanguage }),
    },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ThemeBody;
}

describe('the theme, in the interface language', () => {
  beforeAll(async () => {
    await SELF.fetch(`${ORIGIN}/`);
    const post = (path: string, body: unknown): Promise<Response> =>
      SELF.fetch(`${ORIGIN}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    await post('/_mallok/api/auth/bootstrap', {
      email: EMAIL,
      password: PASSWORD,
    });
    const login = await post('/_mallok/api/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  });

  it('lays the Chinese catalog over the declarations', async () => {
    const body = await theme('zh-CN');
    expect(body.kinds.product?.label).toBe('产品');
    expect(body.kinds.product?.fields?.grade?.label).toBe('牌号');
    expect(body.kinds.product?.fields?.grade?.group).toBe('规格');
    expect(body.options.hero_title?.label).toBe('首屏标题');
    // The theme's own name is not in its catalog, and stays as declared.
    expect(body.name).toBe('Atelier');
  });

  it('keeps what the theme wrote in `declared`, for the preview', async () => {
    const body = await theme('zh-CN');
    expect(body.declared.kinds.product?.label).toBe('Product');
    expect(body.declared.kinds.product?.fields?.grade?.label).toBe('Grade');
  });

  it('serves the declarations as written without a catalog for the language', async () => {
    for (const header of [undefined, 'en', 'fr-FR,fr;q=0.9', '*']) {
      const body = await theme(header);
      expect(body.kinds.product?.label, String(header)).toBe('Product');
      expect(body.kinds).toEqual(body.declared.kinds);
    }
  });

  it('follows the order and weights of Accept-Language', async () => {
    expect(
      (await theme('fr;q=0.9, zh-Hans-CN;q=0.95')).kinds.product?.label,
    ).toBe('产品');
  });
});

describe('preferredLanguages', () => {
  it('orders by weight, then by position, and drops what it cannot use', () => {
    expect(preferredLanguages('zh-CN,zh;q=0.9,en;q=0.8')).toEqual([
      'zh-CN',
      'zh',
      'en',
    ]);
    expect(preferredLanguages('en;q=0.5, de, fr;q=0.5')).toEqual([
      'de',
      'en',
      'fr',
    ]);
    expect(preferredLanguages('*, en;q=0, <x>')).toEqual([]);
    expect(preferredLanguages(null)).toEqual([]);
  });
});
