import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/worker/index.js';

/**
 * The invariants a release must not break, asserted at Mallok's own boundary.
 *
 * Most of these are enforced inside `@fobstack/runtime` and covered by its
 * suite. They are repeated here on purpose: the runtime is a dependency that
 * will be upgraded, and a change in its defaults must fail Mallok's own gate
 * rather than be discovered on a live site. Each one is a rule about what may
 * reach a shared cache, which is the class of bug that serves one visitor's
 * page to another.
 */

const ORIGIN = 'https://site.example';

function get(path: string, headers: HeadersInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { headers });
}

describe('the public cache boundary', () => {
  it('never serves a page from the shared cache to a credentialed request', async () => {
    // Mallok declares no `ignoredCookies`, so the runtime's default applies:
    // any cookie, and any `Authorization`, bypasses.
    for (const headers of [
      { authorization: 'Bearer whatever' },
      { cookie: 'anything=1' },
    ]) {
      const response = await get('/', headers);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-mallok-cache')).toBe('BYPASS');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      // A tag on an uncached response is a purge target that never matches.
      expect(response.headers.get('cache-tag')).toBeNull();
    }
  });

  it('gives a cacheable page a zero browser lifetime', async () => {
    // Purging Cloudflare cannot reach a page already in a browser, so the
    // edge gets the long lifetime and the browser revalidates.
    const response = await get('/');
    const control = response.headers.get('cache-control') ?? '';
    expect(control).toMatch(/^public, max-age=0(, |$)/);
    expect(control).toContain('s-maxage=');
  });

  it('keeps the admin and the API out of the public router', async () => {
    // A public catch-all page must never get the chance to answer these.
    const health = await get('/_mallok/api/health');
    expect(health.status).toBe(401);
    expect(health.headers.get('content-type')).toContain('application/json');

    const unknown = await get('/_mallok/whatever');
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe('{"error":"Not found."}');
  });

  it('still exposes a scheduled handler', async () => {
    // The cron entry point is easy to lose in a routing change and impossible
    // to notice locally: scheduled publication and media collection both hang
    // off it.
    expect(typeof worker.scheduled).toBe('function');
    expect(typeof worker.fetch).toBe('function');
  });
});

describe('the SEO endpoints still answer', () => {
  // They are Mallok's own, deliberately not moved onto the runtime's router.
  const endpoints = [
    ['/robots.txt', /text\/plain/],
    ['/sitemap.xml', /xml/],
    ['/feed.xml', /xml/],
  ] as const;

  for (const [path, type] of endpoints) {
    it(`serves ${path}`, async () => {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type') ?? '').toMatch(type);
    });
  }
});
