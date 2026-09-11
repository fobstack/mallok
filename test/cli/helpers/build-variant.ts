import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Builds a **second, genuinely different** Mallok package.
 *
 * The upgrade test needs two releases where the newer one carries a project
 * migration the older one has never heard of. Producing those by copying one
 * tarball and editing its `package.json` would test nothing: the migration
 * has to exist in the target's *code*, because the whole point is that the
 * target version runs its own migrations rather than the old CLI running
 * whatever it happened to be compiled with.
 *
 * So this copies the repository's source into a temporary tree, patches
 * `src/cli/upgrade.ts` to declare a migration, and runs the real build there.
 * `node_modules` is symlinked rather than installed: the dependencies are the
 * same ones, and installing them again would add minutes for nothing.
 */
export interface Variant {
  readonly root: string;
  readonly tarball: string;
  readonly version: string;
}

const SOURCES = [
  'src',
  'scripts',
  'template',
  'content',
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.types.json',
  'vite.config.ts',
  'text-modules.d.ts',
  'site.json',
  'biome.json',
  'LICENSE',
  'NOTICE',
];

/**
 * A project migration the target package will carry.
 *
 * It writes a file, which is what makes "did the target's migration actually
 * run?" answerable by looking at the project rather than at a log line.
 */
const FIXTURE_MIGRATION = `
  {
    id: '2026-09-12-target-owned',
    description: 'a migration that only the target release knows about',
    apply: async (projectDir) => {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await writeFile(
        join(projectDir, 'migrated-by-target.txt'),
        'written by the migration the target release carries\\n',
        'utf8',
      );
      return true;
    },
  },
`;

/** Builds a package at `version`, optionally carrying the fixture migration. */
export async function buildVariant(
  version: string,
  options: { readonly withMigration: boolean },
): Promise<Variant> {
  const repo = process.cwd();
  const root = await mkdtemp(join(tmpdir(), `mallok-variant-${version}-`));

  for (const entry of SOURCES) {
    await cp(join(repo, entry), join(root, entry), { recursive: true });
  }
  await symlink(join(repo, 'node_modules'), join(root, 'node_modules'));

  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >;
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, version }, null, 2)}\n`,
    'utf8',
  );

  if (options.withMigration) {
    const upgradePath = join(root, 'src/cli/upgrade.ts');
    const source = await readFile(upgradePath, 'utf8');
    const anchor =
      'export const PROJECT_MIGRATIONS: readonly ProjectMigration[] = [';
    if (!source.includes(anchor)) {
      throw new Error('the migration list moved; build-variant needs updating');
    }
    await writeFile(
      upgradePath,
      source.replace(anchor, anchor + FIXTURE_MIGRATION),
      'utf8',
    );
  }

  await run('node', ['scripts/build-package.mjs'], {
    cwd: root,
    maxBuffer: 1 << 26,
  });
  const { stdout } = await run('npm', ['pack', '--json'], {
    cwd: join(root, 'dist/pkg'),
    maxBuffer: 1 << 24,
  });
  const [entry] = JSON.parse(stdout) as { filename: string }[];
  return {
    root,
    version,
    tarball: join(root, 'dist/pkg', entry?.filename ?? ''),
  };
}
