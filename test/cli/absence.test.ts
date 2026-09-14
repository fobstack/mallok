import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ABSENCE_PATTERNS,
  findBucket,
  findDatabase,
  findWorker,
  secretNames,
  wranglerFor,
} from '../../src/cli/cloudflare.js';
import { destroySite } from '../../src/cli/destroy.js';
import { makeReporter } from '../../src/cli/output.js';
import { fakeCloudflare } from './helpers/fake-wrangler.js';

const execFileAsync = promisify(execFile);

/**
 * A 404 is not a fact about a resource.
 *
 * The absence test matched `not found` anywhere in the output, and Wrangler
 * 4.124.0's own bundle contains `Not Found`, `Not found.`, `Page not found.`,
 * `Application not found` and `Deployment not found` — none of which says
 * anything about whether *this* database, bucket or Worker exists. Neither
 * does an HTML error page from a corporate proxy, nor a 404 from an API
 * gateway that has been reconfigured.
 *
 * Read as absence, that makes a resumed `create` build a second database
 * beside the one it could not see. In `destroy` it is worse: the bucket step
 * is recorded as "already gone" and the run proceeds to delete the Worker and
 * the database — on a signal that concerned neither.
 *
 * So absence now has to be **claimed by the resource's own error**, one
 * pattern per resource kind, each one a string that genuinely appears in the
 * locked Wrangler. Everything else stops.
 */

const report = makeReporter(true, true);

/** 404s that say nothing about any particular resource. */
const BARE_404 = [
  ['an HTTP status line', 'HTTP 404 Not Found'],
  ['a bare body', 'Not Found'],
  ['a Go-style gateway', '404 page not found'],
  [
    'a proxy error page',
    '<html><head><title>404 Not Found</title></head><body>nginx</body></html>',
  ],
  [
    'an API routing failure',
    'A request to the Cloudflare API failed. Not found [code: 7003]',
  ],
  // Real Wrangler strings — about something else entirely.
  ['a missing deployment', 'Deployment not found'],
  ['a missing application', 'Application not found'],
] as const;

let workspace = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-absence-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the absence patterns are quotations, not inventions', () => {
  it('every one of them appears in the locked Wrangler’s own bundle', async () => {
    // The whole design rests on these being what Wrangler really says. A
    // pattern nobody can find in the binary is a guess, and a guess here
    // either strands an operator or deletes a live site.
    const { stdout } = await execFileAsync(
      'node',
      ['-e', 'console.log(require.resolve("wrangler/package.json"))'],
      { cwd: process.cwd() },
    );
    const { readFile } = await import('node:fs/promises');
    const bundle = await readFile(
      join(stdout.trim(), '../wrangler-dist/cli.js'),
      'utf8',
    );

    for (const [kind, entries] of Object.entries(ABSENCE_PATTERNS)) {
      expect(entries.length, kind).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(bundle, `${kind}: ${entry.quote}`).toContain(entry.quote);
      }
    }
  }, 60_000);
});

describe('read-only probes refuse a bare 404', () => {
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
    for (const [label, message] of BARE_404) {
      it(`refuses to read ${label} as ${what} being absent`, async () => {
        const fake = fakeCloudflare({
          failWhen: matches,
          failureMessage: message,
        });

        await expect(probe(wranglerFor(workspace, fake.run))).rejects.toThrow();
      });
    }
  }
});

describe('read-only probes still recognise the real thing', () => {
  it('the D1 message Wrangler actually prints', async () => {
    const fake = fakeCloudflare({
      failWhen: (args) => args[0] === 'd1' && args[1] === 'info',
      failureMessage: '✘ [ERROR] Couldn\'t find a D1 DB named "mallok-acme-db"',
    });

    await expect(
      findDatabase(wranglerFor(workspace, fake.run), 'mallok-acme-db'),
    ).resolves.toEqual({ exists: false });
  });

  it('the R2 message Wrangler actually prints', async () => {
    const fake = fakeCloudflare({
      failWhen: (args) => args[0] === 'r2' && args[2] === 'info',
      failureMessage: '✘ [ERROR] The specified bucket does not exist.',
    });

    await expect(
      findBucket(wranglerFor(workspace, fake.run), 'mallok-acme-media'),
    ).resolves.toEqual({ exists: false });
  });

  it('the Worker code Wrangler actually reports', async () => {
    const fake = fakeCloudflare({
      failWhen: (args) => args[0] === 'deployments',
      failureMessage:
        '✘ [ERROR] A request to the Cloudflare API failed. workers.api.error.script_not_found [code: 10007]',
    });

    await expect(
      findWorker(wranglerFor(workspace, fake.run), 'mallok-acme'),
    ).resolves.toEqual({ exists: false });
  });

  it('the message a secret list gives for a Worker that is not there', async () => {
    const fake = fakeCloudflare({
      failWhen: (args) => args[0] === 'secret' && args[1] === 'list',
      failureMessage:
        '✘ [ERROR] This Worker does not exist yet, so secrets cannot be set in advance.',
    });

    await expect(
      secretNames(wranglerFor(workspace, fake.run), 'mallok-acme'),
    ).resolves.toEqual([]);
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
      startedAt: '2026-09-14T00:00:00.000Z',
      database: { status: 'created', name: 'mallok-acme-db', id: 'db-1' },
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

describe('destroy refuses a bare 404 from the bucket delete', () => {
  for (const [label, message] of BARE_404) {
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

      expect(result.stoppedAt).not.toBeNull();
      const attempted = fake.calls.map((call) => call.args.join(' '));
      expect(attempted.some((call) => call.startsWith('delete '))).toBe(false);
      expect(attempted.some((call) => call.startsWith('d1 delete'))).toBe(
        false,
      );
      expect(fake.account.workers).toContain('mallok-acme');
      expect(Object.keys(fake.account.databases)).toContain('mallok-acme-db');
    });
  }

  it('continues on the refusal R2 genuinely gives for a missing bucket', async () => {
    const dir = await project();
    const fake = fakeCloudflare({
      account: {
        workers: ['mallok-acme'],
        databases: { 'mallok-acme-db': 'db-1' },
      },
      failWhen: (args) =>
        args[0] === 'r2' && args[1] === 'bucket' && args[2] === 'delete',
      failureMessage: '✘ [ERROR] The specified bucket does not exist.',
    });

    const result = await destroySite(
      { slug: 'acme', confirm: 'acme', projectDir: dir, run: fake.run },
      report,
    );

    expect(result.stoppedAt).toBeNull();
  });
});
