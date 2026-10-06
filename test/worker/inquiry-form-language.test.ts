import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '../../src/plugins/define.js';
import { buildInquiryForm } from '../../src/plugins/inquiry/form.js';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { resetThemeCacheForTests } from '../../src/worker/theme-cache.js';

/**
 * The inquiry form speaks the page's language (docs/PLUGIN_API.md §5.3,
 * §9): its labels come from the active theme's language pack, key by key,
 * and from the plugin's own two languages where the theme has none.
 */

const ORIGIN = 'https://form-language.example';
const EMAIL = 'form@example.com';
const PASSWORD = 'a sufficiently long password';

/** What an `afterRender` hook was handed, by locale. */
const seen: Record<string, Readonly<Record<string, string>>> = {};
const witness = definePlugin({
  manifest: {
    id: 'witness',
    name: 'Witness',
    version: '1.0.0',
    hooks: ['afterRender'],
  },
  hooks: {
    afterRender: (html, ctx) => {
      seen[ctx.locale] = ctx.t;
      return html;
    },
  },
});

function labels(html: string): string[] {
  return [...html.matchAll(/<label>([^<]+)<br>/g)].map(
    (match) => match[1] ?? '',
  );
}

describe("the inquiry form's language", () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };

  beforeAll(async () => {
    configure({
      plugins: [inquiryPlugin, witness],
      theme: {
        ...original.theme,
        manifest: {
          ...original.theme.manifest,
          locales: [...original.theme.manifest.locales, 'de'],
        },
        files: {
          ...original.theme.files,
          // A German pack that names five of the six labels, one of them
          // blank, and one with markup in it.
          'locales/de.json': JSON.stringify({
            language_name: 'Deutsch',
            inquiry_name: 'Ihr Name',
            inquiry_email: 'E-Mail',
            inquiry_company: '   ',
            inquiry_message: 'Nachricht <b>hier</b>',
            inquiry_submit: 'Anfrage senden',
          }),
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
    const admin = (method: string, path: string, body: unknown) =>
      SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: {
          cookie,
          'x-mallok-csrf': csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    await admin('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'de', 'zh'],
    });
    for (const id of ['inquiry', 'witness']) {
      await admin('POST', `/_mallok/api/plugins/${id}/enabled`, {
        enabled: true,
      });
    }
    const first = await admin('POST', '/_mallok/api/content', {
      kind: 'page',
      slug: 'contact',
      status: 'published',
      markdown: '---\ntitle: Contact\n---\n\n[[inquiry]]\n',
    });
    expect(first.status).toBe(201);
    const { translationGroup } = (await first.json()) as {
      translationGroup: string;
    };
    for (const [locale, slug, title] of [
      ['de', 'kontakt', 'Kontakt'],
      ['zh', 'lianxi', '联系'],
    ]) {
      const saved = await admin('POST', '/_mallok/api/content', {
        kind: 'page',
        locale,
        slug,
        translationGroup,
        status: 'published',
        markdown: `---\ntitle: ${title}\n---\n\n[[inquiry]]\n`,
      });
      expect(saved.status).toBe(201);
    }
  });

  afterAll(() => {
    configure(original);
    resetThemeCacheForTests();
    resetBootForTests();
  });

  it("uses the theme's labels on a page in a language the theme has a pack for", async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/de/kontakt`)).text();
    expect(labels(html)).toEqual([
      'Ihr Name',
      'E-Mail',
      // Blank in the pack, and absent from it: the plugin's own text.
      'Company',
      'Phone / WhatsApp',
      // The theme's text is text, not markup.
      'Nachricht &lt;b&gt;hier&lt;/b&gt;',
    ]);
    expect(html).toContain('<button type="submit">Anfrage senden</button>');
  });

  it("keeps the plugin's own languages where the theme names no labels", async () => {
    expect(
      labels(await (await SELF.fetch(`${ORIGIN}/contact`)).text()),
    ).toEqual(['Your name', 'Email', 'Company', 'Phone / WhatsApp', 'Message']);
    expect(
      labels(await (await SELF.fetch(`${ORIGIN}/zh/lianxi`)).text()),
    ).toEqual(['姓名', '邮箱', '公司', '电话 / WhatsApp', '留言']);
  });

  it("hands every afterRender hook the page's language pack", () => {
    expect(seen.de?.inquiry_name).toBe('Ihr Name');
    expect(seen.de?.language_name).toBe('Deutsch');
    // What templates read as `t`, the theme's own keys included.
    expect(seen.en?.language_name).toBe(
      JSON.parse(original.theme.files['locales/en.json'] ?? '{}').language_name,
    );
    expect(seen.en?.inquiry_name).toBeUndefined();
  });

  it('builds the same form as before when it is given no pack', () => {
    const input = {
      locale: 'fr',
      path: '/fr/contact',
      contentId: null,
      sitekey: '',
    };
    expect(buildInquiryForm({ ...input, t: {} })).toBe(buildInquiryForm(input));
    expect(labels(buildInquiryForm(input))[0]).toBe('Your name');
  });
});
