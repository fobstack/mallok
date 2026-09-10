/**
 * `mallok destroy` (docs/CLOUDFLARE_RESOURCES.md §10).
 *
 * It drives `wrangler` rather than the Cloudflare REST API, so the user's
 * existing OAuth login is the only credential involved and the CLI never
 * handles an account token (docs/CLI.md §4).
 *
 * Creation lives in `create.ts`. This file used to hold a `createSite` that
 * signed in, created a database and a bucket and only then tried to deploy;
 * it has been deleted rather than left unused, because the safe order is only
 * a guarantee if the unsafe one is not still in the package.
 */

import { spawn } from 'node:child_process';
import { CliError, EXIT } from './output.js';
import { resourceNames } from './registry.js';
import { hasProjectWrangler, projectWrangler } from './template.js';

/** Result of one wrangler invocation. */
interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the project's own Wrangler.
 *
 * Not `npx wrangler`: that resolves to whatever the registry currently
 * publishes, which for a command that deletes a Worker, a database and a
 * bucket is the wrong binary to be guessing at. The one in the project's
 * `node_modules` is the version its lockfile pinned and the version the
 * deploy was made with.
 */
export async function runWrangler(
  args: readonly string[],
  input?: string,
  projectDir: string = process.cwd(),
): Promise<RunResult> {
  if (!(await hasProjectWrangler(projectDir))) {
    throw new CliError(
      EXIT.user,
      'This directory has no Wrangler binary.',
      'Run `mallok destroy` from the project directory, after `pnpm install`.',
    );
  }
  return new Promise((resolve) => {
    const child = spawn(projectWrangler(projectDir), args, {
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** One step of a destroy run. */
export interface DestroyStep {
  readonly label: string;
  readonly args: readonly string[];
  /** Missing resources are fine; the run is idempotent. */
  readonly tolerateMissing: boolean;
}

/**
 * The delete order (docs/CLOUDFLARE_RESOURCES.md §10).
 *
 * The Worker is named by the project's own `wrangler.jsonc`, which is the
 * file `mallok create` edited and `wrangler deploy` read. There is no longer
 * a per-site `.mallok/sites/<slug>.jsonc` to point `-c` at.
 */
export function destroySteps(slug: string): DestroyStep[] {
  const names = resourceNames(slug);
  return [
    {
      label: `Delete the Worker ${names.worker}`,
      args: ['delete', names.worker],
      tolerateMissing: true,
    },
    {
      label: `Delete the database ${names.database}`,
      args: ['d1', 'delete', names.database, '--skip-confirmation'],
      tolerateMissing: true,
    },
    {
      label: `Delete the bucket ${names.bucket}`,
      args: ['r2', 'bucket', 'delete', names.bucket],
      tolerateMissing: true,
    },
  ];
}

/** Steps a person has to do themselves, printed at the end of a destroy. */
export const MANUAL_CLEANUP: readonly string[] = [
  'Delete the R2 custom domain (media.<your domain>) in the dashboard.',
  'Delete the Turnstile widget, if one was created.',
  'Delete the CF_API_TOKEN you created for cache purging.',
  'Remove any DNS records the setup wizard added.',
];
