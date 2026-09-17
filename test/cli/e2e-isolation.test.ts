import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeE2eConfig } from '../../scripts/e2e-config.mjs';
import {
  acquireE2eLock,
  assertReusableE2eRun,
  createChildSupervisor,
  createE2eSourceSnapshot,
  E2eInterrupted,
  withE2eLock,
} from '../../scripts/e2e-server.mjs';

let workspace = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'mallok-e2e-isolation-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the browser-suite lock', () => {
  it('refuses a second run before its destructive task begins', async () => {
    const lockPath = join(workspace, 'e2e.lock');
    const statePath = join(workspace, 'e2e-state');
    await mkdir(statePath);
    await writeFile(join(statePath, 'winner.sqlite'), 'still here', 'utf8');

    const release = await acquireE2eLock(lockPath, { token: 'first' });
    let began = false;
    try {
      await expect(
        withE2eLock(
          async () => {
            began = true;
            await rm(statePath, { recursive: true, force: true });
            throw new Error('a build would start here');
          },
          { lockPath, token: 'second' },
        ),
      ).rejects.toThrow(/another Mallok browser run/i);

      expect(began).toBe(false);
      await expect(
        readFile(join(statePath, 'winner.sqlite'), 'utf8'),
      ).resolves.toBe('still here');
    } finally {
      await release();
    }
  });

  it('reclaims a lock whose process died', async () => {
    const lockPath = join(workspace, 'e2e.lock');
    // Model an abrupt Windows termination: the complete owner record remains,
    // but the process that wrote it is gone and its release callback never ran.
    await acquireE2eLock(lockPath, { pid: 12345, token: 'dead' });

    const release = await acquireE2eLock(lockPath, {
      pid: 23456,
      token: 'replacement',
      isAlive: (pid) => pid === 23456,
    });
    const owner = JSON.parse(
      await readFile(join(lockPath, 'owner.json'), 'utf8'),
    ) as { token: string };
    expect(owner.token).toBe('replacement');

    await release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never steals from a live PID, regardless of the lock age', async () => {
    const lockPath = join(workspace, 'e2e.lock');
    const release = await acquireE2eLock(lockPath, {
      pid: 12345,
      token: 'live',
      now: () => 0,
    });
    try {
      await expect(
        acquireE2eLock(lockPath, {
          pid: 23456,
          token: 'second',
          now: () => 100 * 365 * 24 * 60 * 60 * 1_000,
          isAlive: (pid) => pid === 12345,
        }),
      ).rejects.toThrow(/PID 12345/);
    } finally {
      await release();
    }
  });

  it('never guesses that an ownerless lock is stale', async () => {
    const lockPath = join(workspace, 'e2e.lock');
    await mkdir(lockPath);

    await expect(
      acquireE2eLock(lockPath, {
        pid: 23456,
        token: 'second',
        now: () => 100 * 365 * 24 * 60 * 60 * 1_000,
        isAlive: () => false,
      }),
    ).rejects.toThrow(/has no valid owner/i);
    await expect(stat(lockPath)).resolves.toMatchObject({});
  });

  it('allows only one of two concurrent stale-lock recoverers to enter', async () => {
    const lockPath = join(workspace, 'e2e.lock');
    await acquireE2eLock(lockPath, { pid: 10001, token: 'dead' });

    const contenders = [20001, 20002].map((pid) =>
      acquireE2eLock(lockPath, {
        pid,
        token: `contender-${pid}`,
        isAlive: (candidate) => candidate === 20001 || candidate === 20002,
      }),
    );
    const results = await Promise.allSettled(contenders);
    const winners = results.filter(
      (result): result is PromiseFulfilledResult<() => Promise<void>> =>
        result.status === 'fulfilled',
    );
    const losers = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(String(losers[0]?.reason)).toMatch(/another Mallok browser run/i);
    await winners[0]?.value();
  });

  it('never lets a slow stale-lock deleter remove a newer owner', async () => {
    const lockPath = join(workspace, 'e2e.lock');
    await acquireE2eLock(lockPath, { pid: 10001, token: 'dead' });
    let resumeRecovery: (() => void) | undefined;
    let reachedQuarantine: (() => void) | undefined;
    const recoveryMayFinish = new Promise<void>((resolve) => {
      resumeRecovery = resolve;
    });
    const oldLockWasMoved = new Promise<void>((resolve) => {
      reachedQuarantine = resolve;
    });

    const slowRecoverer = acquireE2eLock(lockPath, {
      pid: 20001,
      token: 'slow-recoverer',
      isAlive: (pid) => pid === 20001 || pid === 20002,
      afterQuarantine: async () => {
        reachedQuarantine?.();
        await recoveryMayFinish;
      },
    });
    await oldLockWasMoved;

    // The fixed path is now free. A new owner may install there while the old
    // stale directory is still awaiting deletion in its unique quarantine.
    const releaseNewOwner = await acquireE2eLock(lockPath, {
      pid: 20002,
      token: 'new-owner',
      isAlive: (pid) => pid === 20001 || pid === 20002,
    });
    resumeRecovery?.();

    await expect(slowRecoverer).rejects.toThrow(/PID 20002/);
    const owner = JSON.parse(
      await readFile(join(lockPath, 'owner.json'), 'utf8'),
    ) as { token: string };
    expect(owner.token).toBe('new-owner');
    await releaseNewOwner();
  });

  it('releases the lock when setup throws', async () => {
    const lockPath = join(workspace, 'e2e.lock');

    await expect(
      withE2eLock(
        () => {
          throw new Error('build failed');
        },
        { lockPath },
      ),
    ).rejects.toThrow('build failed');

    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('waits for a signalled child to exit before releasing the lock', async () => {
    const lockPath = join(workspace, 'e2e.lock');
    const readyPath = join(workspace, 'child-ready');
    const stoppedPath = join(workspace, 'child-stopped');
    const fixturePath = join(workspace, 'child.mjs');
    await writeFile(
      fixturePath,
      [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));`,
        "process.once('SIGTERM', () => {",
        `  writeFileSync(${JSON.stringify(stoppedPath)}, 'stopped');`,
        '  process.exit(0);',
        '});',
        'setInterval(() => {}, 1_000);',
      ].join('\n'),
      'utf8',
    );

    const supervisor = createChildSupervisor({
      cwd: workspace,
      stdio: 'ignore',
    });
    const waitUntilReady = async (): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await stat(readyPath)
            .then(() => true)
            .catch(() => false)
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('fixture child did not start');
    };

    await expect(
      withE2eLock(
        async () => {
          const running = supervisor.run(process.execPath, [fixturePath]);
          await waitUntilReady();
          supervisor.requestStop('SIGTERM');
          await running;
        },
        { lockPath },
      ),
    ).rejects.toBeInstanceOf(E2eInterrupted);

    await expect(readFile(stoppedPath, 'utf8')).resolves.toBe('stopped');
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('reusing a manually started browser server', () => {
  async function prepareReusableRun() {
    const lockPath = join(workspace, 'e2e.lock');
    const runsPath = join(workspace, 'e2e-runs');
    const manifestPath = join(workspace, 'e2e-current.json');
    const runId = 'run-one';
    const runRoot = join(runsPath, runId);
    const sourceRoot = join(runRoot, 'source');
    const configPath = join(runRoot, 'config/wrangler.jsonc');
    const envPath = join(runRoot, 'config/.dev.vars');
    const statePath = join(runRoot, 'state');
    await mkdir(join(sourceRoot, 'dist/pkg/cli'), { recursive: true });
    await mkdir(join(sourceRoot, 'dist/assets'), { recursive: true });
    await mkdir(join(runRoot, 'config'), { recursive: true });
    await mkdir(statePath, { recursive: true });
    await writeFile(join(sourceRoot, 'dist/pkg/cli/index.js'), 'export {};');
    await writeFile(configPath, '{}\n');
    await writeFile(envPath, 'MALLOK_SECRET=private\n', { mode: 0o600 });
    const release = await acquireE2eLock(lockPath, {
      pid: process.pid,
      token: 'matching-lock',
    });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId,
        lockToken: 'matching-lock',
        runRoot,
        sourceRoot,
        configPath,
        envPath,
        statePath,
      })}\n`,
    );
    return { lockPath, runsPath, manifestPath, release };
  }

  it('rejects reuse when no wrapper manifest exists', async () => {
    await expect(
      assertReusableE2eRun({
        manifestPath: join(workspace, 'missing.json'),
        expectedLockPath: join(workspace, 'e2e.lock'),
        expectedRunsPath: join(workspace, 'e2e-runs'),
      }),
    ).rejects.toThrow(/start `node scripts\/e2e-server\.mjs`/i);
  });

  it('accepts only a live owner whose token matches the private manifest', async () => {
    const run = await prepareReusableRun();
    try {
      await expect(
        assertReusableE2eRun({
          manifestPath: run.manifestPath,
          expectedLockPath: run.lockPath,
          expectedRunsPath: run.runsPath,
        }),
      ).resolves.toMatchObject({ runId: 'run-one' });

      const manifest = JSON.parse(
        await readFile(run.manifestPath, 'utf8'),
      ) as Record<string, unknown>;
      manifest.lockToken = 'some-other-run';
      await writeFile(run.manifestPath, `${JSON.stringify(manifest)}\n`);
      await expect(
        assertReusableE2eRun({
          manifestPath: run.manifestPath,
          expectedLockPath: run.lockPath,
          expectedRunsPath: run.runsPath,
        }),
      ).rejects.toThrow(/no live matching lock owner/i);
    } finally {
      await run.release();
    }
  });
});

describe('the generated browser environment', () => {
  it('keeps a fresh session secret in a private ignored-directory fixture', async () => {
    const projectRoot = join(workspace, 'private-source');
    const first = await writeE2eConfig(join(workspace, 'first'), projectRoot);
    const second = await writeE2eConfig(join(workspace, 'second'), projectRoot);
    const firstText = await readFile(first.envPath, 'utf8');
    const secondText = await readFile(second.envPath, 'utf8');
    const secret = (text: string): string =>
      /^MALLOK_SECRET=(.+)$/m.exec(text)?.[1] ?? '';

    expect(secret(firstText)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret(secondText)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret(firstText)).not.toBe(secret(secondText));
    if (process.platform !== 'win32') {
      expect((await stat(first.envPath)).mode & 0o777).toBe(0o600);
    }

    const config = JSON.parse(await readFile(first.configPath, 'utf8')) as {
      main?: string;
      assets?: { directory?: string };
      secrets?: { required?: string[] };
    };
    expect(config.main).toBe(join(projectRoot, 'src/worker/index.ts'));
    expect(config.assets?.directory).toBe(join(projectRoot, 'dist/assets'));
    expect(config.secrets?.required).toEqual([
      'MALLOK_SECRET',
      'MALLOK_SETUP_KEY',
    ]);
  });

  it('copies only build inputs and links dependencies into a private source tree', async () => {
    const sourceRoot = join(workspace, 'repository');
    const targetRoot = join(workspace, 'run/source');
    for (const directory of ['src', 'scripts', 'template', 'content']) {
      await mkdir(join(sourceRoot, directory), { recursive: true });
      await writeFile(join(sourceRoot, directory, 'kept.txt'), directory);
    }
    for (const file of [
      'package.json',
      'pnpm-lock.yaml',
      'LICENSE',
      'NOTICE',
      'site.json',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.base.json',
      'text-modules.d.ts',
    ]) {
      await writeFile(join(sourceRoot, file), `${file}\n`);
    }
    await mkdir(join(sourceRoot, 'node_modules'), { recursive: true });
    await writeFile(join(sourceRoot, 'node_modules/dependency.txt'), 'linked');
    await mkdir(join(sourceRoot, 'dist/pkg'), { recursive: true });
    await writeFile(join(sourceRoot, 'dist/pkg/stale.txt'), 'excluded');
    await writeFile(join(sourceRoot, '.dev.vars'), 'REAL_SECRET=excluded');
    await writeFile(join(sourceRoot, '.env'), 'ALSO_SECRET=excluded');

    await createE2eSourceSnapshot(sourceRoot, targetRoot);

    await expect(
      readFile(join(targetRoot, 'src/kept.txt'), 'utf8'),
    ).resolves.toBe('src');
    await expect(
      readFile(join(targetRoot, 'node_modules/dependency.txt'), 'utf8'),
    ).resolves.toBe('linked');
    expect(
      (await lstat(join(targetRoot, 'node_modules'))).isSymbolicLink(),
    ).toBe(true);
    await expect(stat(join(targetRoot, 'dist'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(targetRoot, '.dev.vars'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(targetRoot, '.env'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
