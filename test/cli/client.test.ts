import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../../src/cli/client.js';
import { CliError, EXIT } from '../../src/cli/output.js';

/**
 * The client is what stands between a user's token and a remote site, so the
 * behaviour worth pinning is not "it can fetch" but the three things that are
 * easy to get wrong and expensive to notice late: which exit code a given
 * status produces, that a failure to connect is reported as a connection
 * failure rather than a rejection, and that the token never reaches the
 * terminal even in verbose mode (docs/CLI.md §4, §12).
 */

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** Installs a fetch that answers every call the same way, recording each. */
function stubFetch(reply: () => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return await reply();
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function codeOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CliError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('the call was expected to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the CLI site client', () => {
  it('sends the bearer token and the API prefix, and returns the parsed body', async () => {
    const calls = stubFetch(() => json({ items: [{ id: 'one' }] }));
    const client = createClient('https://example.com/', 'token-abc');

    const result = await client.get<{ items: { id: string }[] }>('/content');

    expect(result.items[0]?.id).toBe('one');
    expect(calls).toHaveLength(1);
    // The trailing slash on the origin must not produce a doubled slash.
    expect(calls[0]?.url).toBe('https://example.com/_mallok/api/content');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-abc');
  });

  it('sends JSON bodies for post and patch', async () => {
    const calls = stubFetch(() => json({ id: 'saved' }));
    const client = createClient('https://example.com', 'token-abc');

    await client.post('/content', { slug: 'a' });
    await client.patch('/content/1', { slug: 'b' });

    expect(calls.map((call) => call.init.method)).toEqual(['POST', 'PATCH']);
    expect(calls[0]?.init.body).toBe('{"slug":"a"}');
    const headers = calls[1]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('puts raw bytes and returns the response without parsing it', async () => {
    const calls = stubFetch(() => new Response('', { status: 201 }));
    const client = createClient('https://example.com', 'token-abc');

    const response = await client.put('/media/abc', new Uint8Array([1, 2, 3]), {
      'x-mallok-filename': 'a.png',
    });

    expect(response.status).toBe(201);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['x-mallok-filename']).toBe('a.png');
  });

  it('fetches site-relative bytes without the API prefix', async () => {
    const calls = stubFetch(
      () => new Response(new Uint8Array([7, 8, 9]), { status: 200 }),
    );
    const client = createClient('https://example.com', 'token-abc');

    const bytes = await client.bytes('/media/original/abc.png');

    expect([...bytes]).toEqual([7, 8, 9]);
    expect(calls[0]?.url).toBe('https://example.com/media/original/abc.png');
  });

  it('maps each failure class to the exit code the contract promises', async () => {
    const client = createClient('https://example.com', 'token-abc');

    for (const [status, expected] of [
      [401, EXIT.auth],
      [403, EXIT.auth],
      [429, EXIT.remote],
      [500, EXIT.remote],
      [503, EXIT.remote],
      [400, EXIT.user],
      [404, EXIT.user],
    ] as const) {
      stubFetch(() => json({ error: 'no' }, status));
      expect(await codeOf(() => client.get('/content'))).toBe(expected);
      vi.unstubAllGlobals();
    }
  });

  it('reports the API error message, and falls back when the body is not JSON', async () => {
    stubFetch(() => json({ error: 'That slug is already taken.' }, 400));
    const client = createClient('https://example.com', 'token-abc');
    await expect(client.get('/content')).rejects.toThrow(
      'That slug is already taken.',
    );

    vi.unstubAllGlobals();
    stubFetch(() => new Response('<html>gateway</html>', { status: 502 }));
    await expect(client.get('/content')).rejects.toThrow(
      'The site returned 502.',
    );
  });

  it('distinguishes a failure to connect from a rejected request', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const client = createClient('https://offline.example', 'token-abc');

    const error = await client.get('/content').catch((cause) => cause);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe(EXIT.remote);
    expect((error as CliError).message).toBe(
      'Could not reach https://offline.example.',
    );
    expect((error as CliError).hint).toContain('network connection');
  });

  it('never writes the token to stderr in verbose mode', async () => {
    stubFetch(() => json({}));
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });

    try {
      const client = createClient('https://example.com', 'sk-secret', true);
      await client.get('/content');
      vi.unstubAllGlobals();
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed');
      });
      await client.get('/content').catch(() => undefined);
    } finally {
      spy.mockRestore();
    }

    expect(written.join('')).not.toContain('sk-secret');
    expect(written.join('')).toContain('GET /_mallok/api/content');
    expect(written.join('')).toContain('failed to connect');
  });
});
