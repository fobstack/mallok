import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CommandRunner,
  createSite,
  preflightSteps,
  readState,
  slugFromDirectory,
} from '../../src/cli/create.js';
import { makeReporter } from '../../src/cli/output.js';

/**
 * The rule this file exists for: **nothing on Cloudflare is created until the
 * generated project has been installed, built and dry-run locally.**
 *
 * The command used to do the opposite — sign in, create D1, create R2, write a
 * config, then attempt the deploy. A project that could not build left two
 * real resources behind, named after a site that did not exist, recorded
 * nowhere. Counting the mutating calls is the only way to keep that fixed:
 * a message saying "preflight failed" proves nothing about what already ran.
 */

/** Every wrangler subcommand that changes something on the account. */
const MUTATIONS = [
  ['d1', 'create'],
  ['r2', 'bucket', 'create'],
  ['deploy'],
  ['secret', 'put'],
] as const;

function isMutation(args: readonly string[]): boolean {
  // `deploy --dry-run` is the preflight check and changes nothing; only a real
  // deploy counts. Getting this wrong in the other direction would make the
  // test pass while resources were being created.
  if (args.includes('--dry-run')) {
    return false;
  }
  return MUTATIONS.some((mutation) =>
    mutation.every((token, index) => args[index] === token),
  );
}

/** A fake wrangler and package manager that records everything asked of it. */
function recorder(fail?: (args: readonly string[]) => boolean) {
  const calls: { command: string; args: string[] }[] = [];
  const run: CommandRunner = async (command, args, options) => {
    calls.push({ command, args: [...args] });
    // A real `pnpm install` puts wrangler in the project; the provisioning
    // step refuses to run without it, so the fake has to do the same.
    if (args[0] === 'install') {
      const { mkdir, writeFile: write } = await import('node:fs/promises');
      const bin = join(options.cwd, 'node_modules/.bin');
      await mkdir(bin, { recursive: true });
      await write(join(bin, 'wrangler'), '#!/bin/sh\nexit 0\n', {
        mode: 0o755,
      });
    }
    const failed = fail?.(args) ?? false;
    if (failed) {
      return { code: 1, stdout: '', stderr: 'boom: the build failed' };
    }
    // wrangler prints the new database's id; the CLI parses it out.
    const stdout =
      args[0] === 'd1' && args[1] === 'create'
        ? '"database_id": "11111111-2222-4333-8444-555555555555"'
        : '';
    return { code: 0, stdout, stderr: '' };
  };
  const mutations = () =>
    calls
      .filter((call) => isMutation(call.args))
      .map((call) => call.args.join(' '));
  return { calls, run, mutations };
}

/** A template just complete enough for `verifyTemplate` to accept it. */
async function fakeTemplate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mallok-template-'));
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'mallok-site', version: '0.1.0' }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'wrangler.jsonc': JSON.stringify({
      name: 'placeholder',
      database_name: 'placeholder',
      database_id: 'placeholder',
      bucket_name: 'placeholder',
      compatibility_date: '2026-01-01',
    }),
    'tsconfig.json': '{}',
    'src/worker/index.ts': 'export default {};\n',
    'src/runtime/core/index.ts': 'export {};\n',
    'src/db/migrations/0001_init.sql': 'SELECT 1;\n',
  };
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    await writeFile(path, body, 'utf8').catch(async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, body, 'utf8');
    });
  }
  return root;
}

let template = '';
let workspace = '';
const report = makeReporter(true);

beforeEach(async () => {
  template = await fakeTemplate();
  workspace = await mkdtemp(join(tmpdir(), 'mallok-workspace-'));
});

afterEach(async () => {
  for (const path of [template, workspace]) {
    await rm(path, { recursive: true, force: true });
  }
});

