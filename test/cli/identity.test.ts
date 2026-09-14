import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroySite } from '../../src/cli/destroy.js';
import { makeReporter } from '../../src/cli/output.js';
import { repairSite } from '../../src/cli/repair.js';
import { fakeCloudflare } from './helpers/fake-wrangler.js';

/**
 * A name is not an identity.
 *
 * `mallok-acme-db` is a name somebody else can also use. The account id says
 * *whose* account it is on; for D1 the UUID says *which database it is*. Two
 * gaps remained after the account check went in:
 *
 * - `mallok repair --adopt` skipped the account comparison. The guard was
 *   written as "refuse a mismatch **unless** we are adopting", which is
 *   exactly backwards: adopting is the operation that points a site at a
 *   resource, so it is the one that most needs the check.
 * - `destroy` deleted D1 by name. The ledger records the UUID Cloudflare
 *   reported when the database was created, and nothing compared the two — so
 *   a database recreated under the same name by somebody else, or a name
 *   reused after a previous site was destroyed, was deleted on the strength
 *   of a string.
 *
 * R2 and Workers have no comparable stable id, and this file does not pretend
 * otherwise: for those two, the account plus the name is all the evidence
 * there is, and that limitation is stated rather than papered over.
 */

const report = makeReporter(true, true);

let workspace = '';

const LEDGER = {
  schemaVersion: 2,
  accountId: 'acct-1',
  directory: '/anywhere',
  slug: 'acme',
  domain: null,
  fingerprint: 'f',
  startedAt: '2026-09-14T00:00:00.000Z',
  origin: 'https://acme.example.workers.dev',
  database: { status: 'created', name: 'mallok-acme-db', id: 'db-uuid-1' },
  bucket: { status: 'created', name: 'mallok-acme-media' },
  worker: { status: 'created', name: 'mallok-acme' },
};

const RECORD = {
  slug: 'acme',
  origin: 'https://acme.example.workers.dev',
  domain: null,
  accountId: 'acct-1',
  databaseId: 'db-uuid-1',
  bucket: 'mallok-acme-media',
  ratelimitNs: 1001,
  createdAt: '2026-09-14T00:00:00.000Z',
};

async function project(options: {
  ledger?: Record<string, unknown> | null;
  record?: Record<string, unknown> | null;
}): Promise<string> {
  const dir = join(workspace, 'site');
  await mkdir(join(dir, '.mallok'), { recursive: true });
  await mkdir(join(dir, 'node_modules/.bin'), { recursive: true });
  await writeFile(join(dir, 'node_modules/.bin/wrangler'), '#!/bin/sh\n', {
    mode: 0o755,
  });
  if (options.ledger !== null) {
    await writeFile(
      join(dir, '.mallok/create-state.json'),
      JSON.stringify(options.ledger ?? LEDGER),
      'utf8',
    );
  }
  await writeFile(
    join(dir, '.mallok/sites.json'),
    JSON.stringify({
      schemaVersion: 1,
      sites: options.record === null ? [] : [options.record ?? RECORD],
    }),
    'utf8',
  );
  return dir;
}

/** Both local records, as bytes, so "unchanged" can be asserted exactly. */
async function records(dir: string): Promise<[string, string]> {
  return [
    await readFile(join(dir, '.mallok/create-state.json'), 'utf8').catch(
      () => '',
    ),
    await readFile(join(dir, '.mallok/sites.json'), 'utf8'),
  ];
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-identity-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('repair --adopt cannot cross accounts', () => {
  it('refuses when the records say acct-A and the login is acct-B', async () => {
    // The guard was `known !== accountId && options.adopt === undefined`, so
    // passing `--adopt` disabled it. Adopting is the operation that points a
    // site at a resource; it is the last one that should skip the check.
    const dir = await project({
      ledger: {
        ...LEDGER,
        accountId: 'acct-A',
        database: { status: 'pending', name: 'mallok-acme-db' },
      },
      record: { ...RECORD, accountId: 'acct-A' },
    });
    const before = await records(dir);
    const fake = fakeCloudflare({
      account: {
        accounts: [{ id: 'acct-B', name: 'Someone else' }],
        databases: { 'mallok-acme-db': 'db-uuid-other' },
      },
    });

    await expect(
      repairSite(
        {
          slug: 'acme',
          projectDir: dir,
          adopt: ['database'],
          run: fake.run,
        },
        report,
      ),
    ).rejects.toThrow(/different Cloudflare account|belongs to another/i);

    // Nothing was changed on Cloudflare…
    expect(fake.mutations()).toEqual([]);
    // …and neither local record moved.
    expect(await records(dir)).toEqual(before);
  });

  it('refuses on the registry alone, with no ledger', async () => {
    const dir = await project({
      ledger: null,
      record: { ...RECORD, accountId: 'acct-A' },
    });
    const before = await records(dir);
    const fake = fakeCloudflare({
      account: { accounts: [{ id: 'acct-B', name: 'Someone else' }] },
    });

    await expect(
      repairSite({ slug: 'acme', projectDir: dir, run: fake.run }, report),
    ).rejects.toThrow();

    expect(fake.mutations()).toEqual([]);
    expect(await records(dir)).toEqual(before);
  });
});

describe('repair verifies more than whoami before filling in an account', () => {
  it('checks the recorded D1 UUID against the account it is about to write', async () => {
    // Filling in a missing account id from `whoami` alone records "whoever is
    // signed in" as the owner. The records already name a database UUID; if
    // that UUID is not what this account's database reports, the records
    // describe some other site.
    const dir = await project({
      ledger: null,
      record: { ...RECORD, accountId: null },
    });
    const before = await records(dir);
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-acme-db': 'db-uuid-DIFFERENT' } },
    });

    await expect(
      repairSite({ slug: 'acme', projectDir: dir, run: fake.run }, report),
    ).rejects.toThrow(/db-uuid-1|db-uuid-DIFFERENT|different database/i);

    expect(await records(dir)).toEqual(before);
  });

  it('fills it in when the recorded UUID is the one on the account', async () => {
    const dir = await project({
      ledger: null,
      record: { ...RECORD, accountId: null },
    });
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-acme-db': 'db-uuid-1' } },
    });

    const result = await repairSite(
      { slug: 'acme', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.accountId).toBe('acct-1');
    const sites = JSON.parse(
      await readFile(join(dir, '.mallok/sites.json'), 'utf8'),
    ) as { sites: { accountId: string }[] };
    expect(sites.sites[0]?.accountId).toBe('acct-1');
  });
});

