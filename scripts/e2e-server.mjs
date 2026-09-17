/**
 * Starts the one browser-test Worker under an exclusive local lock.
 *
 * Each run serves hashed files from its own source snapshot. The lock is
 * acquired before either that private build or the persisted test state is
 * touched, so two Playwright runs cannot compete for port 8788 or overwrite
 * their rendezvous manifest. A dead owner is reclaimed, and the owner token
 * stops an older process from removing a newer process's lock during cleanup.
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeE2eConfig } from './e2e-config.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = resolve(repo, '.tmp');
const lockPath = resolve(scratch, 'e2e.lock');
const runsPath = resolve(scratch, 'e2e-runs');
const currentRunPath = resolve(scratch, 'e2e-current.json');
const OWNER_FILE = 'owner.json';
const RECOVERY_RETRIES = 500;
const RECOVERY_RETRY_MS = 10;

/**
 * The complete source set consumed by build-package and the static-site
 * accessibility checks. It is deliberately an allow-list: a developer's
 * `.dev.vars`, `.env`, registry config and existing build output must never
 * enter the browser run's private checkout by accident.
 */
const SNAPSHOT_ENTRIES = [
  'src',
  'scripts',
  'template',
  'content',
  'package.json',
  'pnpm-lock.yaml',
  'LICENSE',
  'NOTICE',
  'site.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.base.json',
  'text-modules.d.ts',
];

/** Copies the E2E build inputs and links the already locked dependencies. */
export async function createE2eSourceSnapshot(
  sourceRoot,
  targetRoot,
  dependencies = resolve(sourceRoot, 'node_modules'),
) {
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  for (const entry of SNAPSHOT_ENTRIES) {
    await cp(resolve(sourceRoot, entry), resolve(targetRoot, entry), {
      recursive: true,
    });
  }
  await symlink(dependencies, resolve(targetRoot, 'node_modules'), 'junction');
  return targetRoot;
}

/** Reads the non-secret rendezvous file used by the Playwright specs. */
export async function readE2eRunManifest(path = currentRunPath) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (
    value?.schemaVersion !== 1 ||
    typeof value.runId !== 'string' ||
    typeof value.lockToken !== 'string' ||
    value.lockToken === '' ||
    typeof value.runRoot !== 'string' ||
    typeof value.sourceRoot !== 'string' ||
    typeof value.configPath !== 'string' ||
    typeof value.envPath !== 'string' ||
    typeof value.statePath !== 'string'
  ) {
    throw new Error('The Mallok browser-run manifest is invalid.');
  }
  return value;
}

export class E2eLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'E2eLockError';
  }
}

/** A PID that exists but is not signalable still owns its lock. */
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function readOwner(path) {
  try {
    const value = JSON.parse(await readFile(resolve(path, OWNER_FILE), 'utf8'));
    return Number.isInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.token === 'string' &&
      value.token !== ''
      ? value
      : null;
  } catch {
    return null;
  }
}

/** One stable observation of a lock directory and the owner inside it. */
async function observeLock(path) {
  const before = await stat(path).catch(() => null);
  if (before === null || !before.isDirectory()) {
    return null;
  }
  const owner = await readOwner(path);
  const after = await stat(path).catch(() => null);
  if (after === null || before.dev !== after.dev || before.ino !== after.ino) {
    return null;
  }
  return {
    dev: after.dev,
    ino: after.ino,
    owner,
  };
}

function sameObservation(left, right) {
  return (
    left !== null &&
    right !== null &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.owner?.pid === right.owner?.pid &&
    left.owner?.token === right.owner?.token
  );
}

/** The recovery claim is an OS-owned loopback listener, released on SIGKILL. */
function recoveryPort(path) {
  const hash = createHash('sha256').update(resolve(path)).digest();
  return 40_000 + (hash.readUInt16BE(0) % 20_000);
}

async function acquireRecoveryClaim(path) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    const failed = (error) => reject(error);
    server.once('error', failed);
    server.listen(
      { host: '127.0.0.1', port: recoveryPort(path), exclusive: true },
      () => {
        server.off('error', failed);
        resolveListen();
      },
    );
  });
  let closed = false;
  return async () => {
    if (closed) {
      return;
    }
    closed = true;
    await new Promise((resolveClose, reject) => {
      server.close((error) =>
        error === undefined ? resolveClose() : reject(error),
      );
    });
  };
}

