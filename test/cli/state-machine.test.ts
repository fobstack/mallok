import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from '../../src/cli/cloudflare.js';
import { createSite } from '../../src/cli/create.js';
import { destroySite } from '../../src/cli/destroy.js';
import { readLedger, writeLedger } from '../../src/cli/ledger.js';
import { makeReporter } from '../../src/cli/output.js';
import { rateLimitNamespace } from '../../src/cli/site-config.js';
import { writeFakeTemplate } from './helpers/fake-template.js';
import { type FakeAccount, fakeCloudflare } from './helpers/fake-wrangler.js';

/**
 * The rule this file exists for: **nothing on Cloudflare is created until the
 * generated project has been configured, installed, built and dry-run
 * locally** — and once something *has* been created, every later run knows
 * about it.
 *
 * Every assertion here is a count or a sequence taken from a fake Wrangler
 * that records what it was asked to do. A message saying "preflight failed"
 * proves nothing about what already ran; `expect(fake.mutations()).toEqual([])`
 * does.
 */

const report = makeReporter(true);

let workspace = '';
let template = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-workspace-'));
  template = await writeFakeTemplate();
});

afterEach(async () => {
  for (const path of [workspace, template]) {
    await rm(path, { recursive: true, force: true });
  }
});

/** Runs create with the fake, returning the error rather than throwing. */
async function createWith(
  run: CommandRunner,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  return await createSite(
    {
      directory: 'my-site',
      cwd: workspace,
      run,
      templateDir: template,
      ...options,
    },
    report,
  ).catch((error: unknown) => error);
}

