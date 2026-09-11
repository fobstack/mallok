/**
 * Which package manager a generated project uses.
 *
 * Until 0.1.0-rc.3 the answer was "pnpm", assumed to be installed globally.
 * On a machine with only Node — which is what the documentation asks for —
 * `mallok create` failed at its first step with `pnpm: not found`, after
 * generating the project and before verifying anything.
 *
 * The supported managers are **npm** and **pnpm**. npm is the default because
 * it ships with Node, so the documented prerequisite ("Node 22") is genuinely
 * enough. pnpm is chosen with `--package-manager pnpm`, or automatically when
 * the CLI is itself being run by pnpm.
 */

import { CliError, EXIT } from './output.js';

/** The managers a generated project can be built with. */
export const PACKAGE_MANAGERS = ['npm', 'pnpm'] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** The lockfile each one writes, used to check an install actually ran. */
export const LOCKFILES: Readonly<Record<PackageManager, string>> = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
};

/** Validates an explicit choice. */
export function parsePackageManager(value: string): PackageManager {
  const found = PACKAGE_MANAGERS.find((name) => name === value);
  if (found === undefined) {
    throw new CliError(
      EXIT.user,
      `"${value}" is not a supported package manager.`,
      `Supported: ${PACKAGE_MANAGERS.join(', ')}.`,
    );
  }
  return found;
}

/**
 * The manager to use: the flag, else the one running this process, else npm.
 *
 * `npm_config_user_agent` is set by every manager that runs a script or a
 * binary, so `pnpm dlx mallok create` keeps using pnpm without being told.
 */
export function resolvePackageManager(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  if (explicit !== undefined) {
    return parsePackageManager(explicit);
  }
  const agent = env.npm_config_user_agent ?? '';
  const name = agent.split('/')[0] ?? '';
  const found = PACKAGE_MANAGERS.find((candidate) => candidate === name);
  return found ?? 'npm';
}

/** The arguments that install a project's dependencies for the first time. */
export function installArgs(manager: PackageManager): string[] {
  // Not a frozen install: a generated project has no lockfile yet. The
  // install is what writes one, and the lockfile is then checked into the
  // site's repository as the record of what it was verified against.
  return manager === 'npm' ? ['install'] : ['install'];
}

/** The arguments that reinstall from an existing lockfile, changing nothing. */
export function frozenInstallArgs(manager: PackageManager): string[] {
  return manager === 'npm' ? ['ci'] : ['install', '--frozen-lockfile'];
}

/** The arguments that run one of the project's own scripts. */
export function runArgs(manager: PackageManager, script: string): string[] {
  return manager === 'npm' ? ['run', script] : ['run', script];
}
