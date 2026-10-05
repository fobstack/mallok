import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    ],
  },
  routes: {
    cart: echo('cart'),
    'orders/:orderNo': echo('orders/:orderNo'),
    'orders/new': echo('orders/new'),
    'items/:sku/notes/:noteId': echo('items/:sku/notes/:noteId'),
    echo: echo('echo'),
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
      { path: 'ping', method: 'POST' },
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
});
