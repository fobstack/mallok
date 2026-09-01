import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://auth.example';
const EMAIL = 'admin@example.com';
const PASSWORD = 'a sufficiently long password';

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

async function post(
  path: string,
  body: unknown,
  headers: HeadersInit = {},
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function signIn(password = PASSWORD): Promise<Session> {
  const response = await post('/_mallok/api/auth/login', {
    email: EMAIL,
    password,
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const { csrf } = (await response.json()) as { csrf: string };
  return { cookie: setCookie.split(';')[0] ?? '', csrf };
}

async function mintToken(
  session: Session,
  scopes: readonly string[],
): Promise<string> {
  const response = await post(
    '/_mallok/api/tokens',
    { name: `token-${scopes.join('-')}`, scopes },
    { cookie: session.cookie, 'x-mallok-csrf': session.csrf },
  );
  const body = (await response.json()) as { token: string };
  return body.token;
}

describe('authentication', () => {
  beforeAll(async () => {
    // Boot the Worker, then create the one administrator this file uses.
    await SELF.fetch(`${ORIGIN}/`);
    await post('/_mallok/api/auth/bootstrap', {
      email: EMAIL,
      password: PASSWORD,
    });
  });

  it('closes the bootstrap route once an administrator exists', async () => {
    const again = await post('/_mallok/api/auth/bootstrap', {
      email: 'someone-else@example.com',
      password: 'another long enough password',
    });
    expect(again.status).toBe(409);
  });

  it('rejects a wrong password and an unknown account alike', async () => {
    const wrongPassword = await post('/_mallok/api/auth/login', {
      email: EMAIL,
      password: 'not the right password',
    });
    const unknownAccount = await post('/_mallok/api/auth/login', {
      email: 'nobody@example.com',
      password: 'not the right password',
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    // The same message either way, so the response cannot be used to find out
    // which accounts exist.
    expect(await wrongPassword.text()).toBe(await unknownAccount.text());
  });

  it('issues a session cookie with the documented attributes', async () => {
    const response = await post('/_mallok/api/auth/login', {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('mallok_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/_mallok');
  });

  it('requires a CSRF token on session-authenticated writes', async () => {
    const session = await signIn();
    const without = await post(
      '/_mallok/api/tokens',
      { name: 'no-csrf', scopes: ['export'] },
      { cookie: session.cookie },
    );
    expect(without.status).toBe(403);

    const wrong = await post(
      '/_mallok/api/tokens',
      { name: 'bad-csrf', scopes: ['export'] },
      { cookie: session.cookie, 'x-mallok-csrf': 'not-the-token' },
    );
    expect(wrong.status).toBe(403);

    const right = await post(
      '/_mallok/api/tokens',
      { name: 'good-csrf', scopes: ['export'] },
      { cookie: session.cookie, 'x-mallok-csrf': session.csrf },
    );
    expect(right.status).toBe(201);
  });

  it('exempts bearer tokens from CSRF', async () => {
    const session = await signIn();
    const token = await mintToken(session, ['content:write']);
    const response = await post(
      '/_mallok/api/content',
      { kind: 'article', markdown: '---\ntitle: Via token\n---\n\nBody.' },
      { authorization: `Bearer ${token}` },
    );
    expect(response.status).toBe(201);
  });

  it('enforces token scopes', async () => {
    const session = await signIn();
    const exportOnly = await mintToken(session, ['export']);

    const write = await post(
      '/_mallok/api/content',
      { kind: 'article', markdown: '---\ntitle: Denied\n---\n\nBody.' },
      { authorization: `Bearer ${exportOnly}` },
    );
    expect(write.status).toBe(403);

    // Reads stay available: scopes gate writes, not the whole API.
    const read = await SELF.fetch(`${ORIGIN}/_mallok/api/content`, {
      headers: { authorization: `Bearer ${exportOnly}` },
    });
    expect(read.status).toBe(200);
  });

  it('stops accepting a revoked token', async () => {
    const session = await signIn();
    const token = await mintToken(session, ['content:write']);
    const before = await SELF.fetch(`${ORIGIN}/_mallok/api/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.status).toBe(200);

    const listed = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { tokens } = (await listed.json()) as {
      tokens: { id: string; name: string; revokedAt: string | null }[];
    };
    const mine = tokens.find(
      (row) => row.name === 'token-content:write' && row.revokedAt === null,
    );
    expect(mine).toBeDefined();

    const revoked = await SELF.fetch(
      `${ORIGIN}/_mallok/api/tokens/${mine?.id}`,
      {
        method: 'DELETE',
        headers: { cookie: session.cookie, 'x-mallok-csrf': session.csrf },
      },
    );
    expect(revoked.status).toBe(200);

    const after = await SELF.fetch(`${ORIGIN}/_mallok/api/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it('never returns a token again after it is created', async () => {
    const session = await signIn();
    await mintToken(session, ['export']);
    const listed = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
      headers: { cookie: session.cookie },
    });
    const text = await listed.text();
    expect(text).not.toContain('mlk_live_');
  });

  it('reports the password cost honestly', async () => {
    const session = await signIn();
    const me = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/me`, {
      headers: { cookie: session.cookie },
    });
    const body = (await me.json()) as {
      passwordIterations: number;
      passwordRecommendedIterations: number;
    };
    // The admin UI needs both numbers so it can say plainly that the cost is
    // below current guidance rather than implying it meets it.
    expect(body.passwordIterations).toBeGreaterThan(0);
    expect(body.passwordRecommendedIterations).toBe(600_000);
  });

  it('drops every session when the password changes', async () => {
    const session = await signIn();
    const newPassword = 'an even longer replacement password';
    const changed = await post(
      '/_mallok/api/auth/password',
      { currentPassword: PASSWORD, newPassword },
      { cookie: session.cookie, 'x-mallok-csrf': session.csrf },
    );
    expect(changed.status).toBe(200);

    const stale = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/me`, {
      headers: { cookie: session.cookie },
    });
    expect(stale.status).toBe(401);

    // The new password works, which also proves the re-derivation stored a
    // usable hash rather than corrupting the row.
    const fresh = await signIn(newPassword);
    expect(fresh.csrf).not.toBe('');
  });
});