describe('preflight runs before anything is provisioned', () => {
  it('creates nothing on Cloudflare when the build fails', async () => {
    const fake = recorder((args) => args[0] === 'run' && args[1] === 'build');

    await expect(
      createSite(
        {
          directory: 'my-site',
          cwd: workspace,
          run: fake.run,
          templateDir: template,
        },
        report,
      ),
    ).rejects.toThrow(/Building failed/);

    // The assertion that matters, stated as a count rather than a feeling.
    expect(fake.mutations()).toEqual([]);
    expect(fake.calls.filter((c) => c.args[0] === 'whoami')).toHaveLength(0);
  });

  it('creates nothing when the install fails', async () => {
    const fake = recorder((args) => args[0] === 'install');
    await expect(
      createSite(
        {
          directory: 'my-site',
          cwd: workspace,
          run: fake.run,
          templateDir: template,
        },
        report,
      ),
    ).rejects.toThrow(/Installing dependencies/);
    expect(fake.mutations()).toEqual([]);
  });

  it('creates nothing when the deploy dry-run fails', async () => {
    // The last preflight gate: the project installs and builds but wrangler
    // refuses it. Resources must still not exist.
    const fake = recorder(
      (args) => args[0] === 'deploy' && args[1] === '--dry-run',
    );
    await expect(
      createSite(
        {
          directory: 'my-site',
          cwd: workspace,
          run: fake.run,
          templateDir: template,
        },
        report,
      ),
    ).rejects.toThrow(/deploy would succeed/);
    expect(fake.mutations()).toEqual([]);
  });

  it('creates nothing with --no-deploy, even when everything passes', async () => {
    const fake = recorder();
    const result = await createSite(
      {
        directory: 'my-site',
        cwd: workspace,
        noDeploy: true,
        run: fake.run,
        templateDir: template,
      },
      report,
    );
    expect(result.deployed).toBe(false);
    expect(fake.mutations()).toEqual([]);
    // The project is real, though.
    await expect(
      readFile(join(workspace, 'my-site/package.json'), 'utf8'),
    ).resolves.toContain('my-site');
  });

  it('keeps no files and touches nothing with --dry-run', async () => {
    const fake = recorder();
    const result = await createSite(
      {
        directory: 'my-site',
        cwd: workspace,
        dryRun: true,
        run: fake.run,
        templateDir: template,
      },
      report,
    );
    expect(fake.mutations()).toEqual([]);
    await expect(
      readFile(join(result.projectDir, 'package.json'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(workspace, 'my-site/package.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('uses the project’s own wrangler, never npx', async () => {
    // `npx wrangler` resolves to the newest release on the registry, so a
    // create run could deploy with a Wrangler the project was never built
    // against — and the failure would arrive after the resources existed.
    const steps = preflightSteps('/somewhere/my-site');
    const deployCheck = steps.at(-1);
    expect(deployCheck?.command).toBe(
      '/somewhere/my-site/node_modules/.bin/wrangler',
    );
    expect(steps.map((step) => step.command)).not.toContain('npx');
  });
});

describe('the directory and the slug are separate', () => {
  it('derives a slug from the directory name', () => {
    expect(slugFromDirectory('my-site')).toBe('my-site');
    expect(slugFromDirectory('My Site')).toBe('my-site');
    expect(slugFromDirectory('/tmp/Acme_Trading/')).toBe('acme-trading');
  });

  it('refuses a directory that already has files in it', async () => {
    const fake = recorder();
    await writeFile(join(workspace, 'taken'), 'x', 'utf8');
    await expect(
      createSite(
        {
          directory: 'taken',
          cwd: workspace,
          run: fake.run,
          templateDir: template,
        },
        report,
      ),
    ).rejects.toThrow(/already exists/);
    expect(fake.mutations()).toEqual([]);
  });
});

describe('an interrupted run is recoverable', () => {
  it('records each resource before the next step runs', async () => {
    const fake = recorder(
      (args) => args[0] === 'deploy' && args[1] !== '--dry-run',
    );
    const projectDir = join(workspace, 'my-site');

    await expect(
      createSite(
        {
          directory: 'my-site',
          cwd: workspace,
          run: fake.run,
          templateDir: template,
        },
        report,
      ),
    ).rejects.toThrow(/deploy failed/);

    // The database and bucket exist, so the ledger has to say so — otherwise
    // the next run cannot tell them from someone else's resources.
    const state = await readState(projectDir);
    expect(state?.databaseName).toBe('mallok-my-site-db');
    expect(state?.bucketName).toBe('mallok-my-site-media');
    expect(state?.deployedAt).toBeUndefined();
    // And never a secret.
    expect(JSON.stringify(state)).not.toMatch(/secret|token|key/i);
  });

  it('does not create the same resources twice on a resumed run', async () => {
    const projectDir = join(workspace, 'my-site');
    const first = recorder(
      (args) => args[0] === 'deploy' && args[1] !== '--dry-run',
    );
    await createSite(
      {
        directory: 'my-site',
        cwd: workspace,
        run: first.run,
        templateDir: template,
      },
      report,
    ).catch(() => undefined);

    // Resume into the same directory. `create` refuses a non-empty target, so
    // a resume is `create .` from inside it — the state file is what makes the
    // second run skip what the first already did.
    const second = recorder();
    await createSite(
      {
        directory: '.',
        cwd: projectDir,
        slug: 'my-site',
        run: second.run,
        templateDir: template,
      },
      report,
    ).catch(() => undefined);

    expect(
      second.mutations().filter((call) => call.startsWith('d1 create')),
    ).toEqual([]);
    expect(
      second.mutations().filter((call) => call.startsWith('r2 bucket create')),
    ).toEqual([]);
  });

  it('refuses to adopt a resource it did not create', async () => {
    const fake = recorder();
    // A pre-existing database of the same name belongs to somebody else's
    // site; pointing this project at it would mean two sites sharing content.
    const runner: CommandRunner = async (command, args, options) => {
      if (args[0] === 'd1' && args[1] === 'create') {
        return {
          code: 1,
          stdout: '',
          stderr: 'A database with that name already exists',
        };
      }
      return fake.run(command, args, options);
    };

    await expect(
      createSite(
        {
          directory: 'my-site',
          cwd: workspace,
          run: runner,
          templateDir: template,
        },
        report,
      ),
    ).rejects.toThrow(/already exists and was not created by this run/);
  });
});
