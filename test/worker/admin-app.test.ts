import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://app-test.example';

/**
 * The workers-vitest pool wires the ASSETS **binding** but does not mount the
 * built asset directory, so these tests cover the routing decision — which
 * paths the Worker claims and what it says when the build is absent — and not
 * the bytes of the shell. Serving the real file is verified against
 * `wrangler dev` (see docs/tasks/TASK-10.md §5).
 */
describe('admin app routing', () => {
  it('claims the app prefix instead of falling through to the public site', async () => {
    for (const path of [
      '/_mallok/app',
      '/_mallok/app/',
      '/_mallok/app/settings/appearance',
      '/_mallok/app/content/some-id',
    ]) {
      const response = await SELF.fetch(`${ORIGIN}${path}`);
      // Either the shell (200) or the honest "not built" answer (503) —
      // never a 404 from the public router.
      expect([200, 503]).toContain(response.status);
    }
  });

  it('does not claim look-alike paths', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/application`);
    expect(response.status).toBe(404);
  });

  it('refuses a write to the app prefix', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/app/`, {
      method: 'POST',
    });
    expect(response.status).toBe(405);
  });

  it('says plainly when the app was not built', async () => {
    const response = await SELF.fetch(`${ORIGIN}/_mallok/app/`);
    if (response.status === 503) {
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('pnpm build');
    }
  });
});
