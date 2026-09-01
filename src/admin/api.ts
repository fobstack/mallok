/**
 * The one way the admin talks to the server.
 *
 * It calls the same management API the CLI calls (docs/ADMIN.md §2): there is
 * no private admin endpoint, so anything the UI can do is scriptable. Session
 * requests carry the CSRF header on every write (docs/SECURITY.md §3).
 */

const BASE = '/_mallok/api';

/** A failed request, carrying the server's own message. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The CSRF token of the current session, set at login and on reload. */
let csrfToken = '';

/** Records the CSRF token the login (or `auth/me`) response returned. */
export function setCsrf(token: string): void {
  csrfToken = token;
}

/** The current CSRF token, for callers that build their own requests. */
export function csrf(): string {
  return csrfToken;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly raw?: BodyInit;
  readonly headers?: Record<string, string>;
}

/**
 * Performs one API call and returns the parsed body.
 *
 * Network failures surface as errors rather than empty state: the admin must
 * never silently drop an edit (docs/ADMIN.md §13).
 */
export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('x-mallok-csrf', csrfToken);
  }
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
  } else if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    throw new ApiError(
      0,
      'The server could not be reached. Nothing was saved.',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message =
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return parsed as T;
}
