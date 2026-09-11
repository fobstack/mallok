import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSite } from '../../src/cli/create.js';
import { readLedger } from '../../src/cli/ledger.js';
import { makeReporter } from '../../src/cli/output.js';
import { writeFakeTemplate } from './helpers/fake-template.js';
import { fakeCloudflare } from './helpers/fake-wrangler.js';

/**
 * Every remote step, interrupted twice.
 *
 * A command that changes somebody's Cloudflare account has two failure modes
 * per call, and they are not the same:
 *
 * - **before the effect**: the call never reached Cloudflare, and nothing
 *   exists;
 * - **after the effect**: Cloudflare did the work and the CLI never found
 *   out — the process was killed, the connection dropped, or the answer was
 *   an error after a successful write.
 *
 * The second is the dangerous one, because the resource exists and nothing
 * local says so. A resumed run must recognise it as **its own** — from the
 * account, the name and, for D1, the id — and must neither create a second
 * one nor adopt a stranger's.
 *
 * Each case below runs `create` to the interruption, then resumes, and
 * asserts the exact sequence of mutating calls the resumed run made.
 */

const report = makeReporter(true);

let workspace = '';
let template = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-crash-'));
  template = await writeFakeTemplate();
});

afterEach(async () => {
  for (const path of [workspace, template]) {
    await rm(path, { recursive: true, force: true });
  }
});

/** The five calls that change the account, in the order `create` makes them. */
const MUTATIONS = {
  database: (args: readonly string[]) =>
    args[0] === 'd1' && args[1] === 'create',
  bucket: (args: readonly string[]) =>
    args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'create',
  deploy: (args: readonly string[]) =>
    args[0] === 'deploy' && args.length === 1,
  secret: (args: readonly string[]) =>
    args[0] === 'secret' && args[1] === 'put' && args[2] === 'MALLOK_SECRET',
  setupKey: (args: readonly string[]) =>
    args[0] === 'secret' && args[1] === 'put' && args[2] === 'MALLOK_SETUP_KEY',
} as const;

type Runner = NonNullable<Parameters<typeof createSite>[0]['run']>;

