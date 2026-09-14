import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSite } from '../../src/cli/create.js';
import { destroySite } from '../../src/cli/destroy.js';
import { makeReporter } from '../../src/cli/output.js';
import { repairSite } from '../../src/cli/repair.js';
import { rotateSetupKey } from '../../src/cli/setup-key.js';
import { writeFakeTemplate } from './helpers/fake-template.js';
import { fakeCloudflare } from './helpers/fake-wrangler.js';

/**
 * Nothing acts on a Cloudflare resource it cannot prove belongs to this
 * project.
 *
 * The proof is an account id, recorded when the resource was created. Three
 * ways it went missing, and all three ended with the code acting anyway:
 *
 * - the registry's `accountId` is nullable, and `destroy` only compared it
 *   **when it was set** — so a record without one skipped the check entirely
 *   and deleted by name, on whatever account happened to be signed in;
 * - a `pending` ledger entry plus a same-named remote resource was adopted
 *   automatically. "We were about to create this and something of that name
 *   is here" is a guess, and on a shared account it is a guess that points a
 *   site at somebody else's database;
 * - a setup key was rotated when the site could not be asked whether it
 *   already had an administrator. `null` is not `false`.
 *
 * Deleting by name on the wrong account destroys somebody else's site, so the
 * answer everywhere here is to stop and say what it would have needed.
 */

const report = makeReporter(true, true);

let workspace = '';
let template = '';

const LEDGER = {
  schemaVersion: 2,
  accountId: 'acct-1',
  directory: '/anywhere',
  slug: 'acme',
  domain: null,
  fingerprint: 'f',
  startedAt: '2026-09-13T00:00:00.000Z',
  origin: 'https://acme.example.workers.dev',
};

const RECORD = {
  slug: 'acme',
  origin: 'https://acme.example.workers.dev',
  domain: null,
  accountId: 'acct-1',
  databaseId: 'db-1',
  bucket: 'mallok-acme-media',
  ratelimitNs: 1001,
  createdAt: '2026-09-13T00:00:00.000Z',
};

/** A project directory carrying whichever records a test needs. */
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
  if (options.ledger !== null && options.ledger !== undefined) {
    await writeFile(
      join(dir, '.mallok/create-state.json'),
      JSON.stringify(options.ledger),
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

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-ownership-'));
  template = await writeFakeTemplate();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(template, { recursive: true, force: true });
});

describe('destroy refuses when ownership cannot be proved', () => {
  it('when the registry record has no account id', async () => {
    // The hole this closes: the comparison was guarded by `!= null`, so a
    // record without an account id was not checked against a different
    // account — it was not checked at all.
    const dir = await project({
      ledger: null,
      record: { ...RECORD, accountId: null },
    });
    const fake = fakeCloudflare({
      account: { buckets: ['mallok-acme-media'], workers: ['mallok-acme'] },
    });

    await expect(
      destroySite(
        { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
        report,
      ),
    ).rejects.toThrow(/account/i);

    expect(fake.mutations()).toEqual([]);
  });

  it('and names the command that repairs the record', async () => {
    const dir = await project({
      ledger: null,
      record: { ...RECORD, accountId: null },
    });
    const fake = fakeCloudflare();

    const error = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      report,
    ).then(
      () => null,
      (thrown: unknown) => thrown as Error & { hint?: string },
    );

    expect(error).not.toBeNull();
    expect(`${error?.message} ${error?.hint ?? ''}`).toContain(
      'mallok repair acme',
    );
  });

  it('when the ledger carries an empty account id', async () => {
    // `typeof '' === 'string'`, so this passed the ledger's own validation.
    const dir = await project({ ledger: { ...LEDGER, accountId: '' } });
    const fake = fakeCloudflare({
      account: { buckets: ['mallok-acme-media'] },
    });

    await expect(
      destroySite(
        { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
        report,
      ),
    ).rejects.toThrow(/account/i);
    expect(fake.mutations()).toEqual([]);
  });

  it('but proceeds when the record proves the account', async () => {
    const dir = await project({ ledger: LEDGER });
    const fake = fakeCloudflare({
      account: {
        buckets: ['mallok-acme-media'],
        workers: ['mallok-acme'],
        databases: { 'mallok-acme-db': 'db-1' },
      },
    });

    const result = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.stoppedAt).toBeNull();
  });
});

describe('setup-key refuses when ownership cannot be proved', () => {
  it('when the registry record has no account id and there is no ledger', async () => {
    const dir = await project({
      ledger: null,
      record: { ...RECORD, accountId: null },
    });
    const fake = fakeCloudflare();

    await expect(
      rotateSetupKey(
        { projectDir: dir, run: fake.run, hasAdministrator: async () => false },
        report,
      ),
    ).rejects.toThrow(/account/i);

    expect(fake.calls.map((call) => call.args.join(' '))).not.toContain(
      'secret put MALLOK_SETUP_KEY',
    );
  });
});

