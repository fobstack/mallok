/**
 * Argument parsing (docs/CLI.md §3).
 *
 * Hand-written rather than a parser library: the surface is seven commands
 * and a dozen flags, and a dependency here would ship to every user of the
 * published package.
 */

import { CliError, EXIT } from './output.js';

/** One parsed invocation. */
export interface ParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const BOOLEAN_FLAGS = new Set([
  'json',
  'dry-run',
  'verbose',
  'draft',
  'create-only',
  'fail-on-missing',
  'with-settings',
  'help',
  'version',
]);

/** Parses `argv` (without node and the script path). */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    if (token === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split('=', 2);
      const key = name ?? '';
      if (inline !== undefined) {
        flags[key] = inline;
        continue;
      }
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new CliError(EXIT.user, `--${key} needs a value.`);
      }
      flags[key] = next;
      index++;
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      // Only the documented short flags exist.
      if (token === '-v') {
        flags.verbose = true;
        continue;
      }
      if (token === '-h') {
        flags.help = true;
        continue;
      }
      throw new CliError(EXIT.user, `Unknown option "${token}".`);
    }
    positional.push(token);
  }

  const [command = '', ...rest] = positional;
  return { command, positional: rest, flags };
}

/** Reads a string flag, or undefined. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

/** Reads a boolean flag. */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

/**
 * Resolves which site to talk to (docs/CLI.md §3).
 *
 * `--url` wins; otherwise the registry is consulted, and an ambiguous
 * registry is an error rather than a guess.
 */
export function resolveOrigin(
  args: ParsedArgs,
  registry: Readonly<Record<string, { origin: string }>>,
): string {
  const url = stringFlag(args, 'url');
  if (url !== undefined) {
    return url;
  }
  const slug = stringFlag(args, 'site');
  if (slug !== undefined) {
    const entry = registry[slug];
    if (entry === undefined) {
      throw new CliError(
        EXIT.user,
        `No site named "${slug}" in .mallok/sites.json.`,
        `Known sites: ${Object.keys(registry).join(', ') || 'none'}.`,
      );
    }
    return entry.origin;
  }
  const names = Object.keys(registry);
  if (names.length === 1) {
    return registry[names[0] ?? '']?.origin ?? '';
  }
  if (names.length === 0) {
    throw new CliError(
      EXIT.user,
      'No site specified.',
      'Pass --url https://example.com, or run this from a directory with .mallok/sites.json.',
    );
  }
  throw new CliError(
    EXIT.user,
    'More than one site is registered, so --site is required.',
    `Known sites: ${names.join(', ')}.`,
  );
}

/** Reads the API token (docs/CLI.md §4). It is never written to a file. */
export function resolveToken(args: ParsedArgs, env: NodeJS.ProcessEnv): string {
  const token = stringFlag(args, 'token') ?? env.MALLOK_TOKEN;
  if (token === undefined || token === '') {
    throw new CliError(
      EXIT.auth,
      'No API token.',
      'Set MALLOK_TOKEN, or pass --token. Create one in the admin under Account.',
    );
  }
  return token;
}
