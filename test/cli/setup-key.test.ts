import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeReporter } from '../../src/cli/output.js';
import { rotateSetupKey } from '../../src/cli/setup-key.js';
import {
  fakeCloudflare,
  writeWranglerIdentity,
} from './helpers/fake-wrangler.js';

/**
 * `mallok setup-key`, the way back from a lost key.
 *
 * The key `mallok create` prints exists once, in a terminal, and is written to
 * no file on purpose. Without this command, losing it means a deployed site
 * that can never be set up — Cloudflare does not give a secret's value back.
 *
 * Issuing a new one is only safe while nobody owns the site, and the whole
 * value of the command is in how it decides that. These are the three answers
 * it can get and what it must do with each: **yes** refuse, **no** proceed,
 * and — the one that matters — **cannot tell** refuse, because unknown is not
 * the same as no, and guessing here hands a live site to whoever asked.
 */

// Quiet: the reporter's progress lines are not what these tests are about,
// and a passing run should leave stderr readable.
const report = makeReporter(true, true);

let workspace = '';

/** A project directory with a ledger, a registry and a Wrangler binary. */
async function project(
  ledger: Record<string, unknown> | null,
  origin = 'https://site.example.workers.dev',
): Promise<string> {
  const dir = join(workspace, 'site');
  await mkdir(join(dir, '.mallok'), { recursive: true });
  await mkdir(join(dir, 'node_modules/.bin'), { recursive: true });
  // `hasProjectWrangler` only checks that the file is there.
  await writeFile(join(dir, 'node_modules/.bin/wrangler'), '#!/bin/sh\n', {
    mode: 0o755,
  });
  await writeWranglerIdentity(dir, { databaseId: 'db-1' });
  if (ledger !== null) {
    await writeFile(
      join(dir, '.mallok/create-state.json'),
      JSON.stringify(ledger),
      'utf8',
    );
  }
  await writeFile(
    join(dir, '.mallok/sites.json'),
    JSON.stringify({
      schemaVersion: 1,
      sites: [
        {
          slug: 'acme',
          origin,
          domain: null,
          accountId: 'acct-1',
          databaseId: 'db-1',
          bucket: 'mallok-acme-media',
          ratelimitNs: 1001,
          createdAt: '2026-09-12T00:00:00.000Z',
        },
      ],
    }),
    'utf8',
  );
  return dir;
}

const LEDGER = {
  schemaVersion: 2,
  accountId: 'acct-1',
  directory: '/anywhere',
  slug: 'acme',
  domain: null,
  fingerprint: 'f',
  startedAt: '2026-09-12T00:00:00.000Z',
  origin: 'https://site.example.workers.dev',
  secrets: ['MALLOK_SECRET'],
};

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-setup-key-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('when the site has no administrator', () => {
  it('sets a new key and hands it over once', async () => {
    const dir = await project(LEDGER);
    const fake = fakeCloudflare();
    const delivered: string[] = [];

    const result = await rotateSetupKey(
      {
        projectDir: dir,
        run: fake.run,
        hasAdministrator: async () => false,
        deliver: (key) => {
          delivered.push(key);
        },
      },
      report,
    );

    expect(result.slug).toBe('acme');
    expect(Buffer.from(delivered[0] ?? '', 'base64')).toHaveLength(32);
    expect(fake.calls.map((call) => call.args.join(' '))).toContain(
      'secret put MALLOK_SETUP_KEY --name mallok-acme',
    );
  });

  it('records that a key was delivered, and never the key', async () => {
    // `setupKeyDeliveredAt` is what stops a resumed `create` rotating the key
    // again; without it the key this command just printed would be replaced
    // by the next run.
    const dir = await project(LEDGER);
    const fake = fakeCloudflare();
    const delivered: string[] = [];

    await rotateSetupKey(
      {
        projectDir: dir,
        run: fake.run,
        hasAdministrator: async () => false,
        deliver: (key) => {
          delivered.push(key);
        },
      },
      report,
    );

    const ledger = JSON.parse(
      await readFile(join(dir, '.mallok/create-state.json'), 'utf8'),
    ) as { secrets: string[]; setupKeyDeliveredAt?: string };

    expect(ledger.secrets).toContain('MALLOK_SETUP_KEY');
    expect(ledger.setupKeyDeliveredAt).toBeDefined();
    // The value itself is nowhere on disk.
    const onDisk = await readFile(
      join(dir, '.mallok/create-state.json'),
      'utf8',
    );
    expect(onDisk).not.toContain(delivered[0] ?? '');
  });

  it('works from the registry alone, when the ledger is gone', async () => {
    const dir = await project(null);
    const fake = fakeCloudflare();

    const result = await rotateSetupKey(
      {
        projectDir: dir,
        run: fake.run,
        hasAdministrator: async () => false,
        deliver: () => undefined,
      },
      report,
    );

    expect(result.slug).toBe('acme');
  });
});

