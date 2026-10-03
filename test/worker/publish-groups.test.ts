import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SiteClient } from '../../src/cli/client.js';
import type { Reporter } from '../../src/cli/output.js';
import { publishBundles } from '../../src/cli/publish.js';
import type { Bundle, BundleDocument } from '../../src/cli/scan.js';

/**
 * One bundle is one translation group (docs/CONTENT_FORMAT.md §2, rule 1).
 *
 * `mallok publish` used to post each language of a bundle without
 * `mallok.json` on its own, and the server gave each a fresh group: a
 * four-language bundle landed as four unrelated pages with no hreflang and no
 * language switcher, while `mallok build` grouped the same files correctly.
 * This drives the CLI's real publish loop against the real Worker.
 */
const ORIGIN = 'https://publish-groups.example';
const EMAIL = 'groups@example.com';
const PASSWORD = 'a sufficiently long password';
const LOCALES = ['en', 'de', 'fr', 'es'] as const;

let token = '';

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return SELF.fetch(`${ORIGIN}/_mallok/api${path}`, { ...init, headers });
}

async function parsed<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** The CLI's client, speaking to the Worker under test. */
const client: SiteClient = {
  origin: ORIGIN,
  get: async <T>(path: string) => parsed<T>(await call(path)),
  post: async <T>(path: string, body: unknown) =>
    parsed<T>(
      await call(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  patch: async <T>(path: string, body: unknown) =>
    parsed<T>(
      await call(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  put: () => Promise.reject(new Error('not used')),
  bytes: () => Promise.reject(new Error('not used')),
};

const silent: Reporter = {
  json: false,
  step: () => {},
  warn: () => {},
  done: () => {},
};

function document(locale: string, title: string): BundleDocument {
  return {
    locale,
    fileName: locale === 'en' ? 'index.md' : `index.${locale}.md`,
    markdown: `---\ntitle: ${title}\n---\n\n${title} body.\n`,
    assets: new Map(),
    missing: [],
  };
}

/** A bundle as `scan` reads it from disk, with no `mallok.json`. */
function bundle(name: string, locales: readonly string[]): Bundle {
  return {
    name,
    dir: `/content/page/${name}`,
    kind: 'page',
    documents: locales.map((locale) => document(locale, `${name} ${locale}`)),
    identity: null,
    unfilledSlots: [],
  };
}

function publish(bundles: readonly Bundle[]) {
  return publishBundles(
    client,
    bundles,
    {
      mode: 'publish',
      draft: false,
      createOnly: false,
      dryRun: false,
      failOnMissing: false,
      widths: [],
      maxEdge: null,
      defaultLocale: 'en',
    },
    silent,
  );
}

async function groupsOf(slug: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT DISTINCT translation_group FROM content WHERE slug = ? ORDER BY translation_group',
  )
    .bind(slug)
    .all<{ translation_group: string }>();
  return rows.results.map((row) => row.translation_group);
}

describe('publishing a multilingual bundle without mallok.json', () => {
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
        name: 'groups',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;
    await client.patch('/settings', {
      locales: [...LOCALES],
      kinds: { page: { base: '' }, article: { base: 'news' } },
    });
  });

  it('lands every language in one group, each page pointing at the others', async () => {
    const outcomes = await publish([bundle('about', LOCALES)]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'updated',
      'updated',
      'updated',
      'updated',
    ]);
    expect(await groupsOf('about')).toHaveLength(1);

    const english = await (await SELF.fetch(`${ORIGIN}/about`)).text();
    for (const locale of ['de', 'fr', 'es']) {
      expect(english).toContain(
        `<link rel="alternate" hreflang="${locale}" href="${ORIGIN}/${locale}/about">`,
      );
    }
  });

  it('changes nothing when the same bundle is published again', async () => {
    const outcomes = await publish([bundle('about', LOCALES)]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
    expect(await groupsOf('about')).toHaveLength(1);
  });

  it('joins the group of a language the site already holds', async () => {
    // German first, on its own, as an earlier run might have left it.
    await publish([bundle('contact', ['de'])]);
    const [german] = await groupsOf('contact');

    await publish([bundle('contact', LOCALES)]);
    expect(await groupsOf('contact')).toEqual([german]);
  });
});
