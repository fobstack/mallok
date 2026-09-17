import { execFile } from 'node:child_process';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
let output = '';
let sandbox = '';
let candidate = '';

async function run(
  script: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [script, ...args],
      { cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'mallok-candidate-'));
  output = join(sandbox, 'release');
  const packed = await run('scripts/pack-candidate.mjs', ['dist/pkg', output]);
  expect(packed.code, packed.stdout + packed.stderr).toBe(0);
  const record = JSON.parse(await readFile(join(output, 'pack.json'), 'utf8'));
  candidate = join(output, record.filename);
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('the immutable release candidate', () => {
  it('records and verifies npm plus independent digests', async () => {
    const record = JSON.parse(
      await readFile(join(output, 'pack.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(record.filename).toMatch(/^mallok-.+\.tgz$/);
    expect(record.size).toEqual(expect.any(Number));
    expect(record.size).toBeGreaterThan(0);
    expect(record.unpackedSize).toEqual(expect.any(Number));
    expect(record.unpackedSize).toBeGreaterThan(0);
    expect(record.integrity).toMatch(/^sha512-/);
    expect(record.shasum).toMatch(/^[a-f0-9]{40}$/);
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.sourceCommit).toMatch(/^[a-f0-9]{40,64}$/);

    const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD']);
    expect(record.sourceCommit).toBe(head.trim());

    const verified = await run('scripts/verify-candidate.mjs', [candidate]);
    expect(verified.code, verified.stdout + verified.stderr).toBe(0);
  });

  it('refuses to pack over the selected candidate', async () => {
    const second = await run('scripts/pack-candidate.mjs', [
      'dist/pkg',
      output,
    ]);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain('packed once');
  });

  it('refuses to select a candidate from a dirty source checkout', async () => {
    const source = join(sandbox, 'dirty-source');
    const packageDir = join(source, 'package');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, 'package.json'),
      `${JSON.stringify({ name: 'mallok', version: '0.0.0-test' })}\n`,
    );
    await execFileAsync('git', ['init', '--quiet'], { cwd: source });
    await execFileAsync('git', ['config', 'user.email', 'test@example.test'], {
      cwd: source,
    });
    await execFileAsync('git', ['config', 'user.name', 'Mallok test'], {
      cwd: source,
    });
    await execFileAsync('git', ['add', '.'], { cwd: source });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
      cwd: source,
    });
    await writeFile(join(source, 'untracked.txt'), 'not reviewed\n');

    let error: unknown;
    try {
      await execFileAsync(
        process.execPath,
        [
          join(process.cwd(), 'scripts/pack-candidate.mjs'),
          packageDir,
          join(source, 'release'),
        ],
        { cwd: source },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      stderr: expect.stringMatching(/dirty Git worktree/i),
    });
  });

  it('detects a candidate changed after packing', async () => {
    await appendFile(candidate, 'changed');
    const verified = await run('scripts/verify-candidate.mjs', [candidate]);
    expect(verified.code).not.toBe(0);
    expect(verified.stderr).toContain('changed');
  });

  it('makes the release workflow test the exact file it uploads', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8');
    const packedAt = workflow.indexOf('pnpm release:pack');
    const quarantinedAt = workflow.indexOf(
      'mv dist/pkg dist/package-staging-not-used',
    );
    const testedAt = workflow.indexOf('MALLOK_CANDIDATE_TARBALL=');
    const verifiedAt = workflow.indexOf('scripts/verify-candidate.mjs');
    const uploadedAt = workflow.indexOf('dist/release/*.tgz');

    expect(packedAt).toBeGreaterThan(0);
    expect(quarantinedAt).toBeGreaterThan(packedAt);
    expect(testedAt).toBeGreaterThan(quarantinedAt);
    expect(verifiedAt).toBeGreaterThan(testedAt);
    expect(uploadedAt).toBeGreaterThan(verifiedAt);

    const afterPacking = workflow.slice(packedAt + 'pnpm release:pack'.length);
    expect(afterPacking).not.toContain('pnpm build:package');
    expect(afterPacking).not.toContain('pnpm build:site');
    expect(afterPacking).not.toContain('npm pack');

    const setup = await readFile('test/cli/helpers/build-package.ts', 'utf8');
    expect(setup).toContain('MALLOK_CANDIDATE_TARBALL');
    expect(setup.indexOf('MALLOK_CANDIDATE_TARBALL')).toBeLessThan(
      setup.indexOf("run('node', ['scripts/build-package.mjs']"),
    );
  });
});
