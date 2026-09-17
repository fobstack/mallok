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
  lastLine,
  verifiedWrangler,
} from './cloudflare.js';
import { assertInteractiveSecretDelivery, deliverSecret } from './deliver.js';
import { assertSameAccount, readLedger, writeLedger } from './ledger.js';
import { CliError, EXIT, type Reporter } from './output.js';
import { readRegistry } from './registry.js';
import { resourceNames } from './site-config.js';
import { hasProjectWrangler } from './template.js';

export interface SetupKeyOptions {
  readonly projectDir?: string;
  readonly accountId?: string | undefined;
  readonly run?: CommandRunner;
  /** Injected in tests; the default asks the site's public status endpoint. */
  readonly hasAdministrator?: (origin: string) => Promise<boolean | null>;
  /**
   * Hands the key to a person, and throws if it cannot.
   *
   * The same contract `mallok create` uses, from the same module: the ledger
   * records `setupKeyDeliveredAt` only **after** this returns. This command
   * used to return the key to its caller, which printed it afterwards and
   * then wrote the ledger separately — so an interruption in between left a
   * key on the Worker that nobody had, on a site the ledger believed was
   * finished.
   */
  readonly deliver?: (key: string) => Promise<void> | void;
}

export interface SetupKeyResult {
  readonly slug: string;
}

/** The default hand-over: stdout, awaited (`deliver.ts`). */
async function defaultDeliver(key: string): Promise<void> {
  await deliverSecret(process.stdout, 'MALLOK_SETUP_KEY', key);
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
  if (ledger === null && sites.length > 1) {
    throw new CliError(
      EXIT.user,
      'This project records more than one deployed site.',
      'Run setup-key from the generated site directory that contains its create ledger.',
    );
  }
  const slug = ledger?.slug ?? sites[0]?.slug;
  if (slug === undefined) {
    throw new CliError(
      EXIT.user,
      'This directory has no record of a deployed site.',
      'Run `mallok setup-key` from the project directory that created it.',
    );
  }
  const siteRecord = sites.find((site) => site.slug === slug);
  const origin = ledger?.origin ?? siteRecord?.origin ?? '';

  if (!(await hasProjectWrangler(projectDir))) {
    throw new CliError(
      EXIT.user,
      'The project has no Wrangler binary.',
      'Run the install inside the project and try again.',
    );
  }
  // A custom delivery sink is an explicit API choice (and is how tests avoid
  // printing credentials). The CLI default must prove stdout is a terminal
  // before it can rotate anything remotely.
  if (options.deliver === undefined) {
    assertInteractiveSecretDelivery(process.stdout);
  }

  const { wrangler, accountId, identity } = await verifiedWrangler(
    projectDir,
    runner,
    options.accountId,
  );
  const names = resourceNames(slug);
  if (identity.worker !== names.worker) {
    throw new CliError(
      EXIT.user,
      'wrangler.jsonc names a different Worker from this site record.',
      `Expected ${names.worker}; found ${identity.worker}. No secret has been changed.`,
    );
  }
  if (ledger !== null) {
    assertSameAccount(ledger, accountId);
  } else {
    // No ledger, so the registry is the only proof there is — and a record
    // without an account id proves nothing. Setting a setup key on a site
    // this project cannot show it owns is handing somebody a way in.
    const known = siteRecord?.accountId;
    if (typeof known !== 'string' || known.trim() === '') {
      throw new CliError(
        EXIT.user,
        `The registry entry for "${slug}" does not record which Cloudflare account it belongs to.`,
        `Refusing rather than setting a key on whatever answers to that name ` +
          `on account ${accountId}. Record it first: \`mallok repair ${slug}\`.`,
      );
    }
    if (known !== accountId) {
      throw new CliError(
        EXIT.user,
        `"${slug}" was provisioned on a different Cloudflare account.`,
        `The registry records ${known}; you are signed in to ${accountId}.`,
      );
    }
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
  const put = await wrangler.run(
    ['secret', 'put', 'MALLOK_SETUP_KEY', '--name', names.worker],
    { input: setupKey },
  );
  if (put.code !== 0) {
    throw new CliError(
      EXIT.remote,
      'Could not set MALLOK_SETUP_KEY.',
      lastLine(put.stderr, put.stdout),
    );
  }

  // Hand it over **before** recording that it was handed over. Everything
  // between those two points is a window in which the ledger would claim a
  // delivery that did not happen, and a resumed run would then decline to
  // rotate the key nobody has.
  await (options.deliver ?? defaultDeliver)(setupKey);

  if (ledger !== null) {
    await writeLedger(projectDir, {
      ...ledger,
      secrets: [...new Set([...(ledger.secrets ?? []), 'MALLOK_SETUP_KEY'])],
      setupKeyDeliveredAt: new Date().toISOString(),
    });
  }

  return { slug };
}
