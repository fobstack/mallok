import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Two people with the right key, at the same moment.
 *
 * Creating the first administrator and spending the setup key were two
 * statements with an `await` between them. Two requests that both passed the
 * key check before either finished would both create an administrator — and
 * on a site that is meant to have exactly one owner, the second one is a
 * stranger with an account.
 *
 * The two are now a single D1 batch against a table that can hold one row,
 * so the database decides the winner rather than the ordering of two
 * promises.
 */

const ORIGIN = 'https://race.example';
const KEY = 'a-one-time-setup-key-for-this-test';

function bootstrap(email: string, key = KEY): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/_mallok/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'a-sufficiently-long-password',
      setupKey: key,
    }),
  });
}

describe('concurrent claims with the right key', () => {
  it('lets exactly one through', async () => {
    const [first, second, third] = await Promise.all([
      bootstrap('one@example.com'),
      bootstrap('two@example.com'),
      bootstrap('three@example.com'),
    ]);

    const statuses = [first.status, second.status, third.status].sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    // The losers are refused, not served an error that hides what happened.
    expect(
      statuses.filter((status) => status === 201 || status === 409),
    ).toHaveLength(3);
  });

  it('leaves exactly one administrator in the database', async () => {
    const admins = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM admin_user',
    ).first<{ n: number }>();

    expect(admins?.n).toBe(1);
  });

  it('records the key as spent, once', async () => {
    const claim = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM setup_claim',
    ).first<{ n: number }>();
    const site = await env.DB.prepare(
      'SELECT setup_key_used_at FROM site',
    ).first<{ setup_key_used_at: string | null }>();

    expect(claim?.n).toBe(1);
    expect(site?.setup_key_used_at).not.toBeNull();
  });

  it('refuses a replay with the same key afterwards', async () => {
    const replay = await bootstrap('fourth@example.com');

    expect(replay.status).toBe(409);
    const admins = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM admin_user',
    ).first<{ n: number }>();
    expect(admins?.n).toBe(1);
  });
});