describe('when it must not issue a key', () => {
  it('refuses a site that already has an administrator', async () => {
    // The key is spent. Whoever is asking is either the owner, who should
    // sign in, or somebody who should not be here.
    const dir = await project(LEDGER);
    const fake = fakeCloudflare();

    await expect(
      rotateSetupKey(
        {
          projectDir: dir,
          run: fake.run,
          hasAdministrator: async () => true,
          deliver: () => undefined,
        },
        report,
      ),
    ).rejects.toThrow(/already has an administrator/);

    expect(fake.calls.map((call) => call.args.join(' '))).not.toContain(
      'secret put MALLOK_SETUP_KEY',
    );
  });

  it('refuses when it cannot tell, rather than assuming nobody owns it', async () => {
    // The case this command exists to get right. A site that cannot be
    // reached is not a site with no administrator, and treating the two the
    // same would make an unreachable site claimable by whoever asked.
    const dir = await project(LEDGER);
    const fake = fakeCloudflare();

    await expect(
      rotateSetupKey(
        {
          projectDir: dir,
          run: fake.run,
          hasAdministrator: async () => null,
          deliver: () => undefined,
        },
        report,
      ),
    ).rejects.toThrow(/Could not ask/);

    expect(fake.calls.map((call) => call.args.join(' '))).not.toContain(
      'secret put MALLOK_SETUP_KEY',
    );
  });

  it('refuses a directory that never deployed anything', async () => {
    const dir = join(workspace, 'empty');
    await mkdir(dir, { recursive: true });
    const fake = fakeCloudflare();

    await expect(
      rotateSetupKey(
        {
          projectDir: dir,
          run: fake.run,
          hasAdministrator: async () => false,
          deliver: () => undefined,
        },
        report,
      ),
    ).rejects.toThrow(/no record of a deployed site/);
  });

  it('refuses a project whose dependencies are not installed', async () => {
    // It would otherwise fall through to `npx wrangler`, which is a different
    // Wrangler from the one this site was deployed with.
    const dir = join(workspace, 'site');
    await mkdir(join(dir, '.mallok'), { recursive: true });
    await writeFile(
      join(dir, '.mallok/create-state.json'),
      JSON.stringify(LEDGER),
      'utf8',
    );
    await writeFile(
      join(dir, '.mallok/sites.json'),
      JSON.stringify({ schemaVersion: 1, sites: [] }),
      'utf8',
    );
    const fake = fakeCloudflare();

    await expect(
      rotateSetupKey(
        {
          projectDir: dir,
          run: fake.run,
          hasAdministrator: async () => false,
          deliver: () => undefined,
        },
        report,
      ),
    ).rejects.toThrow(/no Wrangler binary/);
  });

  it('refuses to act on another account’s site', async () => {
    // Same slug, different account: a same-named site somebody else owns.
    // Setting a setup key on it would be handing them a way in.
    const dir = await project({ ...LEDGER, accountId: 'someone-else' });
    const fake = fakeCloudflare();

    await expect(
      rotateSetupKey(
        {
          projectDir: dir,
          run: fake.run,
          hasAdministrator: async () => false,
          deliver: () => undefined,
        },
        report,
      ),
    ).rejects.toThrow();

    expect(fake.calls.map((call) => call.args.join(' '))).not.toContain(
      'secret put MALLOK_SETUP_KEY',
    );
  });

  it('reports a failure to set the secret instead of returning a key', async () => {
    // A key the Worker does not have is worse than no key: it would be
    // printed, tried, and refused, with nothing saying why.
    const dir = await project(LEDGER);
    const fake = fakeCloudflare({
      failWhen: (args) => args[0] === 'secret' && args[1] === 'put',
    });

    await expect(
      rotateSetupKey(
        {
          projectDir: dir,
          run: fake.run,
          hasAdministrator: async () => false,
          deliver: () => undefined,
        },
        report,
      ),
    ).rejects.toThrow(/Could not set MALLOK_SETUP_KEY/);
  });

  it('needs a command runner', async () => {
    const dir = await project(LEDGER);

    await expect(rotateSetupKey({ projectDir: dir }, report)).rejects.toThrow(
      /command runner/,
    );
  });
});