async function create(
  run: Runner,
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

async function resume(run: Runner): Promise<unknown> {
  return await createSite(
    {
      directory: '.',
      cwd: join(workspace, 'my-site'),
      slug: 'my-site',
      run,
      templateDir: template,
    },
    report,
  ).catch((error: unknown) => error);
}

/**
 * Whether a resumed run is expected to make the call again.
 *
 * Three of the five must not: creating a second database or bucket leaves a
 * stray resource, and re-putting `MALLOK_SECRET` signs every user out and
 * makes stored plugin keys unreadable. Two of them must:
 *
 * - **deploy** is idempotent, and the bundle a half-finished run uploaded may
 *   predate the database id since written into `wrangler.jsonc`;
 * - **MALLOK_SETUP_KEY** is rotated, because a key the CLI set and never
 *   managed to print is a key nobody has. Rotating it is the recovery, and it
 *   is safe precisely while no administrator exists.
 */
const REPEATS: Readonly<Record<keyof typeof MUTATIONS, boolean>> = {
  database: false,
  bucket: false,
  deploy: true,
  secret: false,
  setupKey: true,
};

describe.each([
  ['the database', 'database'],
  ['the bucket', 'bucket'],
  ['the deploy', 'deploy'],
  ['MALLOK_SECRET', 'secret'],
  ['MALLOK_SETUP_KEY', 'setupKey'],
] as const)('%s', (_label, step) => {
  const fails = MUTATIONS[step];

  it('creates nothing when the call fails before it takes effect', async () => {
    const first = fakeCloudflare({ failWhen: fails });
    await create(first.run);

    // Whatever came before it happened; this call did not.
    expect(first.mutations().filter((call) => fails(call.split(' ')))).toEqual(
      // The attempt is recorded — it was made — but the account is unchanged.
      first.mutations().filter((call) => fails(call.split(' '))),
    );
    expect(first.account.applied).not.toContain(step);
  });

  it('handles the call having taken effect without the CLI hearing', async () => {
    // The interruption that matters: Cloudflare did it, the answer was lost.
    const first = fakeCloudflare({ failWhen: fails, failAfterEffect: true });
    await create(first.run);
    expect(first.account.applied).toContain(step);

    const second = fakeCloudflare({ account: first.account });
    await resume(second.run);

    const repeated = second
      .mutations()
      .filter((call) => fails(call.split(' ')));
    expect(
      repeated.length > 0,
      `${step} repeated: ${repeated.join(', ')}`,
    ).toBe(REPEATS[step]);
  });

  it('finishes the run when it is resumed', async () => {
    const first = fakeCloudflare({ failWhen: fails, failAfterEffect: true });
    await create(first.run);

    const second = fakeCloudflare({ account: first.account });
    const result = (await resume(second.run)) as { deployed?: boolean };

    expect(result.deployed).toBe(true);
    const ledger = await readLedger(join(workspace, 'my-site'));
    expect(ledger?.completedAt).toBeDefined();
    expect(ledger?.secrets).toEqual(['MALLOK_SECRET', 'MALLOK_SETUP_KEY']);
  });
});

describe('reconciling a pending resource', () => {
  it('adopts the database it created, matching on the id', async () => {
    // Killed after `d1 create` succeeded: the ledger says `pending` and the
    // database exists. It is ours — same account, same name, and the id
    // Cloudflare reports is the one we can read back.
    const first = fakeCloudflare({
      failWhen: MUTATIONS.database,
      failAfterEffect: true,
    });
    await create(first.run);
    const before = await readLedger(join(workspace, 'my-site'));
    expect(before?.database?.status).toBe('pending');

    const second = fakeCloudflare({ account: first.account });
    await resume(second.run);

    expect(
      second.mutations().filter((call) => call.startsWith('d1 create')),
    ).toEqual([]);
    const after = await readLedger(join(workspace, 'my-site'));
    // `adopted`, not `created`: this run did not create it, it recognised it.
    // The distinction is kept because it is the honest record of what
    // happened, and a later reader deserves to know.
    expect(after?.database?.status).toBe('adopted');
    expect(after?.database?.id).toBe(
      first.account.databases['mallok-my-site-db'],
    );
  });

  it('will not adopt a pending resource on a different account', async () => {
    const first = fakeCloudflare({
      failWhen: MUTATIONS.bucket,
      failAfterEffect: true,
    });
    await create(first.run);

    const second = fakeCloudflare({
      account: { ...first.account, accounts: [{ id: 'somebody-else' }] },
    });
    const error = await resume(second.run);

    expect(String(error)).toContain('different Cloudflare account');
    expect(second.mutations()).toEqual([]);
  });

  it('will not adopt a same-named resource it has no record of', async () => {
    // No ledger at all, and the names are taken: this is somebody else's
    // site, whatever it is called.
    const fake = fakeCloudflare({
      account: { databases: { 'mallok-my-site-db': 'not-ours' } },
    });

    const error = await create(fake.run);

    expect(String(error)).toContain('did not create it');
    expect(fake.mutations()).toEqual([]);
  });
});

describe('read-only probes fail closed', () => {
  for (const [label, matches] of [
    ['whoami', (args: readonly string[]) => args[0] === 'whoami'],
    [
      'd1 info',
      (args: readonly string[]) => args[0] === 'd1' && args[1] === 'info',
    ],
    [
      'r2 bucket info',
      (args: readonly string[]) =>
        args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'info',
    ],
    [
      'deployments list',
      (args: readonly string[]) =>
        args[0] === 'deployments' && args[1] === 'list',
    ],
  ] as const) {
    it(`stops when ${label} fails for a reason that is not "absent"`, async () => {
      // A network error, an expired token or a missing permission is not the
      // same answer as "no such resource". Reading it as absence is how a
      // second database gets created beside the first.
      const fake = fakeCloudflare({
        failWhen: matches,
        failureMessage:
          'fetch failed: getaddrinfo ENOTFOUND api.cloudflare.com',
      });

      const error = await create(fake.run);

      expect(String(error)).toMatch(/could not|failed|not signed in/i);
      expect(fake.mutations()).toEqual([]);
    });
  }

  it('never re-sets MALLOK_SECRET when the secret list cannot be read', async () => {
    // The worst case in this file. `secret list` failing must not be read as
    // "no secrets": putting a fresh MALLOK_SECRET signs every user out and
    // makes every stored plugin key unreadable.
    //
    // Interrupted at the deploy, so the resumed run genuinely reaches the
    // secret step rather than short-circuiting on a finished ledger.
    const first = fakeCloudflare({
      failWhen: MUTATIONS.deploy,
      failAfterEffect: true,
    });
    await create(first.run);

    const second = fakeCloudflare({
      account: first.account,
      failWhen: (args) => args[0] === 'secret' && args[1] === 'list',
      failureMessage: 'A request to the Cloudflare API failed (10000)',
    });
    const error = await resume(second.run);

    expect(
      second.mutations().filter((call) => call.startsWith('secret put')),
    ).toEqual([]);
    expect(String(error)).toMatch(/secrets set on/i);
  });
});

describe('the registry, when its write is the thing that failed', () => {
  it('is rebuilt by a resumed run', async () => {
    const first = fakeCloudflare();
    await create(first.run);
    const project = join(workspace, 'my-site');

    // A completed ledger and no registry: the process died between the two.
    await rm(join(project, '.mallok/sites.json'), { force: true });

    const second = fakeCloudflare({ account: first.account });
    await resume(second.run);

    const registry = JSON.parse(
      await readFile(join(project, '.mallok/sites.json'), 'utf8'),
    ) as { sites: { slug: string; accountId: string }[] };
    expect(registry.sites[0]?.slug).toBe('my-site');
    expect(registry.sites[0]?.accountId).toBe('acct-1');
    // And it did it without touching the account.
    expect(second.mutations()).toEqual([]);
  });
});
