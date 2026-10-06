import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSiteRenderData } from '../../src/db/queries.js';
import { definePlugin } from '../../src/plugins/define.js';
import { inquiryPlugin } from '../../src/plugins/inquiry/index.js';
import type {
  PluginRequestContext,
  RouteInput,
} from '../../src/plugins/types.js';
import { resetBootForTests } from '../../src/worker/bootstrap.js';
import {
  activeTheme,
  compiledPlugins,
  configure,
} from '../../src/worker/composition.js';
import { handlePluginRoute } from '../../src/worker/plugin-runtime.js';
import { parseSiteSettings } from '../../src/worker/site.js';

/**
 * Plugin routes under plugin API 2 (docs/PLUGIN_API.md §7.2): several
 * segments, parameters, a locale segment, and JSON bodies kept whole — and a
 * version 1 plugin routed exactly as it always was.
 */

const ORIGIN = 'https://plugin-routes.example';
const EMAIL = 'routes@example.com';
const PASSWORD = 'a sufficiently long password';

/** Answers with what the handler was given, so a test can read it back. */
function echo(route: string) {
  return async (
    input: RouteInput,
    ctx: PluginRequestContext,
  ): Promise<Response> =>
    Response.json({
      route,
      params: input.params,
      fields: input.fields,
      // `undefined` does not survive JSON; say so explicitly.
      json: input.json === undefined ? 'undefined' : input.json,
      locale: ctx.locale,
    });
}

const HOOK_KEY = 'fixture-signing-key';

async function hmacHex(key: string, bytes: ArrayBuffer): Promise<string> {
  const imported = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', imported, bytes);
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A webhook as a payment provider's is handled: the signature is over the
 * bytes of the body, and the status code tells the sender what to do next.
 */
async function signedHook(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const bytes = await ctx.request.arrayBuffer();
  const expected = await hmacHex(HOOK_KEY, bytes);
  if (ctx.request.headers.get('x-signature') !== expected) {
    return new Response('bad signature', { status: 400 });
  }
  const text = new TextDecoder().decode(bytes);
  if (text.includes('"fail"')) {
    return new Response('try again', { status: 500 });
  }
  return Response.json(
    {
      bytes: bytes.byteLength,
      text,
      fields: input.fields,
      json: input.json === undefined ? 'undefined' : input.json,
    },
    { status: text.includes('"later"') ? 202 : 200 },
  );
}

const shop = definePlugin({
  manifest: {
    id: 'shop',
    name: 'Shop',
    version: '1.0.0',
    pluginApi: 2,
    routes: [
      { path: 'cart', method: 'GET' },
      { path: 'orders/:orderNo', method: 'GET' },
      { path: 'orders/new', method: 'GET' },
      { path: 'items/:sku/notes/:noteId', method: 'POST' },
      { path: 'echo', method: 'POST' },
      { path: 'cart/add', method: 'POST', rateLimit: 'relaxed' },
      { path: 'cart/remove', method: 'POST', rateLimit: 'relaxed' },
      { path: 'checkout', method: 'POST', rateLimit: 'strict' },
      { path: 'quote/:id', method: 'POST', rateLimit: true },
      { path: 'webhook', method: 'POST', body: 'raw' },
      { path: 'tiny-hook', method: 'POST', body: 'raw', maxBytes: 16 },
    ],
  },
  routes: {
    cart: echo('cart'),
    'orders/:orderNo': echo('orders/:orderNo'),
    'orders/new': echo('orders/new'),
    'items/:sku/notes/:noteId': echo('items/:sku/notes/:noteId'),
    echo: echo('echo'),
    'cart/add': echo('cart/add'),
    'cart/remove': echo('cart/remove'),
    checkout: echo('checkout'),
    'quote/:id': echo('quote/:id'),
    webhook: signedHook,
    'tiny-hook': signedHook,
  },
});

/** Written for version 1, with a route name that happens to look like a locale. */
const legacy = definePlugin({
  manifest: {
    id: 'legacy',
    name: 'Legacy',
    version: '1.0.0',
    pluginApi: 1,
    routes: [
      { path: 'de', method: 'GET' },
      { path: 'ping', method: 'POST', rateLimit: true },
    ],
  },
  routes: { de: echo('de'), ping: echo('ping') },
});

interface Echo {
  route: string;
  params: Record<string, string>;
  fields: Record<string, string>;
  json: unknown;
  locale: string;
}

function get(path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/p/${path}`);
}

function post(path: string, body: BodyInit, type: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/p/${path}`, {
    method: 'POST',
    headers: { 'content-type': type },
    body,
  });
}

async function read(response: Response): Promise<Echo> {
  expect(response.status).toBe(200);
  return (await response.json()) as Echo;
}