describe('adopting a pending D1 needs the id confirmed', () => {
  it('refuses without --expect-id', async () => {
    // Between `create` printing the remote id and somebody running this, the
    // resource can be replaced. Repeating the id back is what makes the
    // adoption refer to the thing that was actually looked at.
    const dir = await project({
      ledger: {
        ...LEDGER,
        accountId: 'acct-1',
        database: { status: 'pending', name: 'mallok-acme-db' },
      },
      record: { ...RECORD, databaseId: null },
    });
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-acme-db': 'db-uuid-1' } },
    });

    const error = await repairSite(
      { slug: 'acme', projectDir: dir, adopt: ['database'], run: fake.run },
      report,
    ).then(
      () => null,
      (thrown: unknown) => thrown as Error & { hint?: string },
    );

    expect(`${error?.message}\n${error?.hint ?? ''}`).toContain('--expect-id');
  });

  it('refuses when the id no longer matches', async () => {
    const dir = await project({
      ledger: {
        ...LEDGER,
        accountId: 'acct-1',
        database: { status: 'pending', name: 'mallok-acme-db' },
      },
      record: { ...RECORD, databaseId: null },
    });
    const before = await records(dir);
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-acme-db': 'db-uuid-REPLACED' } },
    });

    await expect(
      repairSite(
        {
          slug: 'acme',
          projectDir: dir,
          adopt: ['database'],
          expectId: 'db-uuid-1',
          run: fake.run,
        },
        report,
      ),
    ).rejects.toThrow(/db-uuid-REPLACED|no longer/i);

    expect(await records(dir)).toEqual(before);
  });

  it('adopts when the id is repeated back correctly', async () => {
    const dir = await project({
      ledger: {
        ...LEDGER,
        accountId: 'acct-1',
        database: { status: 'pending', name: 'mallok-acme-db' },
      },
      record: { ...RECORD, databaseId: null },
    });
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-acme-db': 'db-uuid-1' } },
    });

    const result = await repairSite(
      {
        slug: 'acme',
        projectDir: dir,
        adopt: ['database'],
        expectId: 'db-uuid-1',
        run: fake.run,
      },
      report,
    );

    expect(result.adopted).toEqual(['database']);
  });

  it('does not ask for an id it cannot check', async () => {
    // R2 and Workers have no stable id Wrangler will report, so `--expect-id`
    // would be theatre for them. Saying so is better than inventing a check.
    const dir = await project({
      ledger: {
        ...LEDGER,
        accountId: 'acct-1',
        bucket: { status: 'pending', name: 'mallok-acme-media' },
      },
    });
    const fake = fakeCloudflare({
      account: { buckets: ['mallok-acme-media'] },
    });

    const result = await repairSite(
      { slug: 'acme', projectDir: dir, adopt: ['bucket'], run: fake.run },
      report,
    );

    expect(result.adopted).toEqual(['bucket']);
    expect(result.unverifiable).toContain('bucket');
  });
});

describe('destroy checks the D1 it is about to delete', () => {
  it('stops when the database under that name is a different one', async () => {
    // The name was reused — a previous site destroyed, or somebody else's
    // `mallok create` on the same account. Deleting it destroys their data.
    const dir = await project({});
    const fake = fakeCloudflare({
      account: {
        buckets: ['mallok-acme-media'],
        workers: ['mallok-acme'],
        databases: { 'mallok-acme-db': 'db-uuid-SOMEBODY-ELSE' },
      },
    });

    const result = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.stoppedAt).not.toBeNull();
    // The database is still there.
    expect(Object.keys(fake.account.databases)).toContain('mallok-acme-db');
    expect(
      fake.calls
        .map((call) => call.args.join(' '))
        .some((call) => call.startsWith('d1 delete')),
    ).toBe(false);
  });

  it('deletes it when the id is the one that was recorded', async () => {
    const dir = await project({});
    const fake = fakeCloudflare({
      account: {
        buckets: ['mallok-acme-media'],
        workers: ['mallok-acme'],
        databases: { 'mallok-acme-db': 'db-uuid-1' },
      },
    });

    const result = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.stoppedAt).toBeNull();
    expect(Object.keys(fake.account.databases)).not.toContain('mallok-acme-db');
  });

  it('stops when it cannot read the id at all', async () => {
    // "Could not check" is not "it matches".
    const dir = await project({});
    const fake = fakeCloudflare({
      account: {
        buckets: ['mallok-acme-media'],
        workers: ['mallok-acme'],
        databases: { 'mallok-acme-db': 'db-uuid-1' },
      },
      failWhen: (args) => args[0] === 'd1' && args[1] === 'info',
      failureMessage: 'Authentication error [code: 10000]',
    });

    const result = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      report,
    ).catch(() => ({ stoppedAt: 'threw' }));

    expect(result.stoppedAt).not.toBeNull();
    expect(Object.keys(fake.account.databases)).toContain('mallok-acme-db');
  });
});
