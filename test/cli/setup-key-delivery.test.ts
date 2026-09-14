import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSite } from '../../src/cli/create.js';
import { readLedger } from '../../src/cli/ledger.js';
import { makeReporter } from '../../src/cli/output.js';
import { repairSite } from '../../src/cli/repair.js';
import { writeFakeTemplate } from './helpers/fake-template.js';
import { fakeCloudflare } from './helpers/fake-wrangler.js';

/**
 * `setupKeyDeliveredAt` must mean the key reached a human being.
 *
 * Cloudflare never gives a secret's value back, so a setup key that was set
 * on the Worker and never shown to anybody is a key **nobody has** — and a
 * site nobody can finish setting up. The ledger records delivery precisely so
 * that a resumed run can tell that state from a healthy one and rotate.
 *
 * It was recorded in the wrong place. `createSite` wrote
 * `setupKeyDeliveredAt` — and `completedAt` beside it — and *then* returned,
 * and the caller printed the key afterwards. Everything between those two
 * points was a window in which the ledger claimed a delivery that had not
 * happened: a `SIGINT`, a full disk, an `EPIPE` from a closed pipe. The
 * comment in the file even said "the caller prints it; if this process dies
 * first, the next run rotates" — which is what the code would have done had
 * the two statements been the other way round.
 *
 * The consequence is the worst one available: the site is deployed, its key
 * is unknowable, and the resume that exists to fix that sees a delivery
 * already recorded and does nothing. Permanently unclaimable.
 */

const report = makeReporter(true, true);

let workspace = '';
let template = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-delivery-'));
  template = await writeFakeTemplate();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(template, { recursive: true, force: true });
});

/** Runs `create`, delivering the key through `deliver`. */
async function create(
  run: ReturnType<typeof fakeCloudflare>['run'],
  deliver?: (key: string) => Promise<void> | void,
): Promise<unknown> {
  return await createSite(
    {
      directory: 'my-site',
      slug: 'my-site',
      cwd: workspace,
      run,
      templateDir: template,
      hasAdministrator: async () => false,
      ...(deliver === undefined ? {} : { deliverSetupKey: deliver }),
    },
    report,
  ).catch((error: unknown) => error);
}

describe('when the key cannot be handed over', () => {
  it('does not record a delivery that did not happen', async () => {
    // stdout is a closed pipe — `mallok create | head -1` is enough to
    // produce this — so the write throws after the secret is already set.
    const fake = fakeCloudflare();

    await create(fake.run, () => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    });

    const ledger = await readLedger(join(workspace, 'my-site'));
    // The secret exists remotely and nobody has its value. Both of these must
    // be absent, or the resumed run below believes the site is finished and
    // never rotates. The secret's *name* is absent too, and that is harmless:
    // a resume reads the names back from Cloudflare, which is the only
    // record of them that cannot go stale.
    expect(ledger?.setupKeyDeliveredAt).toBeUndefined();
    expect(ledger?.completedAt).toBeUndefined();
  });

  it('rotates and re-delivers on the next run, rather than locking the site', async () => {
    const first = fakeCloudflare();
    await create(first.run, () => {
      throw new Error('write EPIPE');
    });

    // The Worker was deployed, so the ledger holds it as `pending` until it is
    // claimed — the explicit step that replaced automatic adoption.
    const before = await readLedger(join(workspace, 'my-site'));
    for (const kind of ['database', 'bucket', 'worker'] as const) {
      if (before?.[kind]?.status === 'pending') {
        const claim = fakeCloudflare({ account: first.account });
        await repairSite(
          {
            slug: 'my-site',
            projectDir: join(workspace, 'my-site'),
            adopt: [kind],
            // A D1 adoption repeats back the id the operator read; R2 and
            // Workers have no id to repeat, and this is ignored for them.
            expectId: first.account.databases['mallok-my-site-db'] ?? '',
            run: claim.run,
          },
          report,
        );
      }
    }

    const delivered: string[] = [];
    const second = fakeCloudflare({ account: first.account });
    await create(second.run, (key) => {
      delivered.push(key);
    });

    // A new key was set and this time it reached somebody.
    expect(
      second.calls
        .map((call) => call.args.join(' '))
        .filter((call) => call.includes('secret put MALLOK_SETUP_KEY')),
    ).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).not.toBe('');

    const ledger = await readLedger(join(workspace, 'my-site'));
    expect(ledger?.setupKeyDeliveredAt).toBeDefined();
    expect(ledger?.completedAt).toBeDefined();
  });

  it('never writes the key itself into the ledger', async () => {
    const fake = fakeCloudflare();
    const delivered: string[] = [];
    await create(fake.run, (key) => {
      delivered.push(key);
    });

    const raw = await readFile(
      join(workspace, 'my-site/.mallok/create-state.json'),
      'utf8',
    );
    expect(delivered).toHaveLength(1);
    expect(raw).not.toContain(delivered[0] as string);
  });
});

describe('when the key is handed over', () => {
  it('records the delivery only after the handover returns', async () => {
    // The ordering, asserted directly: at the moment `deliver` is called the
    // ledger must not yet claim a delivery.
    const fake = fakeCloudflare();
    let ledgerDuringDelivery: string | undefined = 'not read';

    await create(fake.run, async () => {
      const ledger = await readLedger(join(workspace, 'my-site'));
      ledgerDuringDelivery = ledger?.setupKeyDeliveredAt;
    });

    expect(ledgerDuringDelivery).toBeUndefined();
    const after = await readLedger(join(workspace, 'my-site'));
    expect(after?.setupKeyDeliveredAt).toBeDefined();
  });
});
