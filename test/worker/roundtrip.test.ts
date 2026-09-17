import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The seven round-trip assertions of docs/CONTENT_FORMAT.md §9.
 *
 * They run against the real Worker with real D1 and R2, because what is being
 * asserted is that stored bytes come back unchanged — a mocked layer would
 * prove nothing.
 */

const ORIGIN = 'https://roundtrip.example';
const EMAIL = 'roundtrip@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === '' ? null : JSON.parse(text)) as T,
  };
}

interface ExportFile {
  path: string;
  text?: string;
  sha256?: string;
  url?: string;
}

async function exportFiles(): Promise<Map<string, ExportFile>> {
  const result = await api<{ files: ExportFile[] }>(
    'GET',
    '/_mallok/api/export',
  );
  expect(result.status).toBe(200);
  return new Map(result.body.files.map((file) => [file.path, file]));
}

/** Uploads bytes as media and returns the sha256 the server stored. */
async function putMedia(bytes: string, name: string): Promise<string> {
  const data = new TextEncoder().encode(bytes);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const sha = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  // A minimal but real PNG header, so type sniffing accepts it.
  const png = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    0x00,
    0x00,
    0x00,
    0x04,
    0x00,
    0x00,
    0x00,
    0x03,
    ...data,
  ]);
  const pngDigest = await crypto.subtle.digest('SHA-256', png);
  const pngSha = [...new Uint8Array(pngDigest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const response = await SELF.fetch(`${ORIGIN}/_mallok/api/media/${pngSha}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      'x-mallok-filename': name,
    },
    body: png,
  });
  expect([200, 201]).toContain(response.status);
  void sha;
  return pngSha;
}

describe('round-trip guarantees', () => {
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
        name: 'roundtrip',
        scopes: ['content:write', 'media:write', 'export', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;
    await api('PATCH', '/_mallok/api/settings', { locales: ['en', 'zh'] });
  });

  // §9.2 — a hand-written bundle survives import and export unchanged.
  it('never rewrites the source text of an imported bundle', async () => {
    const markdown = [
      '---',
      "title: 'Quoted: title'",
      'tags:   [a,   b]',
      'draft: false',
      '---',
      '',
      'Body   with   odd    spacing.',
      '',
      '',
      'And a trailing blank line.',
      '',
    ].join('\n');
    const created = await api<{ id: string }>('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'verbatim',
      markdown,
      assets: {},
    });
    expect(created.status).toBe(201);

    const files = await exportFiles();
    expect(files.get('content/article/verbatim/index.md')?.text).toBe(markdown);
  });

  // §9.3 — alias front matter derives correctly without touching the source.
  it('derives aliases into the model but leaves the file alone', async () => {
    const markdown = [
      '---',
      'title: Alias case',
      'pubDate: 2026-03-04T00:00:00Z',
      'heroImage: images/hero.png',
      'summary: From an Astro export.',
      'categories: [alpha, beta]',
      '---',
      '',
      'Body.',
    ].join('\n');
    const created = await api<{ id: string }>('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'aliases',
      markdown,
      assets: {},
    });
    const detail = await api<{
      description: string;
      markdown: string;
    }>('GET', `/_mallok/api/content/${created.body.id}`);
    // The derived description comes from `summary`…
    expect(detail.body.description).toBe('From an Astro export.');
    // …and the stored text still says `summary`, not `description`.
    expect(detail.body.markdown).toBe(markdown);
    expect(detail.body.markdown).toContain('summary:');
    expect(detail.body.markdown).not.toContain('description:');
  });

  // §9.4 — two bundles may each carry their own images/cover.png.
  it('keeps same-named images in different bundles apart', async () => {
    const shaOne = await putMedia('first-image-bytes', 'cover.png');
    const shaTwo = await putMedia('second-image-bytes', 'cover.png');
    expect(shaOne).not.toBe(shaTwo);

    for (const [slug, sha] of [
      ['bundle-one', shaOne],
      ['bundle-two', shaTwo],
    ] as const) {
      const created = await api('POST', '/_mallok/api/content', {
        kind: 'article',
        slug,
        markdown: `---\ntitle: ${slug}\n---\n\n![c](images/cover.png)`,
        assets: { 'images/cover.png': sha },
      });
      expect(created.status).toBe(201);
    }

    const files = await exportFiles();
    // Each bundle exports its own file at its own path, pointing at its own
    // object — the name collides, the content does not.
    expect(
      files.get('content/article/bundle-one/images/cover.png')?.sha256,
    ).toBe(shaOne);
    expect(
      files.get('content/article/bundle-two/images/cover.png')?.sha256,
    ).toBe(shaTwo);
  });

  // §9.5 — a reference to a missing file survives untouched.
  it('preserves a reference whose file was never uploaded', async () => {
    const markdown = '---\ntitle: Missing\n---\n\n![gone](images/gone.png)';
    const created = await api<{ missingAssets: string[] }>(
      'POST',
      '/_mallok/api/content',
      { kind: 'article', slug: 'missing-file', markdown, assets: {} },
    );
    expect(created.status).toBe(201);
    // The save reports it rather than failing (docs/CONTENT_FORMAT.md §4.6).
    expect(created.body.missingAssets).toContain('images/gone.png');

    const files = await exportFiles();
    expect(files.get('content/article/missing-file/index.md')?.text).toBe(
      markdown,
    );
    expect(files.has('content/article/missing-file/images/gone.png')).toBe(
      false,
    );
  });

  // §9.6 — re-importing an unchanged bundle writes nothing.
  it('is a no-op when nothing changed', async () => {
    const markdown = '---\ntitle: Idempotent\n---\n\nSame every time.';
    const body = {
      kind: 'article',
      slug: 'idempotent',
      markdown,
      assets: {},
    };
    const first = await api<{ id: string }>(
      'POST',
      '/_mallok/api/content',
      body,
    );
    expect(first.status).toBe(201);

    const before = await env.DB.prepare(
      'SELECT rev, updated_at FROM content WHERE id = ?',
    )
      .bind(first.body.id)
      .first<{ rev: number; updated_at: string }>();

    const second = await api<{ unchanged?: boolean }>(
      'POST',
      '/_mallok/api/content',
      body,
    );
    expect(second.body.unchanged).toBe(true);

    const after = await env.DB.prepare(
      'SELECT rev, updated_at FROM content WHERE id = ?',
    )
      .bind(first.body.id)
      .first<{ rev: number; updated_at: string }>();
    // No write at all: the revision and timestamp are untouched, which is
    // what lets a daily pipeline re-run the whole directory.
    expect(after?.rev).toBe(before?.rev);
    expect(after?.updated_at).toBe(before?.updated_at);
  });

  // §9.7 — hostile input is refused or sanitised, never crashes.
  it('handles hostile content without crashing or leaking', async () => {
    const hostile = [
      '---',
      'title: Hostile',
      'cover: ../../etc/passwd',
      '---',
      '',
      '<script>alert(1)</script>',
      '',
      '[click](javascript:alert(1))',
      '',
      '![up](../../secret.png)',
    ].join('\n');
    const created = await api<{ id: string; path: string }>(
      'POST',
      '/_mallok/api/content',
      { kind: 'article', slug: 'hostile', markdown: hostile, assets: {} },
    );
    expect(created.status).toBe(201);

    const page = await SELF.fetch(`${ORIGIN}${created.body.path}`);
    const html = await page.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('javascript:alert');
    // The traversal never becomes a path the export would write.
    const files = await exportFiles();
    expect([...files.keys()].some((path) => path.includes('..'))).toBe(false);

    // Over the size limit is refused with a clear status, not a crash.
    const huge = `---\ntitle: Huge\n---\n\n${'x'.repeat(2 * 1024 * 1024 + 10)}`;
    const rejected = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'huge',
      markdown: huge,
      assets: {},
    });
    expect([400, 413]).toContain(rejected.status);
  });

  it("carries the inquiry plugin's data in a site export", async () => {
    // Leaving Mallok must not mean leaving the leads behind
    // (docs/CONTENT_FORMAT.md §5).
    await api('POST', '/_mallok/api/plugins/inquiry/enabled', {
      enabled: true,
    });
    await api('PATCH', '/_mallok/api/plugins/inquiry/settings', {
      recipient: 'sales@example.com',
      from_address: 'Site <hello@example.com>',
      autoreply: false,
    });
    await SELF.fetch(`${ORIGIN}/_mallok/p/inquiry/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        name: 'Exported Buyer',
        email: 'exported@example.net',
        message: 'Please quote.',
        website: '',
      }).toString(),
      redirect: 'manual',
    });

    const files = await exportFiles();
    const csv = files.get('inquiries.csv')?.text ?? '';
    expect(csv).toContain('exported@example.net');
    expect(csv.split('\r\n')[0]).toContain('email');
    // Settings and secrets are never exported (docs/CONTENT_FORMAT.md §8).
    expect(csv).not.toContain('sales@example.com');
  });

  it('leaves the export free of secrets and derived data', async () => {
    const result = await api<{ files: { path: string; text?: string }[] }>(
      'GET',
      '/_mallok/api/export',
    );
    const everything = JSON.stringify(result.body);
    for (const forbidden of [
      'render_cache',
      'password_hash',
      'MALLOK_SECRET',
      'session',
    ]) {
      expect(everything).not.toContain(forbidden);
    }
    // No plugin secret column, encrypted or otherwise.
    expect(everything).not.toContain('resend_api_key');
  });

  // §9.1 — export, re-import into a clean group, export again.
  it('produces identical bytes across an export/import/export cycle', async () => {
    const markdown =
      '---\ntitle: Cycle\ndescription: Stable.\n---\n\nBody that must not change.\n';
    const created = await api<{ id: string }>('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'cycle',
      markdown,
      assets: {},
    });
    const detail = await api<{ translationGroup: string; createdAt?: string }>(
      'GET',
      `/_mallok/api/content/${created.body.id}`,
    );

    const first = await exportFiles();
    const bundle = first.get('content/article/cycle/index.md');
    const identity = first.get('content/article/cycle/mallok.json');
    expect(bundle?.text).toBe(markdown);
    expect(identity?.text).toContain(created.body.id);

    // Re-import exactly what the export produced, identity included.
    const reimported = await api('POST', '/_mallok/api/content', {
      id: created.body.id,
      translationGroup: detail.body.translationGroup,
      kind: 'article',
      slug: 'cycle',
      markdown: bundle?.text ?? '',
      assets: {},
    });
    expect([200, 201]).toContain(reimported.status);

    const second = await exportFiles();
    // Byte-identical document, and the identity fields are preserved.
    expect(second.get('content/article/cycle/index.md')?.text).toBe(
      bundle?.text,
    );
    expect(second.get('content/article/cycle/mallok.json')?.text).toBe(
      identity?.text,
    );
  });

  it('rejects content identities that cannot round-trip portably', async () => {
    const markdown = '---\ntitle: Unsafe\n---\n\nBody.\n';
    const badSlug = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: '../escape',
      markdown,
      assets: {},
    });
    expect(badSlug.status).toBe(400);

    const badLocale = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      locale: '__proto__',
      slug: 'safe',
      markdown,
      assets: {},
    });
    expect(badLocale.status).toBe(400);

    const aliases = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'asset-aliases',
      markdown,
      assets: {
        'images/File.png': 'a'.repeat(64),
        'images/file.png': 'b'.repeat(64),
      },
    });
    expect(aliases.status).toBe(400);
  });

  it('gives unsafe original media names a portable export filename', async () => {
    const sha = await putMedia('unsafe-name', '../CON: product image. ');
    const files = await exportFiles();
    const exported = [...files.values()].find((file) => file.sha256 === sha);

    expect(exported?.path).toMatch(/^media\/[a-f0-9]{8}-/);
    expect(exported?.path).not.toMatch(/[\\:*?"<>|]/);
    expect(exported?.path).not.toContain('..');
  });

  it('keeps colliding locale-only groups in distinct portable bundles', async () => {
    const settings = await api('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'de'],
    });
    expect(settings.status).toBe(200);
    const markdown = (title: string) => `---\ntitle: ${title}\n---\n\nBody.\n`;

    for (const [locale, title] of [
      ['en', 'English group'],
      ['de', 'German group'],
    ] as const) {
      const saved = await api('POST', '/_mallok/api/content', {
        kind: 'article',
        locale,
        slug: 'same-export-slug',
        markdown: markdown(title),
        assets: {},
      });
      expect(saved.status).toBe(201);
    }

    const files = await exportFiles();
    const identities = [...files.entries()]
      .filter(([path]) => path.startsWith('content/article/same-export-slug'))
      .filter(([path]) => path.endsWith('/mallok.json'));
    expect(identities).toHaveLength(2);
    expect(new Set(identities.map(([path]) => path)).size).toBe(2);
    for (const [, file] of identities) {
      expect(file.text).toContain('"slug": "same-export-slug"');
    }
  });
});
