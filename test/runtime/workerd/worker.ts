/**
 * A Worker that consumes the runtime exactly as a product would, used by the
 * workerd integration test.
 *
 * The shape here is the contract being tested, not an example: the product
 * dispatches its own API and admin paths **first**, and only then hands the
 * request to the runtime. A public catch-all page must never get the chance
 * to answer `/_api/*`.
 */

import {
  createPageHandler,
  workersPageCache,
} from '../../../src/runtime/cloudflare/index.js';
import { Runtime } from '../../../src/runtime/core/runtime.js';
import type {
  PageModule,
  RouteManifest,
} from '../../../src/runtime/core/types.js';

interface Locals {
  readonly greeting: string;
}

function page(module: PageModule): () => Promise<PageModule> {
  return () => Promise.resolve(module);
}

const manifest: RouteManifest = {
  defaultLocale: 'en',
  islands: {},
  routes: [
    {
      pattern: '/',
      load: page({
        render: (_data, context) =>
          `<main>${(context.locals as Locals).greeting}</main>`,
        cache: () => ({
          mode: 'public',
          edgeSeconds: 60,
          tags: ['home', 'bad tag'],
        }),
      }),
    },
    {
      pattern: '/private',
      load: page({
        render: () => '<main>private</main>',
        cache: () => ({ mode: 'no-store' }),
      }),
    },
    {
      pattern: '/set-cookie',
      load: page({
        // Marked cacheable, but the response carries a cookie: the adapter
        // must refuse to store it anyway.
        render: () => ({
          body: '<main>hi</main>',
          headers: { 'set-cookie': 'session=abc; Path=/' },
        }),
        cache: () => ({ mode: 'public', edgeSeconds: 60 }),
      }),
    },
    // A catch-all that would swallow the API if the dispatcher let it.
    {
      pattern: '/[...rest]',
      load: page({ render: () => '<main>catch-all</main>' }),
    },
  ],
};

const runtime = new Runtime<Locals>(manifest);
const rejectedTags: string[] = [];

const pages = createPageHandler<Env, Locals>({
  runtime,
  cache: workersPageCache('test-pages'),
  locals: ({ env }) => ({ greeting: env.GREETING }),
  onRejectedTag: (tag) => rejectedTags.push(tag),
  notFound: async () =>
    new Response('<main>themed 404</main>', {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
});

/**
 * The same pages behind a product's own cache-status header, so a consumer
 * that already publishes one does not have to expose a second name for the
 * same fact.
 */
const renamed = createPageHandler<Env, Locals>({
  runtime,
  cache: workersPageCache('test-pages-renamed'),
  cacheStatusHeader: 'x-product-cache',
  locals: ({ env }) => ({ greeting: env.GREETING }),
});

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/_test/renamed-status') {
      return await renamed(
        new Request(`${new URL(request.url).origin}/`),
        env,
        ctx,
      );
    }
    // The product's own routes come first. This is the ordering the runtime
    // documents and the test below pins.
    if (pathname === '/_api/ping') {
      return Response.json({ ok: true });
    }
    if (pathname === '/_test/rejected-tags') {
      return Response.json(rejectedTags);
    }
    return await pages(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

interface Env {
  readonly GREETING: string;
}
