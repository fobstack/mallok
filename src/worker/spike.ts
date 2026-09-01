/**
 * Measurement endpoints for Task 01. They exist only to answer the open
 * questions in docs/ARCHITECTURE.md §18 on a real account and are removed
 * once the results are written back. All routes require the bearer token.
 *
 * Wall-clock timers do not advance during CPU work inside a Worker, so these
 * endpoints do not time themselves: read CPU time per invocation from Workers
 * Logs (filter by URL) or from `wrangler tail --format=json`.
 */

import { renderFragment } from '../core/index.js';
import { purgeNow } from './cache.js';
import type { Env } from './env.js';
import { bearerMatches, json, problem } from './http.js';
import { handlePublic } from './public.js';

/** Routes `/_mallok/spike/*`. */
export async function handleSpike(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response> {
  if (!(await bearerMatches(request, env.MALLOK_SECRET))) {
    return problem(401, 'Unauthorized.');
  }
  const url = new URL(request.url);
  switch (pathname) {
    case '/_mallok/spike/cache-probe':
      return cacheProbe(request);
    case '/_mallok/spike/fragment':
      return fragment(url);
    case '/_mallok/spike/pbkdf2':
      return pbkdf2(url);
    case '/_mallok/spike/render':
      return coldRender(env, ctx, url);
    case '/_mallok/spike/purge':
      return purge(request, env);
    default:
      return problem(404, 'Not found.');
  }
}

/**
 * Writes a synthetic entry to the Cache API and reads it back. A miss on the
 * read tells us the cache is inert on this hostname (e.g. `.workers.dev`).
 */
async function cacheProbe(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const key = new Request(
    `${origin}/_mallok/spike/probe-${crypto.randomUUID()}`,
  );
  const value = new Response('probe', {
    headers: { 'cache-control': 'public, max-age=60' },
  });
  await caches.default.put(key, value);
  const hit = await caches.default.match(key);
  return json({
    host: new URL(request.url).host,
    cacheApiWorks: hit !== undefined,
  });
}

/** Renders a synthetic Markdown body of roughly `kb` kilobytes. */
async function fragment(url: URL): Promise<Response> {
  const kb = clamp(Number(url.searchParams.get('kb') ?? '16'), 1, 1024);
  const rounds = clamp(Number(url.searchParams.get('rounds') ?? '1'), 1, 20);
  const body = syntheticMarkdown(kb);
  let htmlBytes = 0;
  for (let i = 0; i < rounds; i++) {
    const result = await renderFragment({
      body,
      frontmatter: {},
      assets: {},
      mediaBaseUrl: '',
    });
    htmlBytes = result.html.length;
  }
  return json({ kb, rounds, markdownBytes: body.length, htmlBytes });
}

/** Derives a PBKDF2 key with the requested iteration count. */
async function pbkdf2(url: URL): Promise<Response> {
  const iterations = clamp(
    Number(url.searchParams.get('iterations') ?? '100000'),
    1_000,
    2_000_000,
  );
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('correct horse battery staple'),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('mallok-spike-salt'),
      iterations,
    },
    material,
    256,
  );
  return json({ iterations, bits: bits.byteLength * 8 });
}

/** Renders a public path without touching the edge cache. */
async function coldRender(
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const path = url.searchParams.get('path') ?? '/';
  const target = new Request(new URL(path, url.origin).toString(), {
    method: 'GET',
  });
  const response = await handlePublic(target, env, ctx, { bypassCache: true });
  return json({
    path,
    status: response.status,
    fragment: response.headers.get('x-mallok-fragment'),
    bytes: (await response.text()).length,
  });
}

/** Calls the purge API right away with the tags from the query string. */
async function purge(request: Request, env: Env): Promise<Response> {
  const tags = (new URL(request.url).searchParams.get('tags') ?? 'site')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  const result = await purgeNow(env, tags);
  return json(result);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function syntheticMarkdown(kb: number): string {
  const paragraph =
    'Titanium alloys combine **high strength** with low density, which is why ' +
    'aerospace buyers keep asking about *Grade 5* bar stock, `Ti-6Al-4V` plate ' +
    'and [seamless tubing](https://example.com/tubing). ';
  const block = [
    '## Section heading',
    '',
    paragraph.repeat(3),
    '',
    '- Item one with some text',
    '- Item two with `code`',
    '- Item three',
    '',
    '| Grade | Density | Tensile |',
    '|-------|---------|---------|',
    '| Gr2   | 4.51    | 345 MPa |',
    '| Gr5   | 4.43    | 895 MPa |',
    '',
    '![Furnace](images/furnace.jpg)',
    '',
    '> A quoted remark from a mill engineer.',
    '',
  ].join('\n');
  const target = kb * 1024;
  let out = '# Synthetic article\n\n';
  while (out.length < target) {
    out += block;
  }
  return out;
}
