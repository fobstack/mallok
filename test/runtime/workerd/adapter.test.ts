import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * The adapter running in real workerd, against the real Cache API.
 *
 * The properties worth having a running runtime to check are the ones a unit
 * test cannot: that a cached page really comes back on the second request,
 * that a page carrying a cookie really does not, and that the product's own
 * routes are reached before any public catch-all.
 */
const ORIGIN = 'https://runtime-test.example';

describe('the Cloudflare adapter', () => {
  it('renders a page with locals built from env', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('hello from workerd');
  });

  it('serves the second request from the cache', async () => {
    // Its own URL: the cache is shared across tests in this file, so a path
    // another test already warmed would start out as a HIT.
    const url = `${ORIGIN}/?case=cache-hit`;
    const first = await SELF.fetch(url);
    expect(first.headers.get('x-runtime-cache')).toBe('MISS');
    expect(first.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=60',
    );

    const second = await SELF.fetch(url);
    expect(second.headers.get('x-runtime-cache')).toBe('HIT');
    expect(await second.text()).toContain('hello from workerd');
  });

  it('publishes the cache status under the name the product chose', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_test/renamed-status`);
    expect(response.headers.get('x-product-cache')).toBe('MISS');
    expect(response.headers.get('x-runtime-cache')).toBeNull();
  });

  it('writes Cache-Tag, dropping tags Cloudflare would refuse', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`);
    expect(response.headers.get('cache-tag')).toBe('home');

    const rejected = await (
      await SELF.fetch(`${ORIGIN}/_test/rejected-tags`)
    ).json();
    expect(rejected).toContain('bad tag');
  });

  it('never stores a page whose response sets a cookie', async () => {
    const first = await SELF.fetch(`${ORIGIN}/set-cookie`);
    expect(first.headers.get('x-runtime-cache')).toBe('BYPASS');
    const second = await SELF.fetch(`${ORIGIN}/set-cookie`);
    // Still not a hit: serving this from a shared cache would hand one
    // visitor's session to the next.
    expect(second.headers.get('x-runtime-cache')).toBe('BYPASS');
  });

  it('does not store a page that asked not to be stored', async () => {
    await SELF.fetch(`${ORIGIN}/private`);
    const second = await SELF.fetch(`${ORIGIN}/private`);
    expect(second.headers.get('x-runtime-cache')).toBe('BYPASS');
    // A bypassed response leaves with the strictest directive, so no browser
    // or intermediary keeps it either.
    expect(second.headers.get('cache-control')).toBe('private, no-store');
  });

  it('bypasses the cache for a request that looks signed in', async () => {
    const response = await SELF.fetch(`${ORIGIN}/`, {
      headers: { cookie: 'session=abc' },
    });
    expect(response.headers.get('x-runtime-cache')).toBe('BYPASS');
  });

  it('lets the product answer its API before any public catch-all', async () => {
    // The manifest has `/[...rest]`, which would otherwise swallow this.
    const response = await SELF.fetch(`${ORIGIN}/_api/ping`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('still routes an unclaimed path to the catch-all page', async () => {
    const response = await SELF.fetch(`${ORIGIN}/anything/else`);
    expect(await response.text()).toContain('catch-all');
  });
});