describe('a pending resource is never adopted automatically', () => {
  it('stops instead of claiming a same-named remote resource', async () => {
    // Built the way it really happens: the `d1 create` call takes effect and
    // the process dies before the answer is recorded. That leaves a genuine
    // `pending` ledger entry and a genuine remote database.
    const first = fakeCloudflare({
      failWhen: (args) => args[0] === 'd1' && args[1] === 'create',
      failAfterEffect: true,
    });
    await createSite(
      {
        directory: 'my-site',
        slug: 'my-site',
        cwd: workspace,
        run: first.run,
        templateDir: template,
        hasAdministrator: async () => false,
      },
      report,
    ).catch(() => undefined);

    const ledger = JSON.parse(
      await readFile(
        join(workspace, 'my-site/.mallok/create-state.json'),
        'utf8',
      ),
    ) as { database?: { status: string } };
    expect(ledger.database?.status).toBe('pending');

    // The resumed run meets a database of exactly that name. "We were about
    // to create this, and something of that name is here" is a guess; on a
    // shared account it points the site at another team's data, and the first
    // thing it does is run migrations against it.
    const second = fakeCloudflare({ account: first.account });
    const error = await createSite(
      {
        directory: 'my-site',
        slug: 'my-site',
        cwd: workspace,
        run: second.run,
        templateDir: template,
        hasAdministrator: async () => false,
      },
      report,
    ).then(
      () => null,
      (thrown: unknown) => thrown as Error & { hint?: string },
    );

    expect(error).toBeInstanceOf(Error);
    const said = `${error?.message}\n${error?.hint ?? ''}`;
    // The two things an operator needs in order to decide: what Cloudflare
    // reports, and what this project believes.
    expect(said).toContain('mallok-my-site-db');
    expect(said).toContain('pending');
    // And the explicit way to say "yes, that one is mine".
    expect(said).toContain('mallok repair my-site --adopt database');
    // Nothing further was created.
    expect(second.mutations()).toEqual([]);
  });
});

describe('mallok repair', () => {
  it('records the account id after checking it against whoami', async () => {
    const dir = await project({
      ledger: null,
      record: { ...RECORD, accountId: null },
    });
    // The record names a database id, so `repair` checks it against the
    // account before writing that account down — filling it in from `whoami`
    // alone would record "whoever is signed in" as the owner.
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-acme-db': 'db-1' } },
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

  it('refuses when the signed-in account is not the one asked for', async () => {
    const dir = await project({ ledger: null, record: RECORD });
    const fake = fakeCloudflare({
      account: { accounts: [{ id: 'acct-other', name: 'Someone else' }] },
    });

    await expect(
      repairSite(
        { slug: 'acme', projectDir: dir, accountId: 'acct-1', run: fake.run },
        report,
      ),
    ).rejects.toThrow();
  });

  it('adopts a pending resource only when told to, by name', async () => {
    const dir = await project({
      ledger: {
        ...LEDGER,
        database: { status: 'pending', name: 'mallok-acme-db' },
      },
    });
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-acme-db': 'db-remote-1' } },
    });

    // A D1 adoption has to repeat back the id the operator read: a name can
    // be reused between looking and deciding.
    const result = await repairSite(
      {
        slug: 'acme',
        projectDir: dir,
        adopt: ['database'],
        expectId: 'db-remote-1',
        run: fake.run,
      },
      report,
    );

    expect(result.adopted).toEqual(['database']);
    const ledger = JSON.parse(
      await readFile(join(dir, '.mallok/create-state.json'), 'utf8'),
    ) as { database: { status: string; id?: string } };
    expect(ledger.database.status).toBe('adopted');
    expect(ledger.database.id).toBe('db-remote-1');
  });

  it('will not adopt something that is not actually there', async () => {
    const dir = await project({
      ledger: {
        ...LEDGER,
        database: { status: 'pending', name: 'mallok-acme-db' },
      },
    });
    const fake = fakeCloudflare();

    await expect(
      repairSite(
        { slug: 'acme', projectDir: dir, adopt: ['database'], run: fake.run },
        report,
      ),
    ).rejects.toThrow(/not on this account|does not exist|no .*database/i);
  });
});

describe('a setup key is never rotated on a guess', () => {
  it('stops when the site cannot be asked whether it has an administrator', async () => {
    // Built the real way again: the `secret put MALLOK_SETUP_KEY` call takes
    // effect and the process dies before the key reaches anybody. The ledger
    // then records the secret's *name* without a delivery time, which is the
    // state that makes a resumed run want to rotate.
    const first = fakeCloudflare({
      failWhen: (args) =>
        args[0] === 'secret' && args[2] === 'MALLOK_SETUP_KEY',
      failAfterEffect: true,
    });
    await createSite(
      {
        directory: 'my-site',
        slug: 'my-site',
        cwd: workspace,
        run: first.run,
        templateDir: template,
        hasAdministrator: async () => false,
      },
      report,
    ).catch(() => undefined);

    const before = JSON.parse(
      await readFile(
        join(workspace, 'my-site/.mallok/create-state.json'),
        'utf8',
      ),
    ) as { setupKeyDeliveredAt?: string };
    expect(before.setupKeyDeliveredAt).toBeUndefined();

    // Now the site is unreachable — DNS still propagating, or the network is
    // down. `null` is "could not tell", and it used to take the same branch
    // as "no administrator": rotate. That replaces a key which may be in the
    // hands of the site's actual owner, and hands the replacement to whoever
    // ran the command.
    const second = fakeCloudflare({ account: first.account });
    const error = await createSite(
      {
        directory: 'my-site',
        slug: 'my-site',
        cwd: workspace,
        run: second.run,
        templateDir: template,
        hasAdministrator: async () => null,
      },
      report,
    ).then(
      () => null,
      (thrown: unknown) => thrown as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/administrator/i);
    // The key on the Worker is untouched by the resumed run.
    const puts = second.calls
      .map((call) => call.args.join(' '))
      .filter((call) => call.includes('secret put MALLOK_SETUP_KEY'));
    expect(puts).toEqual([]);
  });
});
