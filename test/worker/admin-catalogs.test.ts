import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { preferredLanguages } from '../../src/worker/http.js';

/**
 * The theme and the plugins in the admin's interface language
 * (docs/THEME_FORMAT.md §10.1, docs/PLUGIN_API.md §7.8;
 * docs/ADMIN_I18N_AND_UI.md D4 and D5).
 *
 * The active theme here is `atelier`, and the plugin is the official
 * `inquiry`; both ship `admin/zh-CN.json`.
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

interface PluginsBody {
  readonly plugins: readonly {
    readonly id: string;
    readonly name: string;
    readonly settings: Record<string, { label?: string }>;
    readonly secrets: readonly { name: string; label: string }[];
    readonly panels: readonly {
      readonly label: string;
      readonly columns: readonly { field: string; label: string }[];
      readonly actions: readonly { id: string; label: string }[];
      readonly names?: Record<string, string>;
      readonly values?: Record<string, Record<string, string>>;
      readonly empty?: string;
    }[];
  }[];
}

async function inquiry(acceptLanguage?: string) {
  const response = await SELF.fetch(`${ORIGIN}/_mallok/api/plugins`, {
    headers: {
      cookie,
      ...(acceptLanguage === undefined
        ? {}
        : { 'accept-language': acceptLanguage }),
    },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as PluginsBody;
  const found = body.plugins.find((plugin) => plugin.id === 'inquiry');
  expect(found).toBeDefined();
  return found as PluginsBody['plugins'][number];
}

describe('the plugins, in the interface language', () => {
  it("lays the inquiry plugin's Chinese catalog over its declarations", async () => {
    const plugin = await inquiry('zh-CN');
    expect(plugin.name).toBe('询盘');
    expect(plugin.settings.recipient?.label).toBe('收件邮箱');
    expect(plugin.secrets[0]?.label).toBe('Turnstile 密钥');
    const panel = plugin.panels[0];
    expect(panel?.label).toBe('询盘');
    expect(panel?.columns.map((column) => column.label)).toEqual([
      '姓名',
      '邮箱',
      // The message is in the row since docs/ADMIN_SIMPLE.md §6.3.
      '留言',
      '国家',
      '状态',
      '收到时间',
    ]);
    // And says where inquiries come from while there are none.
    expect(panel?.empty).toBe(
      '还没有收到询盘。访客在联系页提交表单后，会显示在这里。',
    );
    expect(panel?.actions.map((action) => action.label)).toEqual([
      '标记为已回复',
      '标记为垃圾信息',
      '导出 CSV',
    ]);
    expect(panel?.names?.message).toBe('留言');
    expect(panel?.values?.status).toEqual({
      new: '新询盘',
      replied: '已回复',
      spam: '垃圾信息',
    });
  });

  it('serves the declarations as written without a catalog for the language', async () => {
    for (const header of [undefined, 'fr']) {
      const plugin = await inquiry(header);
      expect(plugin.name, String(header)).toBe('Inquiry');
      expect(plugin.panels[0]?.label).toBe('Inquiries');
      expect(plugin.panels[0]?.names).toEqual({});
      expect(plugin.panels[0]?.values).toEqual({});
    }
  });

  it('names the status values in English, so the filter can offer them', async () => {
    // The English catalog names nothing else; the declarations stand.
    const plugin = await inquiry('en');
    expect(plugin.name).toBe('Inquiry');
    expect(plugin.panels[0]?.names).toEqual({});
    expect(plugin.panels[0]?.values).toEqual({
      status: { new: 'New', replied: 'Replied', spam: 'Spam' },
    });
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
