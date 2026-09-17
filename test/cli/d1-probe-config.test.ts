import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { findDatabase, wranglerFor } from '../../src/cli/cloudflare.js';

it.each(['00000000-0000-0000-0000-000000000000', 'stale-remote-id'])(
  'looks up the remote name instead of trusting binding UUID %s',
  async (id) => {
    const directory = await mkdtemp(join(tmpdir(), 'mallok-probe-test-'));
    const original = JSON.stringify({
      account_id: 'account-a',
      d1_databases: [
        { binding: 'DB', database_name: 'mallok-test-db', database_id: id },
      ],
    });
    let probePath = '';
    try {
      await writeFile(join(directory, 'wrangler.jsonc'), original);
      const wrangler = wranglerFor(
        directory,
        async (_binary, args, options) => {
          const configIndex = args.indexOf('--config');
          expect(configIndex).toBeGreaterThan(-1);
          probePath = args[configIndex + 1] ?? '';
          const config = JSON.parse(await readFile(probePath, 'utf8'));
          expect(config.account_id).toBe('account-a');
          expect(options.env?.CLOUDFLARE_ACCOUNT_ID).toBe('account-a');
          expect(config.d1_databases).toEqual([
            { binding: 'DB', database_name: 'mallok-test-db' },
          ]);
          return {
            code: 0,
            stdout: JSON.stringify({ uuid: 'actual-remote-id' }),
            stderr: '',
          };
        },
        'account-a',
      );
      await expect(findDatabase(wrangler, 'mallok-test-db')).resolves.toEqual({
        exists: true,
        id: 'actual-remote-id',
      });
      expect(await readFile(join(directory, 'wrangler.jsonc'), 'utf8')).toBe(
        original,
      );
      await expect(access(probePath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
