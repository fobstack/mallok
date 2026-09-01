import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256HexOfBytes } from '../../src/core/index.js';
import { handleScheduled } from '../../src/worker/scheduled.js';
import {
  pngBytes,
  svgBytes,
  webpBytes,
  zipBytes,
} from '../fixtures/media-bytes.js';

const ORIGIN = 'https://media-test.example';
const EMAIL = 'media@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

const HERO = pngBytes(1600, 900);
let heroSha = '';

function authHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function upload(
  bytes: Uint8Array,
  sha: string,
  filename: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/api/media/${sha}`, {
    method: 'PUT',
    headers: authHeaders({ 'x-mallok-filename': encodeURIComponent(filename) }),
    body: bytes,
  });
}

async function saveContent(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/api/content`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

async function mediaRow(
  sha: string,
): Promise<{ ref_count: number; unreferenced_since: string | null } | null> {
  return env.DB.prepare(
    'SELECT ref_count, unreferenced_since FROM media WHERE sha256 = ?',
  )
    .bind(sha)
    .first<{ ref_count: number; unreferenced_since: string | null }>();
}

describe('media', () => {
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
        name: 'media-test',
        scopes: ['media:write', 'content:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;
    heroSha = await sha256HexOfBytes(HERO);
  });

  it('stores an original and reads its dimensions from the bytes', async () => {
    const response = await upload(HERO, heroSha, 'hero.png');
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      sha256: string;
      kind: string;
      mime: string;
      width: number;
      height: number;
      refCount: number;
      originalName: string;
    };
    expect(body.sha256).toBe(heroSha);
    expect(body.kind).toBe('image');
    expect(body.mime).toBe('image/png');
    // Not taken from the client: derived from the IHDR chunk.
    expect(body.width).toBe(1600);
    expect(body.height).toBe(900);
    expect(body.refCount).toBe(0);
    expect(body.originalName).toBe('hero.png');
  });

  it('deduplicates a repeated upload instead of storing it twice', async () => {
    const again = await upload(HERO, heroSha, 'hero-copy.png');
    expect(again.status).toBe(200);
    expect((await again.json()) as object).toMatchObject({
      deduplicated: true,
      sha256: heroSha,
    });
  });

  it('refuses a body that does not match the hash in the path', async () => {
    const wrong = await upload(pngBytes(10, 10), heroSha, 'lie.png');
    expect(wrong.status).toBe(400);
  });

  it('refuses SVG and unknown types by signature', async () => {
    const svg = svgBytes();
    const rejected = await upload(svg, await sha256HexOfBytes(svg), 'x.svg');
    expect(rejected.status).toBe(415);
  });

  it('labels a ZIP container by its declared extension', async () => {
    const zip = zipBytes();
    const sha = await sha256HexOfBytes(zip);
    const response = await upload(zip, sha, 'catalogue.xlsx');
    expect(response.status).toBe(201);
    expect((await response.json()) as object).toMatchObject({
      kind: 'file',
      ext: 'xlsx',
    });
  });

  it('accepts WebP variants and records their widths', async () => {
    for (const width of [480, 960]) {
      const variant = webpBytes(width, Math.round((width * 9) / 16));
      const response = await SELF.fetch(
        `${ORIGIN}/_mallok/api/media/${heroSha}/variants/${width}`,
        { method: 'PUT', headers: authHeaders(), body: variant },
      );
      expect(response.status).toBe(200);
    }
    const detail = await SELF.fetch(`${ORIGIN}/_mallok/api/media/${heroSha}`, {
      headers: authHeaders(),
    });
    expect((await detail.json()) as object).toMatchObject({
      variants: [480, 960],
    });
  });

  it('refuses a non-WebP variant', async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/_mallok/api/media/${heroSha}/variants/1440`,
      { method: 'PUT', headers: authHeaders(), body: pngBytes(1440, 810) },
    );
    expect(response.status).toBe(415);
  });

  it('serves the object through the proxy with an immutable cache', async () => {
    const response = await SELF.fetch(`${ORIGIN}/media/${heroSha}.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it('renders a referenced image responsively on the public page', async () => {
    const created = await saveContent({
      kind: 'article',
      markdown: '---\ntitle: With a photo\n---\n\n![Furnace](images/hero.png)',
      assets: { 'images/hero.png': heroSha },
    });
    expect(created.status).toBe(201);
    const { path } = (await created.json()) as { path: string };

    const page = await SELF.fetch(`${ORIGIN}${path}`);
    const html = await page.text();
    expect(html).toContain(`/media/${heroSha}_960.webp`);
    expect(html).toContain('srcset=');
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('decoding="async"');
  });

  it('counts the reference in the same write as the content', async () => {
    expect((await mediaRow(heroSha))?.ref_count).toBe(1);
    expect((await mediaRow(heroSha))?.unreferenced_since).toBeNull();
  });

  it('refuses to delete an object that content still uses', async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/_mallok/api/media/${heroSha}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    expect(response.status).toBe(409);
  });

  it('releases the reference when the content stops using it', async () => {
    const list = await SELF.fetch(
      `${ORIGIN}/_mallok/api/content?kind=article`,
      { headers: authHeaders() },
    );
    const { items } = (await list.json()) as { items: { id: string }[] };
    const id = items[0]?.id ?? '';

    const updated = await saveContent({
      id,
      kind: 'article',
      markdown: '---\ntitle: With a photo\n---\n\nThe photo is gone.',
      assets: {},
    });
    expect(updated.status).toBe(200);

    const row = await mediaRow(heroSha);
    expect(row?.ref_count).toBe(0);
    // The grace period starts now, not at upload time.
    expect(row?.unreferenced_since).not.toBeNull();
  });

  it('deletes an unreferenced object and its variants from R2', async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/_mallok/api/media/${heroSha}`,
      { method: 'DELETE', headers: authHeaders() },
    );
    expect(response.status).toBe(200);
    expect(await mediaRow(heroSha)).toBeNull();
    expect(await env.MEDIA.get(`media/${heroSha}.png`)).toBeNull();
    expect(await env.MEDIA.get(`media/${heroSha}_480.webp`)).toBeNull();
    expect((await SELF.fetch(`${ORIGIN}/media/${heroSha}.png`)).status).toBe(
      404,
    );
  });

  it('reports which hashes are already stored', async () => {
    const zip = await sha256HexOfBytes(zipBytes());
    const response = await SELF.fetch(`${ORIGIN}/_mallok/api/media/check`, {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ hashes: [zip, 'b'.repeat(64)] }),
    });
    expect((await response.json()) as object).toEqual({ existing: [zip] });
  });

  it('lists unused media separately', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/api/media?unused=1`, {
      headers: authHeaders(),
    });
    const body = (await response.json()) as { items: { sha256: string }[] };
    // The xlsx upload was never referenced by any content.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.sha256 !== heroSha)).toBe(true);
  });

  it('requires the media:write scope for uploads', async () => {
    const readOnly = await SELF.fetch(`${ORIGIN}/_mallok/api/media`, {
      headers: authHeaders(),
    });
    expect(readOnly.status).toBe(200);

    const bytes = pngBytes(20, 20);
    const sha = await sha256HexOfBytes(bytes);
    const anonymous = await SELF.fetch(`${ORIGIN}/_mallok/api/media/${sha}`, {
      method: 'PUT',
      body: bytes,
    });
    expect(anonymous.status).toBe(401);
  });

  it('collects media only after the grace period', async () => {
    const bytes = pngBytes(64, 64);
    const sha = await sha256HexOfBytes(bytes);
    expect((await upload(bytes, sha, 'orphan.png')).status).toBe(201);

    // Freshly uploaded and unreferenced: still inside the grace period.
    await handleScheduled(env, createExecutionContext());
    expect(await mediaRow(sha)).not.toBeNull();

    // Backdate it past the seven-day window and run the tick again.
    await env.DB.prepare(
      'UPDATE media SET unreferenced_since = ? WHERE sha256 = ?',
    )
      .bind('2020-01-01T00:00:00.000Z', sha)
      .run();
    await handleScheduled(env, createExecutionContext());

    expect(await mediaRow(sha)).toBeNull();
    expect(await env.MEDIA.get(`media/${sha}.png`)).toBeNull();
  });
});
