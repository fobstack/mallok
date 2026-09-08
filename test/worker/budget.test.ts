import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { cacheKeyFor } from '../../src/worker/cache.js';
import { handlePublicPage } from '../../src/worker/pages/runtime.js';

/**
 * Measures the D1 call budget of a cold page render
 * (docs/ARCHITECTURE.md §4, `AC-INV-05`).
 *
 * The binding is wrapped so every `batch` and every `prepare(...).all/first/
 * run` is counted. This is a measurement, not a guard: the numbers it prints
 * are what §14 of docs/ACCEPTANCE.md records.
 */

const ORIGIN = 'https://budget.example';
const EMAIL = 'budget@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';

/**
 * Renders a page with nothing served from, or written to, the edge cache.
 *
 * The entry is dropped first so the render is genuinely cold, and the
 * `waitUntil` given here does nothing, so the fresh response is never stored
 * and a later measurement of the same path is cold too.
 */
async function coldRender(path: string, db: D1Database): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`);
  await caches.default.delete(cacheKeyFor(request));
  return await render(request, db, () => undefined);
}

/** Renders through the real handler, with control over `waitUntil`. */
async function render(
  request: Request,
  db: D1Database,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const ctx = {
    waitUntil,
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
  return await handlePublicPage(request, { ...env, DB: db } as typeof env, ctx);
}

/** Counts D1 round trips: `batch` is one, each statement verb is one. */
function countingDb(real: D1Database): { db: D1Database; calls: string[] } {
  const calls: string[] = [];
  const wrapStatement = (statement: D1PreparedStatement, sql: string) =>
    new Proxy(statement, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property === 'bind') {
          return (...args: unknown[]) =>
            wrapStatement(
              (target.bind as (...a: unknown[]) => D1PreparedStatement)(
                ...args,
              ),
              sql,
            );
        }
        if (
          property === 'all' ||
          property === 'first' ||
          property === 'run' ||
          property === 'raw'
        ) {
          return (...args: unknown[]) => {
            calls.push(`${String(property)}: ${sql.slice(0, 60)}`);
            return (value as (...a: unknown[]) => unknown)(...args);
          };
        }
        return value;
      },
    });

  const db = new Proxy(real, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property === 'batch') {
        return (statements: unknown[]) => {
          calls.push(`batch(${statements.length})`);
          return (value as (s: unknown[]) => unknown).call(target, statements);
        };
      }
      if (property === 'prepare') {
        return (sql: string) =>
          wrapStatement(
            (value as (s: string) => D1PreparedStatement).call(target, sql),
            sql,
          );
      }
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
  return { db, calls };
}

async function api(method: string, path: string, body?: unknown) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('cold render D1 budget', () => {
  let path = '';

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
        name: 'budget',
        scopes: ['content:write', 'settings:write'],
      }),
    });
    token = ((await minted.json()) as { token: string }).token;

    const created = await api('POST', '/_mallok/api/content', {
      kind: 'article',
      slug: 'budget-page',
      markdown: '---\ntitle: Budget\n---\n\nBody with no media.',
    });
    path = ((await created.json()) as { path: string }).path;
  });

  it('makes exactly two D1 round trips for a cold content render', async () => {
    const { db, calls } = countingDb(env.DB);
    const response = await coldRender(path, db);
    expect(response.status).toBe(200);

    // The exact sequence, not just the count: a regression that splits one
    // batch into two single statements keeps the count and loses the point.
    // `batch(5)` is the speculative load, `batch(1)` the fragment lookup.
    expect(calls).toEqual(['batch(5)', 'batch(1)']);
  });

  it('makes no D1 calls at all when the page cache hits', async () => {
    // Warm the cache through the real path: `waitUntil` must actually be
    // awaited, or the entry is still being written when the next request runs.
    const request = new Request(`${ORIGIN}${path}`);
    await caches.default.delete(cacheKeyFor(request));
    const pending: Promise<unknown>[] = [];
    const warm = await render(request, env.DB, (promise) => {
      pending.push(promise);
    });
    expect(warm.headers.get('x-mallok-cache')).toBe('MISS');
    await Promise.all(pending);

    const { db, calls } = countingDb(env.DB);
    const hit = await render(
      new Request(`${ORIGIN}${path}`),
      db,
      () => undefined,
    );
    expect(hit.headers.get('x-mallok-cache')).toBe('HIT');
    // The whole point of the edge cache: a hit must not touch the database.
    expect(calls).toEqual([]);
  });

  it('records the worst realistic case: media plus relations', async () => {
    // A product page is the heaviest content page the trade theme renders:
    // a category reference resolved forward, sibling products, and a cover.
    await api('PATCH', '/_mallok/api/settings', {
      kinds: {
        page: { base: '' },
        article: { base: 'news' },
        product: { base: 'products' },
        category: { base: 'families' },
      },
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'category',
      slug: 'family',
      markdown: '---\ntitle: Family\n---\n\nA family.',
    });
    await api('POST', '/_mallok/api/content', {
      kind: 'product',
      slug: 'sibling',
      markdown: '---\ntitle: Sibling\ncategory: family\n---\n\nAnother.',
    });
    const created = await api('POST', '/_mallok/api/content', {
      kind: 'product',
      slug: 'heavy',
      markdown:
        '---\ntitle: Heavy\ncategory: family\n---\n\n![a](images/a.png)',
    });
    const heavyPath = ((await created.json()) as { path: string }).path;

    const { db, calls } = countingDb(env.DB);
    const response = await coldRender(heavyPath, db);
    expect(response.status).toBe(200);
    // `batch(3)` rather than `batch(1)`: the cover image and the related
    // items are resolved in the same second round trip.
    expect(calls).toEqual(['batch(5)', 'batch(3)']);
  });
});
