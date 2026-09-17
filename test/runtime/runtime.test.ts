import { describe, expect, it } from 'vitest';
import { Runtime } from '../../src/runtime/core/runtime.js';
import type {
  DocumentRenderer,
  PageModule,
  RouteManifest,
} from '../../src/runtime/core/types.js';

function page(module: Partial<PageModule> & Pick<PageModule, 'render'>) {
  return () => Promise.resolve(module as PageModule);
}

const manifest: RouteManifest = {
  locales: ['zh', 'de'],
  defaultLocale: 'en',
  islands: {
    cart: { src: '/_islands/cart-abc.js', imports: ['/_islands/vendor.js'] },
    search: { src: '/_islands/search-def.js' },
  },
  islandBootstrap: '/_islands/bootstrap-xyz.js',
  routes: [
    // Deliberately least-specific first: the router must sort, not trust order.
    { pattern: '/blog/[...rest]', load: page({ render: () => 'catch-all' }) },
    {
      pattern: '/blog/[slug]',
      load: page({
        load: (context) => ({ slug: context.params.slug ?? '' }),
        render: (data) => `post:${String(data.slug)}`,
      }),
    },
    { pattern: '/blog/feed', load: page({ render: () => 'feed' }) },
    {
      pattern: '/',
      load: page({
        render: () => '<main>home</main>',
        head: () => ({
          title: 'Home & <friends>',
          canonical: 'https://example.com/',
          alternates: { zh: 'https://example.com/zh/' },
        }),
        cache: () => ({
          mode: 'public',
          edgeSeconds: 300,
          tags: ['home', 'nav'],
        }),
      }),
    },
    {
      pattern: '/cart',
      load: page({
        render: () =>
          '<div data-island="cart"><script type="application/json" data-island-props>{}</script></div>' +
          '<div data-island="cart"><script type="application/json" data-island-props>{}</script></div>',
      }),
    },
    {
      pattern: '/missing',
      load: page({
        // A themed 404: a real page, rendered by the theme, with a 404 status
        // and a noindex head — none of which a bare string could express.
        render: () => ({ body: '<h1>Not found</h1>', status: 404 }),
        head: () => ({ meta: { robots: 'noindex' } }),
      }),
    },
    {
      pattern: '/contact',
      load: page({
        render: () => 'form',
        action: () =>
          new Response(null, { status: 303, headers: { location: '/thanks' } }),
      }),
    },
    {
      pattern: '/old',
      load: page({
        render: () => 'never rendered',
        load: () =>
          new Response(null, { status: 301, headers: { location: '/new' } }),
      }),
    },
  ],
};

const runtime = new Runtime(manifest);

async function get(path: string, init?: RequestInit) {
  const result = await runtime.handle(
    new Request(`https://example.com${path}`, init),
  );
  if (result === null) {
    throw new Error(`no route matched ${path}`);
  }
  return result;
}

