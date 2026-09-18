/**
 * A real request to a real Worker.
 *
 * Starts `wrangler dev` with local D1 and R2, waits for it, and asks for the
 * two things that prove the deployment is wired up rather than merely
 * compiled: the setup endpoint (which means the Worker booted, ran its schema
 * migration and reached the database) and the public site (which means the
 * theme rendered).
 *
 * It is a separate command from `test` because it needs a workerd process and
 * a free port; a unit test suite that quietly starts servers is a unit test
 * suite that fails on someone else's laptop.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** An OS-assigned free port, so two runs cannot collide. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const port = await freePort();
// Throwaway state, so a smoke run never sees yesterday's database.
const state = await mkdtemp(join(tmpdir(), 'mallok-smoke-'));
const processGroup = process.platform !== 'win32';
const child = spawn(
  process.execPath,
  [
    join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js'),
    'dev',
    '--local',
    '--port',
    String(port),
    '--persist-to',
    state,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: processGroup },
);
let launchError = null;
child.on('error', (error) => {
  launchError = error;
});
const closed = new Promise((resolve) => child.once('close', resolve));

async function stop() {
  if (child.pid === undefined) return;
  if (!processGroup) {
    // Windows has no POSIX process groups; /T includes Wrangler's workerd.
    if (child.exitCode === null) {
      await promisify(execFile)('taskkill', [
        '/pid',
        String(child.pid),
        '/T',
        '/F',
      ]);
    }
  } else {
    const signal = (name) => {
      try {
        process.kill(-child.pid, name);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    // Killing only the launcher leaves inherited pipes open in descendants.
    signal('SIGTERM');
    const force = setTimeout(() => signal('SIGKILL'), 2_000);
    try {
      await closed;
    } finally {
      clearTimeout(force);
    }
  }
  await closed;
}

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 120_000;
let failure = null;

try {
  // Wait for the Worker to answer at all.
  for (;;) {
    if (launchError !== null) throw launchError;
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited with ${child.exitCode}\n${output}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`wrangler dev did not start in time\n${output}`);
    }
    try {
      const probe = await fetch(`${base}/_mallok/api/setup/status`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (probe.ok) {
        const status = await probe.json();
        if (typeof status.completed !== 'boolean') {
          throw new Error(`unexpected setup status: ${JSON.stringify(status)}`);
        }
        break;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }

  // The public site. Before the wizard runs there is no content, so what is
  // being asserted is that the Worker answered and did not fail.
  const home = await fetch(base, { signal: AbortSignal.timeout(10_000) });
  if (home.status >= 500) {
    throw new Error(`GET / returned ${home.status}\n${output}`);
  }

  // The admin shell is a static asset; a 200 here means `mallok prepare`
  // staged the app into dist/assets and Wrangler is serving it.
  const app = await fetch(`${base}/_mallok/app/`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!app.ok) {
    throw new Error(
      `GET /_mallok/app/ returned ${app.status} — run \`npm run build\` first\n${output}`,
    );
  }

  process.stdout.write(
    `smoke: ok (setup status, GET /, admin shell) on ${base}\n`,
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await stop();
  } finally {
    await rm(state, { recursive: true, force: true });
  }
}

if (failure !== null) {
  process.stderr.write(`smoke: FAILED — ${failure.message}\n`);
  process.exitCode = 1;
}
