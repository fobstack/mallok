import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256HexOfBytes } from '../../src/core/index.js';
import { pngBytes } from '../fixtures/media-bytes.js';

/**
 * `AC-CONTENT-01` (docs/ACCEPTANCE.md §4): entering ten products through the
 * admin's management API, each with a specification table and gallery
 * images, and publishing them. Previously only walked through by hand under
 * `wrangler dev` — this reproduces the same path as a reproducible assertion.
 */

const ORIGIN = 'https://catalog-test.example';
const EMAIL = 'catalog@example.com';
const PASSWORD = 'a sufficiently long password';
const PRODUCT_COUNT = 10;

let token = '';
let familySha = '';
let lineupSha = '';

function authHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: authHeaders({ 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A product bundle: a specification table plus a two-image gallery. */
function productMarkdown(index: number): string {
  return [
    '---',
    `title: Grade 5 titanium round bar, batch ${index}`,
    'description: Aerospace-grade round bar, mill-certified.',
    'grade: Ti-6Al-4V',
    'standard: ASTM B348',
    'form: Bar',
    `moq: ${index * 100} kg`,
    'lead_time: 15-20 days',
    'specs:',
    '  Grade: Ti-6Al-4V',
    '  Standard: ASTM B348 Grade 5',
    '  Tensile strength: 895 MPa min',
    'gallery:',
    '  - images/family.png',
    '  - images/lineup.png',
    '---',
    '',
    `Round bar batch ${index}, stocked and mill-certified for aerospace buyers.`,
  ].join('\n');
}

describe('entering a full product catalogue', () => {
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
        name: 'catalog-test',
        scopes: ['content:write', 'media:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    await api('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: 'products' },
      },
    });

    const family = pngBytes(1600, 900);
    familySha = await sha256HexOfBytes(family);
    await SELF.fetch(`${ORIGIN}/_mallok/api/media/${familySha}`, {
      method: 'PUT',
      headers: authHeaders({ 'x-mallok-filename': 'family.png' }),
      body: family,
    });

    const lineup = pngBytes(1200, 800);
    lineupSha = await sha256HexOfBytes(lineup);
    await SELF.fetch(`${ORIGIN}/_mallok/api/media/${lineupSha}`, {
      method: 'PUT',
      headers: authHeaders({ 'x-mallok-filename': 'lineup.png' }),
      body: lineup,
    });
  });

  it('creates and publishes ten products with specification tables and gallery images', async () => {
    const assets = {
      'images/family.png': familySha,
      'images/lineup.png': lineupSha,
    };
    const paths: string[] = [];
    for (let index = 1; index <= PRODUCT_COUNT; index++) {
      const response = await api('POST', '/_mallok/api/content', {
        kind: 'product',
        slug: `bar-grade-5-batch-${index}`,
        markdown: productMarkdown(index),
        assets,
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        path: string;
        missingAssets: string[];
      };
      // Every referenced gallery image resolved — nothing is reported missing.
      expect(body.missingAssets).toEqual([]);
      paths.push(body.path);
    }
    expect(new Set(paths).size).toBe(PRODUCT_COUNT);

    const list = await api(
      'GET',
      '/_mallok/api/content?kind=product&status=published',
    );
    const { items } = (await list.json()) as { items: { id: string }[] };
    expect(items.length).toBe(PRODUCT_COUNT);

    for (const path of paths) {
      const page = await SELF.fetch(`${ORIGIN}${path}`);
      expect(page.status).toBe(200);
      const html = await page.text();

      // The specification table (docs/CONTENT_FORMAT.md §3.2, `specs`).
      expect(html).toContain('class="spec-table"');
      expect(html).toContain('<th scope="row">Grade</th><td>Ti-6Al-4V</td>');
      expect(html).toContain(
        '<th scope="row">Tensile strength</th><td>895 MPa min</td>',
      );

      // The gallery (docs/CONTENT_FORMAT.md §3.2, `gallery`).
      const frames = html.match(/class="gallery-frame"/g) ?? [];
      expect(frames.length).toBe(2);
      expect(html).toContain('width="1600" height="900"');
      expect(html).toContain('width="1200" height="800"');
    }
  });
});