async function installPreparedLock(path, owner) {
  const candidate = `${path}.candidate-${randomUUID()}`;
  await rm(candidate, { recursive: true, force: true });
  await mkdir(candidate);
  await writeFile(
    resolve(candidate, OWNER_FILE),
    `${JSON.stringify(owner)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  );
  try {
    await rename(candidate, path);
    return true;
  } catch (error) {
    if ((await stat(path).catch(() => null)) !== null) {
      return false;
    }
    throw error;
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

const wait = (milliseconds) =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

/**
 * Removes exactly the stale directory that was observed. Recovery contenders
 * are serialised by an OS-owned listener, so a killed recoverer leaves no
 * second filesystem lock that itself needs unsafe stale deletion.
 */
async function recoverObservedLock(path, observed, isAlive, afterQuarantine) {
  let releaseRecovery;
  try {
    releaseRecovery = await acquireRecoveryClaim(path);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      return false;
    }
    throw error;
  }

  try {
    const confirmed = await observeLock(path);
    if (!sameObservation(observed, confirmed)) {
      return false;
    }
    if (confirmed.owner === null) {
      throw new E2eLockError(
        'The Mallok browser lock has no valid owner. Inspect and remove .tmp/e2e.lock manually only after confirming that no E2E wrapper is running.',
      );
    }
    if (isAlive(confirmed.owner.pid)) {
      throw new E2eLockError(
        `Another Mallok browser run owns .tmp/e2e.lock (PID ${confirmed.owner.pid}).`,
      );
    }

    const quarantine = `${path}.stale-${confirmed.owner.token}-${randomUUID()}`;
    let quarantined = true;
    await rename(path, quarantine).catch((error) => {
      if (error?.code === 'ENOENT') {
        quarantined = false;
        return;
      }
      throw error;
    });
    if (!quarantined) {
      return false;
    }
    const moved = await observeLock(quarantine);
    if (!sameObservation(confirmed, moved)) {
      throw new E2eLockError(
        'The Mallok browser lock changed during recovery; refusing to delete either directory.',
      );
    }
    await afterQuarantine?.();
    await rm(quarantine, { recursive: true, force: true });
    return true;
  } finally {
    await releaseRecovery();
  }
}

/**
 * Acquires an atomic directory lock and returns an ownership-checked release.
 * Options are injectable so the stale-owner cases can be tested without
 * starting or killing a real process.
 */
export async function acquireE2eLock(
  path = lockPath,
  {
    pid = process.pid,
    token = randomUUID(),
    now = () => Date.now(),
    isAlive = processIsAlive,
    afterQuarantine,
  } = {},
) {
  await mkdir(dirname(path), { recursive: true });
  const owner = {
    pid,
    token,
    startedAt: new Date(now()).toISOString(),
  };

  for (let attempt = 0; attempt < RECOVERY_RETRIES; attempt++) {
    const observed = await observeLock(path);
    if (observed === null) {
      if (await installPreparedLock(path, owner)) {
        break;
      }
      continue;
    }
    if (observed.owner !== null && isAlive(observed.owner.pid)) {
      throw new E2eLockError(
        `Another Mallok browser run owns .tmp/e2e.lock (PID ${observed.owner.pid}).`,
      );
    }
    if (observed.owner === null) {
      throw new E2eLockError(
        'The Mallok browser lock has no valid owner. Inspect and remove .tmp/e2e.lock manually only after confirming that no E2E wrapper is running.',
      );
    }
    if (
      !(await recoverObservedLock(path, observed, isAlive, afterQuarantine))
    ) {
      await wait(RECOVERY_RETRY_MS);
    }
  }

  const installed = await readOwner(path);
  if (installed?.token !== token) {
    throw new E2eLockError(
      'Could not acquire the Mallok browser lock after waiting for recovery.',
    );
  }

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    const current = await observeLock(path);
    if (current?.owner?.token === token) {
      const retired = `${path}.released-${token}-${randomUUID()}`;
      await rename(path, retired).catch((error) => {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      });
      const moved = await observeLock(retired);
      if (moved?.owner?.token === token) {
        await rm(retired, { recursive: true, force: true });
      }
    }
  };
}

const reuseInstruction =
  'MALLOK_E2E_REUSE=1 requires a live Mallok E2E wrapper. Start `node scripts/e2e-server.mjs` in another terminal, wait for port 8788, then run Playwright.';

/**
 * Refuses to attach Playwright to an arbitrary process on port 8788. The
 * manifest and lock token together prove that the live process was started by
 * this checkout's wrapper and that its private build inputs still exist.
 */
export async function assertReusableE2eRun({
  manifestPath = currentRunPath,
  expectedLockPath = lockPath,
  expectedRunsPath = runsPath,
  isAlive = processIsAlive,
} = {}) {
  let manifest;
  try {
    manifest = await readE2eRunManifest(manifestPath);
  } catch {
    throw new E2eLockError(reuseInstruction);
  }

  const expectedRunRoot = resolve(expectedRunsPath, manifest.runId);
  const expectedPaths = {
    runRoot: expectedRunRoot,
    sourceRoot: resolve(expectedRunRoot, 'source'),
    configPath: resolve(expectedRunRoot, 'config/wrangler.jsonc'),
    envPath: resolve(expectedRunRoot, 'config/.dev.vars'),
    statePath: resolve(expectedRunRoot, 'state'),
  };
  if (
    Object.entries(expectedPaths).some(
      ([key, value]) => resolve(manifest[key]) !== value,
    )
  ) {
    throw new E2eLockError(
      `${reuseInstruction} The existing run manifest points outside its private run directory.`,
    );
  }

  const current = await observeLock(expectedLockPath);
  if (
    current?.owner === null ||
    current?.owner?.token !== manifest.lockToken ||
    !isAlive(current.owner.pid)
  ) {
    throw new E2eLockError(
      `${reuseInstruction} The existing run has no live matching lock owner.`,
    );
  }

  try {
    await Promise.all([
      access(manifest.sourceRoot),
      access(manifest.configPath),
      access(manifest.envPath),
      access(resolve(manifest.sourceRoot, 'dist/pkg/cli/index.js')),
      access(resolve(manifest.sourceRoot, 'dist/assets')),
    ]);
  } catch {
    throw new E2eLockError(
      `${reuseInstruction} The existing run is missing its private source or build output.`,
    );
  }
  return manifest;
}

/** Runs one task while this checkout's browser-test resources are exclusive. */
export async function withE2eLock(task, options = {}) {
  const release = await acquireE2eLock(options.lockPath, options);
  try {
    return await task();
  } finally {
    await release();
  }
}

export class E2eInterrupted extends Error {
  constructor(signal) {
    super(`Interrupted by ${signal}`);
    this.name = 'E2eInterrupted';
    this.signal = signal;
  }
}

/**
 * Owns one direct child at a time. `run()` resolves only after that child has
 * exited, so callers may release the asset lock without leaving a Wrangler
 * grandchild behind on port 8788.
 */
export function createChildSupervisor({ cwd = repo, stdio = 'inherit' } = {}) {
  let child = null;
  let stopSignal = null;

  const assertRunning = () => {
    if (stopSignal !== null) {
      throw new E2eInterrupted(stopSignal);
    }
  };

  return {
    requestStop(signal) {
      stopSignal ??= signal;
      if (
        child !== null &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.kill(signal);
      }
    },

    assertRunning,

    async run(command, args, options = {}) {
      assertRunning();
      const running = spawn(command, args, {
        cwd: options.cwd ?? cwd,
        env: process.env,
        stdio,
      });
      child = running;

      const result = await new Promise((resolveResult, reject) => {
        running.once('error', reject);
        running.once('exit', (code, signal) => resolveResult({ code, signal }));
      }).finally(() => {
        if (child === running) {
          child = null;
        }
      });

      if (stopSignal !== null) {
        throw new E2eInterrupted(stopSignal);
      }
      if (result.code !== 0) {
        const detail = result.signal ?? `exit ${String(result.code)}`;
        throw new Error(`${command} ${args.join(' ')} failed (${detail}).`);
      }
    },
  };
}

const supervisor = createChildSupervisor();

/** The command Playwright's webServer owns for the duration of the suite. */
export async function runE2eServer() {
  const lockToken = randomUUID();
  await withE2eLock(
    async () => {
      // Every path below is private to this run. Other local gates may rebuild
      // the repository's root `dist/` while the browser is open without
      // deleting a chunk or CLI file that this Worker still needs.
      // Do not delete sibling runs here. On Windows, Playwright cannot deliver
      // the configured graceful signal and an abruptly killed wrapper can leave
      // a Wrangler child using its snapshot. A new UUID is isolated from it;
      // deleting all runs would instead pull files out from under that child.
      await mkdir(runsPath, { recursive: true });
      await rm(currentRunPath, { force: true });
      const runId = randomUUID();
      const runRoot = resolve(runsPath, runId);
      const sourceRoot = resolve(runRoot, 'source');
      const configRoot = resolve(runRoot, 'config');
      const statePath = resolve(runRoot, 'state');

      try {
        await createE2eSourceSnapshot(repo, sourceRoot);
        await supervisor.run(process.execPath, ['scripts/build-package.mjs'], {
          cwd: sourceRoot,
        });
        supervisor.assertRunning();
        const { configPath, envPath } = await writeE2eConfig(
          configRoot,
          sourceRoot,
        );
        const manifest = {
          schemaVersion: 1,
          lockToken,
          runId,
          runRoot,
          sourceRoot,
          configPath,
          envPath,
          statePath,
        };
        await writeFile(currentRunPath, `${JSON.stringify(manifest)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });

        await supervisor.run(
          process.execPath,
          [
            resolve(repo, 'node_modules/wrangler/bin/wrangler.js'),
            'dev',
            '--local',
            '-c',
            configPath,
            '--port',
            '8788',
            '--persist-to',
            statePath,
          ],
          { cwd: sourceRoot },
        );
      } finally {
        await rm(currentRunPath, { force: true });
        await rm(runRoot, { recursive: true, force: true });
      }
    },
    { token: lockToken },
  );
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (process.argv.includes('--require-running')) {
    process.stderr.write(`${reuseInstruction}\n`);
    process.exitCode = 1;
  } else {
    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
      process.once(signal, () => supervisor.requestStop(signal));
    }

    try {
      await runE2eServer();
    } catch (error) {
      if (error instanceof E2eInterrupted) {
        process.exitCode =
          error.signal === 'SIGHUP'
            ? 129
            : error.signal === 'SIGINT'
              ? 130
              : 143;
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `Mallok browser server did not start: ${detail}\n`,
        );
        process.exitCode = 1;
      }
    }
  }
}
