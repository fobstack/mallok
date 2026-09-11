import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * The test environment is declared by the test suite, not by the machine.
 *
 * `.dev.vars` is a developer's local secrets file. A test run that loads it
 * is a test run whose results depend on what is in somebody's working copy —
 * green on one laptop, red on another, and worst of all green *because* of a
 * value the repository does not contain.
 *
 * `vitest.config.ts` therefore declares every binding explicitly and gives
 * the Workers pool no Wrangler configuration to read a `.dev.vars` beside.
 * This test is the tripwire: the repository's own `.dev.vars` carries a
 * canary variable, and it must never be visible here.
 */
describe('the test environment', () => {
  it('does not load the workspace .dev.vars', () => {
    const bindings = env as unknown as Record<string, unknown>;

    expect(bindings.MALLOK_DEV_VARS_CANARY).toBeUndefined();
  });

  it('uses the secret the test suite declared, not a developer’s', () => {
    expect(env.MALLOK_SECRET).toBe('test-secret-do-not-use');
  });

  it('has the bindings the Worker needs, and nothing it should not', () => {
    expect(env.DB).toBeDefined();
    expect(env.MEDIA).toBeDefined();
    // A real purge token in a test would make the cache tests talk to
    // Cloudflare.
    expect(env.CF_API_TOKEN).toBeUndefined();
    expect(env.CF_ZONE_ID).toBeUndefined();
  });
});
