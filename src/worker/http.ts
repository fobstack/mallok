/** Small HTTP helpers shared by the Worker routes. */

const NO_STORE = 'private, no-store';

/** JSON response with `no-store` caching, suitable for admin and API routes. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', NO_STORE);
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** The variable parts of an error's sentence, by name. */
export type ProblemParams = Readonly<Record<string, string | number>>;

/**
 * Plain-text error response that never leaks internals.
 *
 * `error` is English and stays exactly as written: the CLI prints it and it
 * is every client's fallback. A `code`, when given, names the sentence so
 * the admin can say it in its interface language, with `params` filling in
 * what varies (docs/ADMIN_I18N_AND_UI.md, D3). A code never changes once
 * shipped; a new sentence gets a new code.
 */
export function problem(
  status: number,
  message: string,
  code?: string,
  params?: ProblemParams,
): Response {
  return json(
    {
      error: message,
      ...(code === undefined ? {} : { code }),
      ...(params === undefined ? {} : { params }),
    },
    { status },
  );
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

/**
 * The languages an `Accept-Language` header asks for, most wanted first:
 * `zh-CN,zh;q=0.9,en;q=0.8` gives `["zh-CN", "zh", "en"]`. A `*`, a zero
 * weight and anything unparseable are left out.
 */
export function preferredLanguages(header: string | null): string[] {
  if (header === null) {
    return [];
  }
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const weight = params
        .map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param)?.[1])
        .find((value) => value !== undefined);
      return {
        tag: tag.trim(),
        q: weight === undefined ? 1 : Number(weight),
        index,
      };
    })
    .filter(
      (entry) =>
        /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(entry.tag) &&
        Number.isFinite(entry.q) &&
        entry.q > 0,
    )
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}
