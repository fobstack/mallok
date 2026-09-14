import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A project shell just complete enough for `create` to act on.
 *
 * Deliberately not the real one: these tests are about the state machine, and
 * copying the real shell would make every case depend on the real shell's
 * contents. `test/cli/package-release.test.ts` is where the real one is
 * generated, installed and built for real.
 *
 * It carries the same `wrangler.jsonc` *shape*, because the configuration
 * writer edits that file and the tests assert on what it produced.
 */
export async function writeFakeTemplate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mallok-template-'));
  const files: Record<string, string> = {
    'package.json': JSON.stringify(
      {
        name: 'mallok-site',
        private: true,
        type: 'module',
        scripts: { build: 'echo built' },
        dependencies: { mallok: '0.0.0-test' },
      },
      null,
      2,
    ),
    'wrangler.jsonc': `{
  // A comment, so the JSONC path is exercised.
  "name": "mallok-site",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-08-01",
  "assets": { "directory": "./dist/assets", "binding": "ASSETS" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mallok-site-db",
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "mallok-site-media" }],
  "ratelimits": [
    {
      "name": "RATE_LIMITER",
      "namespace_id": "1000",
      "simple": { "limit": 10, "period": 60 }
    }
  ],
  "vars": {
    "MALLOK_SITE": "site",
    "MALLOK_DOMAIN": ""
  },
  "triggers": { "crons": ["* * * * *"] }
}
`,
    'tsconfig.json': '{}',
    'site.json': '{"defaultLocale":"en","locales":["en"]}',
    'src/worker/index.ts': 'export default {};\n',
    'scripts/smoke.mjs': 'process.exit(0);\n',
    'test/project.test.ts': 'export {};\n',
    gitignore: 'node_modules/\n',
  };
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, 'utf8');
  }
  return root;
}
