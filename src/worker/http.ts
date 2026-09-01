/** Small HTTP helpers shared by the Worker routes. */

const NO_STORE = 'private, no-store';

/** JSON response with `no-store` caching, suitable for admin and API routes. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', NO_STORE);
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** Plain-text error response that never leaks internals. */
export function problem(status: number, message: string): Response {
  return json({ error: message }, { status });
}

/** HTML response for public pages. */
export function html(body: string, headers: HeadersInit = {}): Response {
  const merged = new Headers(headers);
  merged.set('content-type', 'text/html; charset=utf-8');
  return new Response(body, { headers: merged });
}

/**
 * Constant-time comparison of a presented bearer token with the expected
 * secret. Returns `false` for missing or malformed headers.
 */
export async function bearerMatches(
  request: Request,
  secret: string,
): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match === null) {
    return false;
  }
  const presented = match[1] ?? '';
  const encoder = new TextEncoder();
  const a = await crypto.subtle.digest('SHA-256', encoder.encode(presented));
  const b = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Reads a JSON body, returning `null` when it is missing or malformed. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