describe('the page lifecycle', () => {
  it('returns null when nothing matches, leaving the 404 to the caller', async () => {
    expect(
      await runtime.handle(new Request('https://example.com/nope')),
    ).toBeNull();
  });

  it('picks the most specific route regardless of manifest order', async () => {
    expect(await (await get('/blog/feed')).response.text()).toContain('feed');
    expect(await (await get('/blog/hello')).response.text()).toContain(
      'post:hello',
    );
    expect(await (await get('/blog/a/b')).response.text()).toContain(
      'catch-all',
    );
  });

  it('lets load stop the lifecycle with a response, and never caches it', async () => {
    const { response, cache } = await get('/old');
    expect(response.status).toBe(301);
    expect(cache.mode).toBe('no-store');
  });

  it('routes a non-GET request to action, and 405s without one', async () => {
    expect((await get('/contact', { method: 'POST' })).response.status).toBe(
      303,
    );
    const refused = (await get('/blog/feed', { method: 'POST' })).response;
    expect(refused.status).toBe(405);
    expect(refused.headers.get('allow')).toBe('GET, HEAD');
  });

  it('lets a page set its own status and headers', async () => {
    const { response } = await get('/missing');
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('<h1>Not found</h1>');
    expect(html).toContain('name="robots" content="noindex"');
  });

  it('escapes what pages put in the head', async () => {
    const html = await (await get('/')).response.text();
    expect(html).toContain('<title>Home &amp; &lt;friends&gt;</title>');
    expect(html).toContain(
      '<link rel="canonical" href="https://example.com/">',
    );
    expect(html).toContain('hreflang="zh"');
  });

  it('strips a locale prefix and reports it to the page', async () => {
    const html = await (await get('/zh/blog/hello')).response.text();
    expect(html).toContain('<html lang="zh">');
    expect(await (await get('/')).response.text()).toContain(
      '<html lang="en">',
    );
  });

  it('accepts locales resolved at request time, not only from the build', async () => {
    // Mallok keeps locales in D1 and lets the admin change them, so they
    // cannot be baked in at build time.
    const result = await runtime.handle(
      new Request('https://example.com/fr/blog/hello'),
      { locale: { locales: ['fr'], defaultLocale: 'en' } },
    );
    const html = await result?.response.text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('post:hello');
  });

  it('loads one bootstrap, however often a page uses an island', async () => {
    const html = await (await get('/cart')).response.text();
    // One script, and it is the bootstrap — the only module that mounts
    // anything. The component is preloaded, then imported by the registry.
    expect(html.match(/<script type="module"/g)).toHaveLength(1);
    expect(html).toContain(
      '<script type="module" src="/_islands/bootstrap-xyz.js">',
    );
    expect(html.match(/cart-abc\.js/g)).toHaveLength(1);
    expect(html).toContain('rel="modulepreload" href="/_islands/cart-abc.js"');
    expect(html).toContain('rel="modulepreload" href="/_islands/vendor.js"');
    // An island the page did not use is neither preloaded nor loaded.
    expect(html).not.toContain('search-def');
  });

  it('ships no script at all for a page with no island', async () => {
    // The reason this runtime exists rather than full-page React SSR.
    expect(await (await get('/blog/hello')).response.text()).not.toContain(
      '<script',
    );
  });

  it('reports the cache policy instead of writing headers itself', async () => {
    expect((await get('/')).cache).toEqual({
      mode: 'public',
      edgeSeconds: 300,
      tags: ['home', 'nav'],
    });
    // No `cache` export means no caching, not a silent default.
    expect((await get('/cart')).cache).toEqual({ mode: 'no-store' });
  });
});

describe('the document renderer', () => {
  it('gives the theme the parts, the data and the context, and may be async', async () => {
    const document: DocumentRenderer = async (parts) => {
      await Promise.resolve();
      return `<html lang="${parts.locale}" data-route="${parts.context.route}"><body>${parts.body}${parts.islands}</body></html>`;
    };
    const result = await runtime.handle(
      new Request('https://example.com/cart'),
      { document },
    );
    const html = await result?.response.text();
    // Exactly one document, written by the theme.
    expect(html?.match(/<html/g)).toHaveLength(1);
    expect(html).toContain('data-route="/cart"');
    expect(html).toContain('bootstrap-xyz.js');
  });

  it('tells the theme which islands were used, in document order', async () => {
    let seen: readonly { name: string }[] = [];
    const document: DocumentRenderer = (parts) => {
      seen = parts.islandUses;
      return parts.body;
    };
    await runtime.handle(new Request('https://example.com/cart'), { document });
    expect(seen).toEqual([{ name: 'cart' }, { name: 'cart' }]);
  });
});

describe('route conflicts', () => {
  it('refuses two routes that can never be told apart', () => {
    // `blog.ts` and `blog/index.ts` both produce `/blog`.
    expect(
      () =>
        new Runtime({
          routes: [
            { pattern: '/blog', load: page({ render: () => 'a' }) },
            { pattern: '/blog', load: page({ render: () => 'b' }) },
          ],
        }),
    ).toThrow(/collide/);

    // `[id].ts` and `[slug].ts` differ only in a name nothing can see.
    expect(
      () =>
        new Runtime({
          routes: [
            { pattern: '/[id]', load: page({ render: () => 'a' }) },
            { pattern: '/[slug]', load: page({ render: () => 'b' }) },
          ],
        }),
    ).toThrow(/collide/);
  });
});