describe('plugin routes', () => {
  const original = { theme: activeTheme(), plugins: compiledPlugins() };

  beforeAll(async () => {
    configure({
      theme: original.theme,
      plugins: [inquiryPlugin, shop, legacy],
    });
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
    const locales = await admin('PATCH', '/_mallok/api/settings', {
      locales: ['en', 'de'],
    });
    expect(locales.status).toBe(200);
    for (const id of ['shop', 'legacy']) {
      await admin('POST', `/_mallok/api/plugins/${id}/enabled`, {
        enabled: true,
      });
    }
  });

  afterAll(() => {
    configure(original);
    resetBootForTests();
  });

  describe('paths and parameters', () => {
    it('matches several segments and hands over the parameters', async () => {
      const order = await read(await get('shop/orders/A-1001'));
      expect(order.route).toBe('orders/:orderNo');
      expect(order.params).toEqual({ orderNo: 'A-1001' });

      const note = await read(
        await post('shop/items/TI-6AL/notes/7', '{}', 'application/json'),
      );
      expect(note.route).toBe('items/:sku/notes/:noteId');
      expect(note.params).toEqual({ sku: 'TI-6AL', noteId: '7' });
    });

    it('prefers a fixed segment to a parameter in the same place', async () => {
      const fixed = await read(await get('shop/orders/new'));
      expect(fixed.route).toBe('orders/new');
      expect(fixed.params).toEqual({});
    });

    it('decodes a parameter, and refuses what would change the path', async () => {
      const spaced = await read(await get('shop/orders/A%201001'));
      expect(spaced.params).toEqual({ orderNo: 'A 1001' });

      for (const bad of [
        'shop/orders/%E0%A4%A', // not valid encoding
        'shop/orders/a%2Fb', // an encoded slash is still a slash
        'shop/orders/%2E%2E',
        `shop/orders/${'x'.repeat(201)}`,
        'shop/orders/', // trailing slash
        'shop//cart',
        'shop/orders',
        'shop/orders/1/extra',
        'shop/nothing',
      ]) {
        expect((await get(bad)).status, bad).toBe(404);
      }
    });

    it('answers 405 for a declared path with the wrong method', async () => {
      const response = await post('shop/cart', '{}', 'application/json');
      expect(response.status).toBe(405);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });
  });

  describe('the locale segment', () => {
    it("is the request's locale when it is one of the site's", async () => {
      expect((await read(await get('shop/de/cart'))).locale).toBe('de');
      expect((await read(await get('shop/en/cart'))).locale).toBe('en');
      const order = await read(await get('shop/de/orders/A-1'));
      expect(order.locale).toBe('de');
      expect(order.params).toEqual({ orderNo: 'A-1' });
    });

    it('leaves the default locale when there is none', async () => {
      expect((await read(await get('shop/cart'))).locale).toBe('en');
    });

    it('does not mistake any other first segment for a locale', async () => {
      // `fr` has the shape of a locale and is not one of this site's.
      expect((await get('shop/fr/cart')).status).toBe(404);
      // A parameter that looks like a locale is still a parameter.
      const order = await read(await get('shop/orders/de'));
      expect(order.route).toBe('orders/:orderNo');
      expect(order.params).toEqual({ orderNo: 'de' });
      expect(order.locale).toBe('en');
      // A locale alone names no route.
      expect((await get('shop/de')).status).toBe(404);
    });
  });

  describe('request bodies', () => {
    it('keeps numbers, booleans and nested values of a JSON body', async () => {
      const body = {
        sku: 'TI-6AL',
        quantity: 3,
        gift: true,
        note: null,
        lines: [{ id: 1, qty: 2 }],
      };
      const seen = await read(
        await post('shop/echo', JSON.stringify(body), 'application/json'),
      );
      expect(seen.json).toEqual(body);
      // Only the string members are form-like fields, as before.
      expect(seen.fields).toEqual({ sku: 'TI-6AL' });
    });

    it('gives a form its fields and no JSON', async () => {
      const seen = await read(
        await post(
          'shop/echo',
          new URLSearchParams({ sku: 'TI-6AL', quantity: '3' }).toString(),
          'application/x-www-form-urlencoded',
        ),
      );
      expect(seen.fields).toEqual({ sku: 'TI-6AL', quantity: '3' });
      expect(seen.json).toBe('undefined');
      expect((await read(await get('shop/cart'))).json).toBe('undefined');
    });

    it('passes an array through, and still refuses a scalar or broken JSON', async () => {
      // An array was accepted before `input.json` existed, with no fields;
      // that is unchanged, and now the handler can read it.
      const list = await read(
        await post('shop/echo', '[1, 2]', 'application/json'),
      );
      expect(list.json).toEqual([1, 2]);
      expect(list.fields).toEqual({});
      for (const body of ['7', 'null', '"text"', '{broken']) {
        const response = await post('shop/echo', body, 'application/json');
        expect(response.status, body).toBe(400);
      }
    });
  });

  describe('a version 1 plugin', () => {
    it('is routed as before: one segment, the default locale', async () => {
      const ping = await read(
        await post('legacy/ping', '{"a":"b","n":1}', 'application/json'),
      );
      expect(ping.route).toBe('ping');
      expect(ping.locale).toBe('en');
      expect(ping.fields).toEqual({ a: 'b' });
      expect(ping.params).toEqual({});
    });

    it('keeps a route named like a locale reachable', async () => {
      // `de` is one of this site's locales. For a version 1 plugin the
      // segment is the route, as it was before locale segments existed.
      const seen = await read(await get('legacy/de'));
      expect(seen.route).toBe('de');
      expect(seen.locale).toBe('en');
    });

    it('gets no locale segment and no second segment', async () => {
      expect((await get('legacy/de/de')).status).toBe(404);
      expect(
        (await post('legacy/de/ping', '{}', 'application/json')).status,
      ).toBe(404);
    });
  });

  describe('rate-limit tiers', () => {
    /** A binding that records its keys and refuses the ones it is told to. */
    function limiter(refuse: (key: string) => boolean = () => false) {
      const keys: string[] = [];
      return {
        keys,
        binding: {
          limit: async ({ key }: { key: string }) => {
            keys.push(key);
            return { success: !refuse(key) };
          },
        },
      };
    }

    async function call(
      path: string,
      bindings: {
        strict?: ReturnType<typeof limiter>;
        relaxed?: ReturnType<typeof limiter>;
      },
      ip = '203.0.113.7',
    ): Promise<Response> {
      const data = await loadSiteRenderData(env.DB);
      if (data.site === null) {
        throw new Error('no site');
      }
      const { RATE_LIMITER: _a, RATE_LIMITER_RELAXED: _b, ...bare } = env;
      const pathname = `/_mallok/p/${path}`;
      return handlePluginRoute(
        new Request(`${ORIGIN}${pathname}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'cf-connecting-ip': ip,
          },
          body: '{}',
        }),
        {
          ...bare,
          ...(bindings.strict === undefined
            ? {}
            : { RATE_LIMITER: bindings.strict.binding }),
          ...(bindings.relaxed === undefined
            ? {}
            : { RATE_LIMITER_RELAXED: bindings.relaxed.binding }),
        } as typeof env,
        {
          waitUntil: () => undefined,
          passThroughOnException: () => undefined,
          props: {},
        } as unknown as ExecutionContext,
        pathname,
        data.plugins,
        parseSiteSettings(data.site),
      );
    }

    it('sends each tier to its own binding, counted per route and visitor', async () => {
      const strict = limiter();
      const relaxed = limiter();
      for (const path of [
        'shop/cart/add',
        'shop/de/cart/add',
        'shop/cart/remove',
        'shop/checkout',
        'shop/quote/7',
        'shop/quote/8',
        'legacy/ping',
        'shop/echo',
      ]) {
        expect((await call(path, { strict, relaxed })).status, path).toBe(200);
      }
      // The locale is not part of the key, nor is a parameter's value.
      expect(relaxed.keys).toEqual([
        'shop:cart/add:203.0.113.7',
        'shop:cart/add:203.0.113.7',
        'shop:cart/remove:203.0.113.7',
      ]);
      // `true` is the strict tier, for a version 1 plugin as well; a route
      // that declares no limit asks neither binding.
      expect(strict.keys).toEqual([
        'shop:checkout:203.0.113.7',
        'shop:quote/:id:203.0.113.7',
        'shop:quote/:id:203.0.113.7',
        'legacy:ping:203.0.113.7',
      ]);
    });

    it('lets one route run out without touching another', async () => {
      const strict = limiter();
      const relaxed = limiter((key) => key.startsWith('shop:cart/add:'));
      const refused = await call('shop/cart/add', { strict, relaxed });
      expect(refused.status).toBe(429);
      expect(refused.headers.get('cache-control')).toBe('private, no-store');
      expect((await call('shop/cart/remove', { strict, relaxed })).status).toBe(
        200,
      );
      expect((await call('shop/checkout', { strict, relaxed })).status).toBe(
        200,
      );
      // Another visitor has a count of their own.
      const other = limiter((key) => key.endsWith(':203.0.113.7'));
      expect(
        (await call('shop/checkout', { strict: other }, '198.51.100.9')).status,
      ).toBe(200);
      expect(other.keys).toEqual(['shop:checkout:198.51.100.9']);
    });

    it('falls back to the strict binding when the relaxed one is missing, and says so', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const strict = limiter((key) => key.startsWith('shop:cart/add:'));
      const response = await call('shop/cart/add', { strict });
      // Guarded by the tighter limit rather than not at all.
      expect(strict.keys).toEqual(['shop:cart/add:203.0.113.7']);
      expect(response.status).toBe(429);
      expect(
        warn.mock.calls.map((entry) => JSON.parse(String(entry[0])) as object),
      ).toEqual([
        {
          event: 'rate_limit_binding_missing',
          binding: 'RATE_LIMITER_RELAXED',
          plugin: 'shop',
          route: 'cart/add',
          fallback: 'RATE_LIMITER',
        },
      ]);
      warn.mockRestore();
    });

    it('lets requests through when the site has no rate-limit binding at all', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      for (const path of ['shop/cart/add', 'shop/checkout', 'legacy/ping']) {
        expect((await call(path, {})).status, path).toBe(200);
      }
      // Nothing to fall back to is the documented best-effort state, not an
      // event per request.
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('a raw-body route', () => {
    async function send(
      path: string,
      body: string | Uint8Array,
      headers: Record<string, string> = {},
      signed = true,
    ): Promise<Response> {
      const bytes =
        typeof body === 'string' ? new TextEncoder().encode(body) : body;
      return SELF.fetch(`${ORIGIN}/_mallok/p/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(signed
            ? {
                'x-signature': await hmacHex(
                  HOOK_KEY,
                  bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  ) as ArrayBuffer,
                ),
              }
            : {}),
          ...headers,
        },
        body: bytes,
      });
    }

    it('hands the handler the exact bytes that were sent, so a signature over them verifies', async () => {
      // Everything a parser would normalise away: key order, spacing, CRLF,
      // a trailing newline, non-ASCII, a number written with an exponent.
      const payload = '{ "b":1,\r\n  "a" : "Grüße — 你好",   "n": 1e3 }\r\n\n';
      const response = await send('shop/webhook', payload);
      expect(response.status).toBe(200);
      const seen = (await response.json()) as {
        bytes: number;
        text: string;
        fields: unknown;
        json: unknown;
      };
      expect(seen.text).toBe(payload);
      expect(seen.bytes).toBe(new TextEncoder().encode(payload).byteLength);
      // Nothing was parsed on the way.
      expect(seen.fields).toEqual({});
      expect(seen.json).toBe('undefined');

      // Bytes that are not text at all, and a body that is not JSON.
      const binary = new Uint8Array([0, 255, 13, 10, 128, 0]);
      expect(
        (
          (await (await send('shop/webhook', binary)).json()) as {
            bytes: number;
          }
        ).bytes,
      ).toBe(6);
      expect((await send('shop/webhook', '{not json')).status).toBe(200);
      expect((await send('shop/webhook', '')).status).toBe(200);
    });

    it("passes the handler's status code through unchanged", async () => {
      // The sender decides what to do next from it.
      expect((await send('shop/webhook', '{"ok":1}', {}, false)).status).toBe(
        400,
      );
      expect((await send('shop/webhook', '{"x":"fail"}')).status).toBe(500);
      expect((await send('shop/webhook', '{"x":"later"}')).status).toBe(202);
      const response = await send('shop/webhook', '{"ok":1}');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it("is not held to a browser's cross-site rules", async () => {
      // Another server calls it; the signature is what authenticates it.
      const response = await send('shop/webhook', '{"ok":1}', {
        'sec-fetch-site': 'cross-site',
        origin: 'https://payments.example',
      });
      expect(response.status).toBe(200);
      // A parsed route with the same headers is still refused.
      expect((await post('shop/echo', '{}', 'application/json')).status).toBe(
        200,
      );
      const refused = await SELF.fetch(`${ORIGIN}/_mallok/p/shop/echo`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'sec-fetch-site': 'cross-site',
        },
        body: '{}',
      });
      expect(refused.status).toBe(403);
    });

    it('refuses a body over its cap before the handler runs', async () => {
      const big = 'x'.repeat(256 * 1024 + 1);
      expect((await send('shop/webhook', big)).status).toBe(413);
      expect((await send('shop/webhook', 'x'.repeat(256 * 1024))).status).toBe(
        200,
      );
      // A route's own, smaller cap.
      expect((await send('shop/tiny-hook', 'x'.repeat(16))).status).toBe(200);
      expect((await send('shop/tiny-hook', 'x'.repeat(17))).status).toBe(413);

      // A stream with no declared length is cut off as it is read.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(10)));
          controller.enqueue(new TextEncoder().encode('x'.repeat(10)));
          controller.close();
        },
      });
      const streamed = await SELF.fetch(`${ORIGIN}/_mallok/p/shop/tiny-hook`, {
        method: 'POST',
        body: stream,
        duplex: 'half',
      } as RequestInit);
      expect(streamed.status).toBe(413);
    });
  });
});
