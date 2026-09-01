/**
 * `/media/*` proxy from R2. Only used before an R2 custom domain is
 * configured (docs/ARCHITECTURE.md §8); objects are content-addressed, so
 * responses are immutable.
 */

import type { Env } from './env.js';
import { problem } from './http.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const KEY_PATTERN = /^\/media\/([a-f0-9]{64}(?:_\d+)?\.[a-z0-9]{1,8})$/;

/** Serves one media object. */
export async function handleMedia(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return problem(405, 'Method not allowed.');
  }
  const match = KEY_PATTERN.exec(pathname);
  if (match === null) {
    return problem(404, 'Not found.');
  }
  const object = await env.MEDIA.get(`media/${match[1]}`);
  if (object === null) {
    return problem(404, 'Not found.');
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', IMMUTABLE);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/octet-stream');
  }
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers,
  });
}