describe('nothing is provisioned before the project is proven', () => {
  for (const [label, fails] of [
    ['the install fails', (args: readonly string[]) => args[0] === 'install'],
    [
      'the build fails',
      (args: readonly string[]) => args[0] === 'run' && args[1] === 'build',
    ],
    [
      'the deploy dry-run fails',
      (args: readonly string[]) =>
        args[0] === 'deploy' && args.includes('--dry-run'),
    ],
  ] as const) {
    it(`creates nothing when ${label}`, async () => {
      const fake = fakeCloudflare({ failWhen: fails });

      const error = await createWith(fake.run);

      expect(String(error)).toMatch(/failed/i);
      expect(fake.mutations()).toEqual([]);
      // And it never even asked who is signed in: the read-only half is
      // after the local half, not before it.
      expect(fake.calls.filter((call) => call.args[0] === 'whoami')).toEqual(
        [],
      );
    });
  }

  it('creates nothing with --no-deploy, even when everything passes', async () => {
    const fake = fakeCloudflare();

    const result = (await createWith(fake.run, { noDeploy: true })) as {
      deployed: boolean;
    };

    expect(result.deployed).toBe(false);
    expect(fake.mutations()).toEqual([]);
    await expect(
      readFile(join(workspace, 'my-site/package.json'), 'utf8'),
    ).resolves.toContain('my-site');
  });

  it('keeps no files and touches nothing with --dry-run', async () => {
    const fake = fakeCloudflare();

    const result = (await createWith(fake.run, { dryRun: true })) as {
      projectDir: string;
    };

    expect(fake.mutations()).toEqual([]);
    await expect(
      readFile(join(result.projectDir, 'package.json'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(workspace, 'my-site/package.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('refuses a bad domain before it reaches Cloudflare', async () => {
    for (const domain of [
      'https://example.com',
      'example.com/path',
      '*.example.com',
      'localhost',
      'exam ple.com',
    ]) {
      const fake = fakeCloudflare();
      const error = await createWith(fake.run, { domain });
      expect(String(error), domain).toContain('--domain');
      expect(fake.mutations(), domain).toEqual([]);
    }
  });

  it('refuses a bad slug before it writes anything', async () => {
    const fake = fakeCloudflare();

    const error = await createWith(fake.run, { slug: 'mallok-acme' });

    expect(String(error)).toContain('prefix is added automatically');
    expect(fake.mutations()).toEqual([]);
  });
});

describe('the configuration is final before the dry-run', () => {
  it('writes the real names, the domain and the rate limiter first', async () => {
    const fake = fakeCloudflare();

    await createWith(fake.run, {
      slug: 'acme',
      domain: 'shop.example.com',
      noDeploy: true,
    });

    const config = await readFile(
      join(workspace, 'my-site/wrangler.jsonc'),
      'utf8',
    );
    expect(config).toContain('"name": "mallok-acme"');
    expect(config).toContain('"database_name": "mallok-acme-db"');
    expect(config).toContain('"bucket_name": "mallok-acme-media"');
    expect(config).toContain('"pattern": "shop.example.com"');
    expect(config).toContain(`"namespace_id": "${rateLimitNamespace('acme')}"`);
    expect(config).toContain('"MALLOK_SITE": "acme"');

    // And the dry-run ran against that file, not a placeholder-named one.
    const dryRun = fake.calls.findIndex(
      (call) => call.args[0] === 'deploy' && call.args.includes('--dry-run'),
    );
    const configWrite = fake.calls.findIndex((call) => call.args[0] === 'run');
    expect(dryRun).toBeGreaterThan(configWrite);
  });

  it('derives a different rate-limit namespace for each slug', () => {
    // The template ships one value for every site, so two sites on an account
    // shared a limiter and a busy one throttled a quiet one. The derivation
    // is a hash, not a guarantee of uniqueness — see the collision test in
    // `args-strict.test.ts` and `--rate-limit-namespace` below.
    const namespaces = ['acme', 'beta', 'gamma', 'delta'].map(
      rateLimitNamespace,
    );
    expect(new Set(namespaces).size).toBe(4);
    expect(rateLimitNamespace('acme')).toBe(rateLimitNamespace('acme'));
    for (const namespace of namespaces) {
      expect(namespace).toMatch(/^\d+$/);
      expect(Number(namespace)).toBeGreaterThan(1000);
    }
  });

  it('takes an explicit namespace, and records the one it used', async () => {
    // The way out of a collision. Two slugs that hash to the same number are
    // unlikely and not impossible, and without this the only remedy would be
    // renaming the site — which renames its Worker, database and bucket.
    const fake = fakeCloudflare();

    await createWith(fake.run, {
      slug: 'acme',
      rateLimitNamespace: '90210',
      hasAdministrator: async () => false,
    });

    const config = await readFile(
      join(workspace, 'my-site/wrangler.jsonc'),
      'utf8',
    );
    expect(config).toContain('"namespace_id": "90210"');
    expect(config).not.toContain(
      `"namespace_id": "${rateLimitNamespace('acme')}"`,
    );

    // Recorded, so a resumed run deploys the same limiter rather than
    // re-deriving one and moving the site onto a different bucket of
    // counters.
    const ledger = JSON.parse(
      await readFile(
        join(workspace, 'my-site/.mallok/create-state.json'),
        'utf8',
      ),
    ) as { rateLimitNamespace?: string };
    expect(ledger.rateLimitNamespace).toBe('90210');
  });

  it('refuses a namespace Cloudflare would reject', async () => {
    // At deploy time this fails after the database and the bucket exist, so
    // it has to fail before anything is created or not at all.
    const fake = fakeCloudflare();

    const error = await createWith(fake.run, {
      slug: 'acme',
      noDeploy: true,
      rateLimitNamespace: '-3',
    });

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('--rate-limit-namespace');
    // Nothing was asked of Cloudflare, because the refusal comes first.
    expect(fake.calls).toEqual([]);
  });
});

describe('the read-only checks that come before the first mutation', () => {
  it('asks who is signed in, and what already exists', async () => {
    const fake = fakeCloudflare();

    await createWith(fake.run);

    const before = fake.calls
      .slice(0, fake.firstMutationIndex())
      .map((call) => call.args.join(' '));
    expect(before).toContain('whoami --json');
    expect(before).toContain('d1 info mallok-my-site-db --json');
    expect(before).toContain('r2 bucket info mallok-my-site-media --json');
    expect(before).toContain('deployments list --name mallok-my-site --json');
  });

  it('refuses a resource of the same name it did not create', async () => {
    for (const account of [
      { databases: { 'mallok-my-site-db': 'someone-elses-id' } },
      { buckets: ['mallok-my-site-media'] },
      { workers: ['mallok-my-site'] },
    ] as FakeAccount[]) {
      const fake = fakeCloudflare({ account });

      const error = await createWith(fake.run);

      expect(String(error)).toContain('already exists');
      expect(String(error)).toContain('did not create it');
      expect(fake.mutations()).toEqual([]);
    }
  });

  it('stops when the account cannot be determined', async () => {
    const fake = fakeCloudflare({ account: { accounts: [] } });

    const error = await createWith(fake.run);

    expect(String(error)).toMatch(/account/i);
    expect(fake.mutations()).toEqual([]);
  });

  it('refuses to choose between two accounts', async () => {
    const fake = fakeCloudflare({
      account: { accounts: [{ id: 'one' }, { id: 'two' }] },
    });

    const error = await createWith(fake.run);

    expect(String(error)).toContain('2 accounts');
    expect(fake.mutations()).toEqual([]);
  });
});

describe('a run that reaches the end', () => {
  it('provisions in the documented order and records everything', async () => {
    const fake = fakeCloudflare();

    const result = (await createWith(fake.run)) as {
      deployed: boolean;
      setupKey: string | null;
      origin: string | null;
    };

    expect(fake.mutations()).toEqual([
      'd1 create mallok-my-site-db',
      'r2 bucket create mallok-my-site-media',
      'deploy',
      'secret put MALLOK_SECRET',
      'secret put MALLOK_SETUP_KEY',
    ]);
    expect(result.deployed).toBe(true);

    const ledger = await readLedger(join(workspace, 'my-site'));
    expect(ledger?.schemaVersion).toBe(2);
    expect(ledger?.accountId).toBe('acct-1');
    expect(ledger?.slug).toBe('my-site');
    expect(ledger?.database?.status).toBe('created');
    expect(ledger?.database?.id).toBe('11111111-2222-4333-8444-555555555555');
    expect(ledger?.bucket?.status).toBe('created');
    expect(ledger?.worker?.status).toBe('created');
    expect(ledger?.secrets).toEqual(['MALLOK_SECRET', 'MALLOK_SETUP_KEY']);
    expect(ledger?.completedAt).toBeDefined();
    expect(ledger?.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it('writes no secret value into any file it leaves behind', async () => {
    const fake = fakeCloudflare();

    const result = (await createWith(fake.run)) as { setupKey: string | null };

    const secrets = fake.secretsSent();
    expect(secrets.MALLOK_SECRET).toMatch(/^[A-Za-z0-9+/=]{40,}$/);
    expect(result.setupKey).toBe(secrets.MALLOK_SETUP_KEY);

    for (const file of [
      '.mallok/create-state.json',
      '.mallok/sites.json',
      'package.json',
      'wrangler.jsonc',
    ]) {
      const text = await readFile(join(workspace, 'my-site', file), 'utf8');
      for (const value of Object.values(secrets)) {
        expect(text, file).not.toContain(value);
      }
    }
  });

  it('prints the setup key once, and never puts it in the ledger', async () => {
    const fake = fakeCloudflare();

    const result = (await createWith(fake.run)) as { setupKey: string | null };
    const ledger = await readLedger(join(workspace, 'my-site'));

    expect(result.setupKey).not.toBeNull();
    // The name is recorded so a resumed run knows not to set a second one;
    // the value is not, because a value in a committed file is a value that
    // outlives its one use.
    expect(ledger?.secrets).toContain('MALLOK_SETUP_KEY');
    expect(JSON.stringify(ledger)).not.toContain(result.setupKey ?? 'x');
  });
});

describe('running create again on a finished project', () => {
  it('does nothing at all and exits successfully', async () => {
    const first = fakeCloudflare();
    await createWith(first.run);

    const second = fakeCloudflare({ account: first.account });
    const result = (await createSite(
      {
        directory: '.',
        cwd: join(workspace, 'my-site'),
        slug: 'my-site',
        run: second.run,
        templateDir: template,
      },
      report,
    )) as { alreadyComplete: boolean; deployed: boolean };

    // The assertion that matters: a second run used to redeploy and rotate
    // MALLOK_SECRET, which signs every user out and makes stored plugin keys
    // unreadable.
    expect(second.mutations()).toEqual([]);
    expect(result.alreadyComplete).toBe(true);
    expect(result.deployed).toBe(true);
  });
});

describe('an interrupted run resumes from the ledger', () => {
  /** Fails the first call matching, so the run stops at that boundary. */
  async function interruptAt(
    fails: (args: readonly string[]) => boolean,
  ): Promise<ReturnType<typeof fakeCloudflare>> {
    const fake = fakeCloudflare({ failWhen: fails });
    await createWith(fake.run);
    return fake;
  }

  it('records the database before the bucket is attempted', async () => {
    const fake = await interruptAt(
      (args) =>
        args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'create',
    );

    const ledger = await readLedger(join(workspace, 'my-site'));
    expect(ledger?.database?.status).toBe('created');
    expect(ledger?.database?.id).toBeDefined();
    expect(ledger?.bucket?.status).toBe('pending');
    expect(ledger?.worker).toBeUndefined();
    expect(fake.mutations()).toEqual([
      'd1 create mallok-my-site-db',
      'r2 bucket create mallok-my-site-media',
    ]);
  });

  it('resumes without creating either resource a second time', async () => {
    const first = await interruptAt(
      (args) => args[0] === 'deploy' && args.length === 1,
    );
    expect(first.mutations()).toContain('deploy');

    const second = fakeCloudflare({ account: first.account });
    await createSite(
      {
        directory: '.',
        cwd: join(workspace, 'my-site'),
        slug: 'my-site',
        run: second.run,
        templateDir: template,
      },
      report,
    );

    expect(second.mutations()).toEqual([
      'deploy',
      'secret put MALLOK_SECRET',
      'secret put MALLOK_SETUP_KEY',
    ]);
  });

  it('does not rotate a secret that was already set', async () => {
    // The interruption that matters most: killed *after* `secret put` and
    // before the ledger recorded it. A run that generates a new value "to be
    // safe" signs every user out and makes stored plugin keys unreadable.
    const first = fakeCloudflare({
      failWhen: (args) => args[0] === 'secret' && args[1] === 'put',
      failAfterEffect: true,
    });
    await createWith(first.run);
    expect(first.account.secrets['mallok-my-site']).toContain('MALLOK_SECRET');

    const second = fakeCloudflare({ account: first.account });
    await createSite(
      {
        directory: '.',
        cwd: join(workspace, 'my-site'),
        slug: 'my-site',
        run: second.run,
        templateDir: template,
      },
      report,
    ).catch(() => undefined);

    expect(second.mutations()).not.toContain('secret put MALLOK_SECRET');
  });

  it('refuses a ledger from another account', async () => {
    const first = fakeCloudflare();
    await createWith(first.run);

    const second = fakeCloudflare({
      account: { ...first.account, accounts: [{ id: 'somebody-else' }] },
    });
    const error = await createSite(
      {
        directory: '.',
        cwd: join(workspace, 'my-site'),
        slug: 'my-site',
        run: second.run,
        templateDir: template,
      },
      report,
    ).catch((cause: unknown) => cause);

    expect(String(error)).toContain('different Cloudflare account');
    expect(second.mutations()).toEqual([]);
  });

  it('refuses a run that would deploy a different configuration', async () => {
    const first = fakeCloudflare();
    await createWith(first.run);

    const second = fakeCloudflare({ account: first.account });
    const error = await createSite(
      {
        directory: '.',
        cwd: join(workspace, 'my-site'),
        slug: 'my-site',
        domain: 'late-addition.example.com',
        run: second.run,
        templateDir: template,
      },
      report,
    ).catch((cause: unknown) => cause);

    expect(String(error)).toContain('different configuration');
    expect(second.mutations()).toEqual([]);
  });
});

describe('a damaged ledger stops the run', () => {
  for (const [label, contents] of [
    ['is not JSON', '{ not json'],
    ['is truncated', '{"schemaVersion": 2, "slug": "my-si'],
    ['has no schemaVersion', '{"slug":"my-site"}'],
    ['is from a newer CLI', '{"schemaVersion": 99, "slug": "my-site"}'],
    ['is missing fields', '{"schemaVersion": 2, "slug": "my-site"}'],
  ] as const) {
    it(`when it ${label}`, async () => {
      const fake = fakeCloudflare();
      await createWith(fake.run, { noDeploy: true });
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(workspace, 'my-site/.mallok'), { recursive: true });
      await writeFile(
        join(workspace, 'my-site/.mallok/create-state.json'),
        contents,
        'utf8',
      );

      const second = fakeCloudflare();
      const error = await createSite(
        {
          directory: '.',
          cwd: join(workspace, 'my-site'),
          slug: 'my-site',
          run: second.run,
          templateDir: template,
        },
        report,
      ).catch((cause: unknown) => cause);

      // Fail closed: treating it as absent is how a resumed run creates a
      // second database beside the one it cannot see.
      expect(String(error), label).toMatch(/create-state\.json/);
      expect(second.mutations(), label).toEqual([]);
    });
  }

  it('writes the ledger atomically', async () => {
    const projectDir = join(workspace, 'atomic');
    await writeLedger(projectDir, {
      schemaVersion: 2,
      accountId: 'acct-1',
      directory: projectDir,
      slug: 'atomic',
      domain: null,
      fingerprint: 'f'.repeat(32),
      startedAt: new Date().toISOString(),
    });

    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(join(projectDir, '.mallok'));
    // No temporary file survives a successful write.
    expect(entries).toEqual(['create-state.json']);
  });
});

describe('destroy', () => {
  async function provisioned(): Promise<ReturnType<typeof fakeCloudflare>> {
    const fake = fakeCloudflare();
    await createWith(fake.run);
    return fake;
  }

  it('needs the slug repeated before it deletes anything', async () => {
    const fake = await provisioned();
    const destroyer = fakeCloudflare({ account: fake.account });

    const error = await destroySite(
      {
        slug: 'my-site',
        confirm: undefined,
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    ).catch((cause: unknown) => cause);

    expect(String(error)).toContain('permanently deletes');
    expect(destroyer.mutations()).toEqual([]);
  });

  it('deletes in order and clears both records', async () => {
    const fake = await provisioned();
    const destroyer = fakeCloudflare({ account: fake.account });

    const result = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    );

    // Bucket first: it is the only step Cloudflare can refuse on a condition
    // this command cannot fix, and a refusal is worth far more before the
    // site is gone than after it.
    expect(destroyer.mutations()).toEqual([
      'r2 bucket delete mallok-my-site-media',
      'delete mallok-my-site',
      'd1 delete mallok-my-site-db --skip-confirmation',
    ]);
    expect(result.stoppedAt).toBeNull();
    expect(await readLedger(join(workspace, 'my-site'))).toBeNull();
    const registry = await readFile(
      join(workspace, 'my-site/.mallok/sites.json'),
      'utf8',
    );
    expect(registry).not.toContain('my-site');
  });

  it('cleans up a create that never finished', async () => {
    // The half-finished case: the database and bucket exist, the registry was
    // never written, and before the ledger was read by destroy there was no
    // way to remove them with this tool at all.
    const fake = fakeCloudflare({
      failWhen: (args) => args[0] === 'deploy' && args.length === 1,
    });
    await createWith(fake.run);
    const projectDir = join(workspace, 'my-site');
    await expect(
      readFile(join(projectDir, '.mallok/sites.json'), 'utf8'),
    ).rejects.toThrow();

    const destroyer = fakeCloudflare({ account: fake.account });
    const result = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir,
        run: destroyer.run,
      },
      report,
    );

    expect(destroyer.mutations()).toContain(
      'd1 delete mallok-my-site-db --skip-confirmation',
    );
    expect(destroyer.mutations()).toContain(
      'r2 bucket delete mallok-my-site-media',
    );
    expect(result.stoppedAt).toBeNull();
    expect(await readLedger(projectDir)).toBeNull();
  });

  it('refuses to delete on a different account', async () => {
    const fake = await provisioned();
    const destroyer = fakeCloudflare({
      account: { ...fake.account, accounts: [{ id: 'somebody-else' }] },
    });

    const error = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    ).catch((cause: unknown) => cause);

    expect(String(error)).toContain('different Cloudflare account');
    expect(destroyer.mutations()).toEqual([]);
  });

  it('does not pretend to delete a bucket that still holds objects', async () => {
    const fake = await provisioned();
    const destroyer = fakeCloudflare({
      account: fake.account,
      // Cloudflare's own refusal, which is the only way this can be known:
      // Wrangler 4.124.0 has no `r2 object list` to count with.
      failWhen: (args) =>
        args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'delete',
      failureMessage: 'The bucket you tried to delete is not empty.',
    });

    const result = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    );

    // It stopped at the first step, so the Worker and the database — and
    // therefore the running site — are untouched.
    expect(destroyer.mutations()).toEqual([
      'r2 bucket delete mallok-my-site-media',
    ]);
    expect(result.stoppedAt).toContain('bucket');
    expect(result.results.at(-1)?.detail).toContain('still holds objects');
    expect(await readLedger(join(workspace, 'my-site'))).not.toBeNull();
  });

  it('is idempotent: a repeated run does not ask twice', async () => {
    const fake = await provisioned();
    const project = join(workspace, 'my-site');

    // First run stops at the Worker, with the bucket already deleted.
    const first = fakeCloudflare({
      account: fake.account,
      failWhen: (args) => args[0] === 'delete',
      failureMessage: 'A request to the Cloudflare API failed (10000)',
    });
    const stopped = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir: project,
        run: first.run,
      },
      report,
    );
    expect(stopped.stoppedAt).toContain('Worker');

    const second = fakeCloudflare({ account: first.account });
    const finished = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir: project,
        run: second.run,
      },
      report,
    );

    // The bucket is not asked about again: the ledger records it as gone.
    expect(second.mutations()).toEqual([
      'delete mallok-my-site',
      'd1 delete mallok-my-site-db --skip-confirmation',
    ]);
    expect(finished.stoppedAt).toBeNull();
    expect(await readLedger(project)).toBeNull();
  });

  it('stops before deleting anything when the bucket has a custom domain', async () => {
    const fake = await provisioned();
    const destroyer = fakeCloudflare({
      account: {
        ...fake.account,
        domains: {
          'mallok-my-site-media': [
            { domain: 'media.example.com', enabled: true },
          ],
        },
      },
    });

    const result = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    );

    // An attached custom domain keeps the hostname claimed after the bucket
    // is gone, so it is detached first — by the operator, with the real
    // command named in the message.
    expect(destroyer.mutations()).toEqual([]);
    expect(result.stoppedAt).toContain('custom domains');
  });

  it('deletes the bucket first, so a refusal costs nothing', async () => {
    const fake = await provisioned();
    const destroyer = fakeCloudflare({ account: fake.account });

    const result = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    );

    // Cloudflare refuses to delete a bucket with objects in it. Deleting the
    // Worker and the database first would leave the site gone, its content
    // gone, and the images still there.
    expect(destroyer.mutations()).toEqual([
      'r2 bucket delete mallok-my-site-media',
      'delete mallok-my-site',
      'd1 delete mallok-my-site-db --skip-confirmation',
    ]);
    expect(result.stoppedAt).toBeNull();
  });

  it('runs no wrangler at all for a dry run', async () => {
    const fake = await provisioned();
    const destroyer = fakeCloudflare({ account: fake.account });

    const result = await destroySite(
      {
        slug: 'my-site',
        confirm: 'my-site',
        dryRun: true,
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    );

    expect(destroyer.calls).toEqual([]);
    expect(result.results.map((row) => row.detail)).toEqual([
      'dry run',
      'dry run',
      'dry run',
    ]);
    expect(await readLedger(join(workspace, 'my-site'))).not.toBeNull();
  });

  it('refuses a slug this project has no record of', async () => {
    await provisioned();
    const destroyer = fakeCloudflare();

    const error = await destroySite(
      {
        slug: 'some-other-site',
        confirm: 'some-other-site',
        projectDir: join(workspace, 'my-site'),
        run: destroyer.run,
      },
      report,
    ).catch((cause: unknown) => cause);

    expect(String(error)).toMatch(/provisioned for "my-site"/);
    expect(destroyer.mutations()).toEqual([]);
  });
});
