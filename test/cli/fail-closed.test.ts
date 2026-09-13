import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findBucket,
  findDatabase,
  findWorker,
  secretNames,
  wranglerFor,
} from '../../src/cli/cloudflare.js';
import { destroySite } from '../../src/cli/destroy.js';
import { makeReporter } from '../../src/cli/output.js';
import { fakeCloudflare } from './helpers/fake-wrangler.js';

/**
 * "I could not find out" must never be recorded as "it is not there."
 *
 * Wrangler has no machine-readable answer for absence, so this code matches
 * the wording — and the wording it matched was far too generous. Every one of
 * these is a real failure whose text contains a phrase the absence test
 * accepted:
 *
 *   Authentication error [code: 10000]: API token not found
 *   getaddrinfo ENOTFOUND api.cloudflare.com — no such host
 *   A request to the Cloudflare API failed. Route not found [code: 7003]
 *
 * Read as absence, the first two mean a probe reports "no database here" to a
 * caller that will then create a second one beside the first. In `destroy`
 * they are worse: the bucket step is marked "already gone" and the run
 * proceeds to delete the Worker and the database — on a signal that says
 * nothing about the bucket at all.
 */

const report = makeReporter(true, true);

/** Failures that are emphatically not "this resource does not exist". */
const NOT_ABSENCE = [
  ['an expired token', 'Authentication error [code: 10000]: token not found'],
  ['a DNS failure', 'getaddrinfo ENOTFOUND api.cloudflare.com: no such host'],
  [
    'an API routing error',
    'A request to the Cloudflare API failed. Route not found [code: 7003]',
  ],
  [
    'a permissions failure',
    'Authentication error [code: 10001]: no such permission on this token',
  ],
  [
    'a proxy refusing',
    'request to https://api.cloudflare.com failed, reason: connect ECONNREFUSED',
  ],
] as const;

let workspace = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-fail-closed-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('read-only probes', () => {
  const probes = [
    [
      'the database',
      (w: ReturnType<typeof wranglerFor>) => findDatabase(w, 'mallok-acme-db'),
      (a: readonly string[]) => a[0] === 'd1' && a[1] === 'info',
    ],
    [
      'the bucket',
      (w: ReturnType<typeof wranglerFor>) => findBucket(w, 'mallok-acme-media'),
      (a: readonly string[]) => a[0] === 'r2' && a[2] === 'info',
    ],
    [
      'the Worker',
      (w: ReturnType<typeof wranglerFor>) => findWorker(w, 'mallok-acme'),
      (a: readonly string[]) => a[0] === 'deployments',
    ],
    [
      'the secrets',
      (w: ReturnType<typeof wranglerFor>) => secretNames(w, 'mallok-acme'),
      (a: readonly string[]) => a[0] === 'secret' && a[1] === 'list',
    ],
  ] as const;

  for (const [what, probe, matches] of probes) {
    for (const [label, message] of NOT_ABSENCE) {
      it(`refuses to read ${label} as ${what} being absent`, async () => {
        const fake = fakeCloudflare({
          failWhen: matches,
          failureMessage: message,
        });

        await expect(probe(wranglerFor(workspace, fake.run))).rejects.toThrow();
      });
    }
  }

  it('still recognises a real absence', async () => {
    // The other half of the contract: failing closed is only useful if the
    // ordinary case still works.
    const fake = fakeCloudflare({
      failWhen: (args) => args[0] === 'd1' && args[1] === 'info',
      failureMessage: "✘ [ERROR] Couldn't find DB with name 'mallok-acme-db'",
    });

    await expect(
      findDatabase(wranglerFor(workspace, fake.run), 'mallok-acme-db'),
    ).resolves.toEqual({ exists: false });
  });
});

/** A project `destroy` will act on. */
async function project(): Promise<string> {
  const dir = join(workspace, 'site');
  await mkdir(join(dir, '.mallok'), { recursive: true });
  await mkdir(join(dir, 'node_modules/.bin'), { recursive: true });
  await writeFile(join(dir, 'node_modules/.bin/wrangler'), '#!/bin/sh\n', {
    mode: 0o755,
  });
  await writeFile(
    join(dir, '.mallok/create-state.json'),
    JSON.stringify({
      schemaVersion: 2,
      accountId: 'acct-1',
      directory: dir,
      slug: 'acme',
      domain: null,
      fingerprint: 'f',
      startedAt: '2026-09-13T00:00:00.000Z',
      origin: 'https://acme.example.workers.dev',
    }),
    'utf8',
  );
  await writeFile(
    join(dir, '.mallok/sites.json'),
    JSON.stringify({ schemaVersion: 1, sites: [] }),
    'utf8',
  );
  return dir;
}

describe('destroy, when the bucket step fails', () => {
  for (const [label, message] of NOT_ABSENCE) {
    it(`stops on ${label} instead of deleting the Worker and the database`, async () => {
      const dir = await project();
      const fake = fakeCloudflare({
        account: {
          buckets: ['mallok-acme-media'],
          workers: ['mallok-acme'],
          databases: { 'mallok-acme-db': 'db-1' },
        },
        failWhen: (args) =>
          args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'delete',
        failureMessage: message,
      });

      const result = await destroySite(
        { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
        report,
      );

      // The run stopped at the bucket.
      expect(result.stoppedAt).not.toBeNull();
      // And nothing else was even attempted. This is the whole point of
      // deleting the bucket first: the site is still serving.
      const attempted = fake.calls.map((call) => call.args.join(' '));
      expect(attempted.some((call) => call.startsWith('delete '))).toBe(false);
      expect(attempted.some((call) => call.startsWith('d1 delete'))).toBe(
        false,
      );
      expect(fake.account.workers).toContain('mallok-acme');
      expect(Object.keys(fake.account.databases)).toContain('mallok-acme-db');
    });
  }

  it('says what to do when a custom domain is holding the bucket', async () => {
    // Reported by trying the delete, not by a pre-flight probe: the probe
    // this used to run passed `--json` to `r2 bucket domain list`, which the
    // locked Wrangler does not support (`wrangler-flags.test.ts`).
    const dir = await project();
    const lines: string[] = [];
    const recording = {
      ...report,
      warn: (message: string) => lines.push(message),
    };
    const fake = fakeCloudflare({
      account: { buckets: ['mallok-acme-media'], workers: ['mallok-acme'] },
      failWhen: (args) =>
        args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'delete',
      failureMessage:
        '✘ [ERROR] A request to the Cloudflare API failed. The bucket you ' +
        'tried to delete has a custom domain attached to it. [code: 10041]',
    });

    const result = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      recording,
    );

    expect(result.stoppedAt).not.toBeNull();
    const said = lines.join('\n');
    // Real, runnable commands — both of them exist in Wrangler 4.124.0 with
    // exactly these flags.
    expect(said).toContain('wrangler r2 bucket domain list mallok-acme-media');
    expect(said).toContain(
      'wrangler r2 bucket domain remove mallok-acme-media --domain',
    );
    expect(said).not.toContain('--json');
  });

  it('continues when the bucket is genuinely not there', async () => {
    const dir = await project();
    const fake = fakeCloudflare({
      account: {
        workers: ['mallok-acme'],
        databases: { 'mallok-acme-db': 'db-1' },
      },
      failWhen: (args) =>
        args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'delete',
      failureMessage:
        '✘ [ERROR] The specified bucket does not exist. [code: 10006]',
    });

    const result = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.stoppedAt).toBeNull();
    expect(result.results.every((step) => step.ok)).toBe(true);
  });
});
