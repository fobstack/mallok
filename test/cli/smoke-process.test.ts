import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const run = promisify(execFile);

it.each([200, 503])(
  'closes the launcher and HTTP child after a %i public response',
  async (status) => {
    const directory = await mkdtemp(join(tmpdir(), 'mallok-smoke-process-'));
    try {
      await mkdir(join(directory, 'node_modules/wrangler/bin'), {
        recursive: true,
      });
      await mkdir(join(directory, 'node_modules/.bin'), { recursive: true });
      await copyFile(
        'template/scripts/smoke.mjs',
        join(directory, 'smoke.mjs'),
      );
      // Model Wrangler's launcher: its HTTP child inherits the output pipes.
      // The old npx + child.kill() path printed success but never exited.
      await writeFile(
        join(directory, 'node_modules/.bin/wrangler'),
        '#!/usr/bin/env node\nrequire("../wrangler/bin/wrangler.js");',
        { mode: 0o755 },
      );
      await writeFile(
        join(directory, 'node_modules/wrangler/bin/wrangler.js'),
        `const {spawn}=require('node:child_process');
const port=process.argv[process.argv.indexOf('--port')+1];
const server="require('node:http').createServer((q,s)=>{s.statusCode=q.url==='/'?${status}:200;s.setHeader('content-type','application/json');s.end(JSON.stringify({completed:false}));}).listen("+port+",'127.0.0.1')";
const child=spawn(process.execPath,['-e',server],{stdio:'inherit'});
require('node:fs').writeFileSync('child.pid',String(child.pid));
require('node:fs').writeFileSync('server.port',port);
setInterval(()=>{},1000);`,
      );
      const result = await run(process.execPath, ['smoke.mjs'], {
        cwd: directory,
        timeout: 10_000,
      }).then(
        ({ stdout, stderr }) => ({ code: 0, killed: false, stdout, stderr }),
        (error) => ({
          code: error.code,
          killed: error.killed,
          stdout: error.stdout,
          stderr: error.stderr,
        }),
      );
      expect(result.killed).toBe(false);
      expect(result.code).toBe(status === 200 ? 0 : 1);
      expect(status === 200 ? result.stdout : result.stderr).toContain(
        status === 200 ? 'smoke: ok' : 'GET / returned 503',
      );
      const port = await readFile(join(directory, 'server.port'), 'utf8');
      await expect(
        fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(1_000),
        }),
      ).rejects.toThrow();
    } finally {
      // Also clean up when testing the old, broken implementation.
      try {
        process.kill(
          Number(await readFile(join(directory, 'child.pid'), 'utf8')),
          'SIGKILL',
        );
      } catch {
        // The fixed script already stopped it.
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000,
);
