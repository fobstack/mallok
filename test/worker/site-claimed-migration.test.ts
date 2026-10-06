import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { resetBootForTests } from '../../src/worker/bootstrap.js';

/**
 * Migration 0007 marks the sites that already had an owner
 * (docs/ARCHITECTURE.md §6): an existing site must go on being cached after
 * the upgrade, and only a site nobody has claimed is treated as unclaimed.
 */

const ORIGIN = 'https://claimed-migration.example';
const EMAIL = 'owner@example.com';
const PASSWORD = 'a sufficiently long password';

describe('sites that existed before the column did', () => {
  /** Puts the database back to before migration 0007 and boots again. */
  async function migrateAgain(): Promise<string | null> {
    await env.DB.batch([
      env.DB.prepare('ALTER TABLE site DROP COLUMN claimed_at'),
      env.DB.prepare("DELETE FROM migration WHERE id = '0007_site_claimed'"),
    ]);
    resetBootForTests();
    await SELF.fetch(`${ORIGIN}/_mallok/api/setup`);
    const row = await env.DB.prepare(
      'SELECT claimed_at FROM site WHERE id = 1',
    ).first<{ claimed_at: string | null }>();
    return row?.claimed_at ?? null;
  }

  it('stays unclaimed when it has no administrator', async () => {
    await SELF.fetch(`${ORIGIN}/_mallok/api/setup`);
    expect(await migrateAgain()).toBeNull();
  });

  it('is claimed as of its claim, or of its first administrator where there is no claim', async () => {
    await SELF.fetch(`${ORIGIN}/_mallok/api/setup`);
    await SELF.fetch(`${ORIGIN}/_mallok/api/setup/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    // The claim and the administrator are written with one timestamp; pull
    // them apart to see which one the migration reads.
    await env.DB.prepare(
      "UPDATE setup_claim SET claimed_at = '2025-12-31T00:00:00.000Z'",
    ).run();
    expect(await migrateAgain()).toBe('2025-12-31T00:00:00.000Z');

    // A site claimed before `setup_claim` existed has an administrator and
    // no claim row.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM setup_claim'),
      env.DB.prepare(
        "UPDATE admin_user SET created_at = '2026-01-02T03:04:05.000Z'",
      ),
    ]);
    expect(await migrateAgain()).toBe('2026-01-02T03:04:05.000Z');
  });
});
