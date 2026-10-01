import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleApp } from '../../src/worker/admin-app.js';

const ORIGIN = 'https://app-test.example';

/**
 * The workers-vitest pool wires the ASSETS **binding** but does not mount the
 * built asset directory, so these tests cover the routing decision — which
 * paths the Worker claims and what it says when the build is absent — and not
 * the bytes of the shell. Serving the real file is verified against
 * `wrangler dev` (see docs/tasks/TASK-10.md §5).
 */
describe('admin app routing', () => {
  it('claims the app prefix instead of falling through to the public site', async () => {
    for (const path of [
      '/_mallok/app',
      '/_mallok/app/',
      '/_mallok/app/settings/appearance',
      '/_mallok/app/content/some-id',
    ]) {
      const response = await SELF.fetch(`${ORIGIN}${path}`);
      // Either the shell (200) or the honest "not built" answer (503) —
      // never a 404 from the public router.
      expect([200, 503]).toContain(response.status);
    }
  });

  it('does not claim look-alike paths', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/application`);
    expect(response.status).toBe(404);
  });

  it('refuses a write to the app prefix', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/app/`, {
      method: 'POST',
    });
    expect(response.status).toBe(405);
  });

  it('says plainly when the app was not built', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/app/`);
    if (response.status === 503) {
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('pnpm build');
    }
  });
});

/**
 * A browser that reloads an admin route sends the validators of the response
 * it cached. Static Assets answers those with 304 when the shell has not
 * changed, and the shell used to forward them: the 304 was not `ok`, so a
 * reload under `wrangler dev`, which sends an ETag, showed "The admin app is
 * not part of this build" instead of the page.
 *
 * The pool does not mount the built assets, so this stands in for Static
 * Assets with a fetcher that honours conditional requests the way it does.
 */
describe('admin shell under conditional requests', () => {
  const Shell = '<!doctype html><title>Mallok</title>';
  const Etag = '"shell-v1"';

  function staticAssets(options: { readonly missing?: boolean } = {}): {
    readonly fetcher: Fetcher;
    readonly seen: Headers[];
  } {
    const seen: Headers[] = [];
    const fetcher = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        seen.push(request.headers);
        if (options.missing === true) {
          return new Response('Not found', { status: 404 });
        }
        if (request.headers.get('if-none-match') === Etag) {
          return new Response(null, { status: 304, headers: { etag: Etag } });
        }
        if (request.headers.has('if-modified-since')) {
          return new Response(null, { status: 304, headers: { etag: Etag } });
        }
        return new Response(Shell, {
          headers: { 'content-type': 'text/html', etag: Etag },
        });
      },
      connect: () => {
        throw new Error('not used');
      },
    } as unknown as Fetcher;
    return { fetcher, seen };
  }

  async function reload(
    headers: Record<string, string>,
    assets = staticAssets(),
  ): Promise<{ response: Response; seen: Headers[] }> {
    const response = await handleApp(
      new Request(`${ORIGIN}/_mallok/app/account`, { headers }),
      { ...env, ASSETS: assets.fetcher } as typeof env,
    );
    return { response, seen: assets.seen };
  }

  it.each([
    ['If-None-Match', { 'if-none-match': Etag }],
    [
      'If-Modified-Since',
      { 'if-modified-since': 'Wed, 01 Oct 2026 00:00:00 GMT' },
    ],
  ])('serves the shell to a reload carrying %s', async (_name, headers) => {
    const { response, seen } = await reload(headers);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(Shell);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(seen[0]?.has('if-none-match')).toBe(false);
    expect(seen[0]?.has('if-modified-since')).toBe(false);
  });

  it('still forwards ordinary request headers to the asset fetch', async () => {
    const { seen } = await reload({ 'accept-language': 'de' });
    expect(seen[0]?.get('accept-language')).toBe('de');
  });

  it('still says the app was not built when the shell is missing', async () => {
    const { response } = await reload(
      { 'if-none-match': Etag },
      staticAssets({ missing: true }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('pnpm build');
  });
});
