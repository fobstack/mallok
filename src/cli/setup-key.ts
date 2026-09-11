/**
 * `mallok setup-key` — issue a new one-time key for a site nobody owns yet.
 *
 * The key `mallok create` prints exists once, in a terminal. It is never
 * written to the ledger, the registry or any file, because a credential in a
 * committed file is a credential that outlives its one use. The consequence
 * is that it can be lost: a closed terminal, a killed process, a scrolled-off
 * buffer.
 *
 * Without this command, losing it means a deployed site that cannot be set
 * up and cannot be recovered — Cloudflare never returns a secret's value.
 *
 * The rule that makes issuing a new one safe is simple, and it is checked
 * rather than assumed: **a setup key is only useful while the site has no
 * administrator.** Once somebody owns the site, the key is spent and this
 * command refuses; whoever is asking is either its owner, who should sign in,
 * or somebody who should not be here.
 */

import { webcrypto } from 'node:crypto';
import {
  type CommandRunner,
  currentAccountId,
  lastLine,
  wranglerFor,
} from './cloudflare.js';
import { assertSameAccount, readLedger, writeLedger } from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { readRegistry } from './registry.js';
import { hasProjectWrangler } from './template.js';

export interface SetupKeyOptions {
  readonly projectDir?: string;
  readonly accountId?: string | undefined;
  readonly run?: CommandRunner;
  /** Injected in tests; the default asks the site's public status endpoint. */
  readonly hasAdministrator?: (origin: string) => Promise<boolean | null>;
}

export interface SetupKeyResult {
  readonly slug: string;
  /** Printed once, to a terminal, and stored nowhere. */
  readonly setupKey: string;
}

/** Asks the deployed site whether it already has an administrator. */
async function askSite(origin: string): Promise<boolean | null> {
  if (origin === '') {
    return null;
  }
  try {
    const response = await fetch(`${origin}/_mallok/api/setup/status`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const status = (await response.json()) as { hasAdmin?: boolean };
    return typeof status.hasAdmin === 'boolean' ? status.hasAdmin : null;
  } catch {
    return null;
  }
}

/** Issues a new setup key for the site in this directory. */
export async function rotateSetupKey(
  options: SetupKeyOptions,
  report: Reporter,
): Promise<SetupKeyResult> {
  const projectDir = options.projectDir ?? process.cwd();
  const runner = options.run;
  if (runner === undefined) {
    throw new CliError(EXIT.user, 'No command runner was provided.');
  }

  const ledger = await readLedger(projectDir);
  const sites = await readRegistry(`${projectDir}/.mallok/sites.json`);
  const slug = ledger?.slug ?? sites[0]?.slug;
  if (slug === undefined) {
    throw new CliError(
      EXIT.user,
      'This directory has no record of a deployed site.',
      'Run `mallok setup-key` from the project directory that created it.',
    );
  }
  const origin = ledger?.origin ?? sites[0]?.origin ?? '';

  if (!(await hasProjectWrangler(projectDir))) {
    throw new CliError(
      EXIT.user,
      'The project has no Wrangler binary.',
      'Run the install inside the project and try again.',
    );
  }
  const wrangler = wranglerFor(projectDir, runner, options.accountId);
  const accountId = await currentAccountId(wrangler, options.accountId);
  if (ledger !== null) {
    assertSameAccount(ledger, accountId);
  }

  // The check that makes this safe. `null` means the site could not be asked,
  // and unknown is not the same as "no" — refusing is the only answer that
  // cannot hand a live site to a stranger.
  const claimed = await (options.hasAdministrator ?? askSite)(origin);
  if (claimed === true) {
    throw new CliError(
      EXIT.user,
      'This site already has an administrator, so a setup key would do nothing.',
      'Sign in at /_mallok/app/. If you have lost that password, reset it ' +
        'from the database — the setup key is not a way back in.',
    );
  }
  if (claimed === null) {
    throw new CliError(
      EXIT.remote,
      `Could not ask ${origin === '' ? 'the site' : origin} whether it already has an administrator.`,
      'Refusing rather than guessing: issuing a key for a site that is ' +
        'already owned would be a way in for whoever asked. Check the site is ' +
        'reachable and run this again.',
    );
  }

  const setupKey = Buffer.from(
    webcrypto.getRandomValues(new Uint8Array(32)),
  ).toString('base64');
  report.step('Setting a new MALLOK_SETUP_KEY…');
  const put = await wrangler.run(['secret', 'put', 'MALLOK_SETUP_KEY'], {
    input: setupKey,
  });
  if (put.code !== 0) {
    throw new CliError(
      EXIT.remote,
      'Could not set MALLOK_SETUP_KEY.',
      lastLine(put.stderr, put.stdout),
    );
  }

  if (ledger !== null) {
    await writeLedger(projectDir, {
      ...ledger,
      secrets: [...new Set([...(ledger.secrets ?? []), 'MALLOK_SETUP_KEY'])],
      setupKeyDeliveredAt: new Date().toISOString(),
    });
  }

  return { slug, setupKey };
}
