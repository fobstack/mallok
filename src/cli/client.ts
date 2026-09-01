/**
 * The CLI's view of a Mallok site: the same management API the admin calls
 * (docs/CLI.md §2), authenticated with a scoped, revocable API token.
 *
 * The token is never written to a file (docs/CLI.md §4).
 */

import { CliError, EXIT } from './output.js';

/** How the CLI reaches one site. */
export interface SiteClient {
  readonly origin: string;
  readonly get: <T>(path: string) => Promise<T>;
  readonly post: <T>(path: string, body: unknown) => Promise<T>;
  readonly patch: <T>(path: string, body: unknown) => Promise<T>;
  readonly put: (
    path: string,
    body: ArrayBuffer | Uint8Array,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  /** Fetches a site-relative URL as bytes; used by export. */
  readonly bytes: (path: string) => Promise<Uint8Array>;
}

function describe(status: number, message: string): CliError {
  if (status === 401 || status === 403) {
    return new CliError(
      EXIT.auth,
      message,
      'Check MALLOK_TOKEN, and that the token has the scope this command needs.',
    );
  }
  if (status === 429) {
    return new CliError(
      EXIT.remote,
      'The site is rate limiting this client.',
      'Wait a minute and run the command again.',
    );
  }
  if (status >= 500) {
    return new CliError(
      EXIT.remote,
      message,
      "If this persists, the site's daily database quota may be exhausted; " +
        'it resets at 00:00 UTC.',
    );
  }
  return new CliError(EXIT.user, message);
}

/** Creates a client for one site. `verbose` logs each request to stderr. */
export function createClient(
  origin: string,
  token: string,
  verbose = false,
): SiteClient {
  const base = origin.replace(/\/$/, '');
  const auth = { authorization: `Bearer ${token}` };

  const call = async (
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const method = init.method ?? 'GET';
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...auth, ...(init.headers ?? {}) },
      });
      if (verbose) {
        // The token never appears here, only the path and the outcome.
        process.stderr.write(
          `  → ${method} ${path} ${response.status} (${Date.now() - started}ms)\n`,
        );
      }
    } catch {
      if (verbose) {
        process.stderr.write(`  → ${method} ${path} failed to connect\n`);
      }
      // A connection failure and a rejection are different problems and get
      // different wording (docs/CLI.md §12).
      throw new CliError(
        EXIT.remote,
        `Could not reach ${base}.`,
        'Check the address and your network connection.',
      );
    }
    return response;
  };

  const readError = async (response: Response): Promise<string> => {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: string };
      return parsed.error ?? `The site returned ${response.status}.`;
    } catch {
      return `The site returned ${response.status}.`;
    }
  };

  return {
    origin: base,
    async get<T>(path: string): Promise<T> {
      const response = await call(`/_mallok/api${path}`);
      if (!response.ok) {
        throw describe(response.status, await readError(response));
      }
      return (await response.json()) as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      const response = await call(`/_mallok/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw describe(response.status, await readError(response));
      }
      return (await response.json()) as T;
    },
    async patch<T>(path: string, body: unknown): Promise<T> {
      const response = await call(`/_mallok/api${path}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw describe(response.status, await readError(response));
      }
      return (await response.json()) as T;
    },
    async put(path, body, headers = {}) {
      return call(`/_mallok/api${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', ...headers },
        body: body as BodyInit,
      });
    },
    async bytes(path: string): Promise<Uint8Array> {
      const response = await call(path);
      if (!response.ok) {
        throw describe(response.status, await readError(response));
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
