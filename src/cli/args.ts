/**
 * Argument parsing (docs/CLI.md §3).
 *
 * Hand-written rather than a parser library: the surface is nine commands and
 * a dozen flags, and a dependency here would ship to every user of the
 * published package.
 *
 * Two rules this file exists to enforce, both learned the expensive way:
 *
 * 1. **Every flag is declared per command, and an undeclared one fails.**
 *    A misspelling used to be accepted and ignored, so `mallok create site
 *    --no-deply` provisioned a real database and a real bucket while the user
 *    believed they had asked it not to.
 * 2. **A boolean flag is a boolean.** `--dry-run=true` parsed as the *string*
 *    `"true"`, and every `=== true` check downstream read it as false, so the
 *    most explicit way a person can ask for a dry run was the one way that
 *    deployed. Boolean flags now accept `--flag`, `--flag=true` and
 *    `--flag=false`, and reject anything else rather than guessing.
 */

import { CliError, EXIT } from './output.js';

/** One parsed invocation. */
export interface ParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

/** What one command accepts. */
interface CommandSpec {
  readonly booleans: readonly string[];
  readonly values: readonly string[];
  /** How many positional arguments, and what to call them in an error. */
  readonly positional: { readonly max: number; readonly what: string };
}

/** Accepted everywhere, because they say how to run rather than what to do. */
const GLOBAL_BOOLEANS = ['help', 'json', 'verbose', 'version'] as const;

/**
 * The flag whitelist, by command.
 *
 * A flag absent from a command's list is an error for that command even when
 * another command accepts it: `mallok publish --slug x` is a mistake worth
 * reporting, not a value worth ignoring.
 */
const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  publish: {
    booleans: [
      'draft',
      'create-only',
      'dry-run',
      'fail-on-missing',
      'with-settings',
    ],
    values: ['site', 'url', 'token', 'kind'],
    positional: { max: 1, what: 'one directory' },
  },
  import: {
    booleans: [
      'draft',
      'create-only',
      'dry-run',
      'fail-on-missing',
      'with-settings',
    ],
    values: ['site', 'url', 'token', 'kind'],
    positional: { max: 1, what: 'one directory' },
  },
  export: {
    booleans: [],
    values: ['site', 'url', 'token'],
    positional: { max: 1, what: 'one directory' },
  },
  preview: {
    booleans: [],
    values: ['theme', 'out', 'kind'],
    positional: { max: 1, what: 'one directory' },
  },
  build: {
    booleans: [],
    values: ['theme', 'out', 'origin', 'kind'],
    positional: { max: 1, what: 'one directory' },
  },
  media: {
    booleans: ['dry-run'],
    values: ['site', 'url', 'token'],
    // `push` plus a directory.
    positional: { max: 2, what: 'a subcommand and one directory' },
  },
  create: {
    booleans: ['dry-run', 'no-deploy'],
    values: ['slug', 'domain', 'account-id'],
    positional: { max: 1, what: 'one directory' },
  },
  destroy: {
    booleans: ['dry-run'],
    values: ['confirm', 'account-id'],
    positional: { max: 1, what: 'one site slug' },
  },
  upgrade: {
    booleans: ['dry-run', 'skip-checks'],
    values: ['to'],
    positional: { max: 0, what: 'no arguments' },
  },
  /*
   * Run by an older CLI, inside a copy of a project, after it has installed
   * this version. Not a command anybody types — but a real one, with a
   * documented protocol, because the alternative is an old binary guessing
   * what a new release needs.
   */
  'upgrade-finalize': {
    booleans: ['skip-checks'],
    values: ['from', 'to'],
    positional: { max: 0, what: 'no arguments' },
  },
  'setup-key': {
    booleans: [],
    values: ['account-id'],
    positional: { max: 0, what: 'no arguments' },
  },
  prepare: {
    booleans: [],
    values: [],
    positional: { max: 0, what: 'no arguments' },
  },
};

/** Commands, for the dispatcher and for error messages. */
export const COMMAND_NAMES: readonly string[] = Object.keys(COMMANDS);

/** Whether a command declares a flag as a boolean. */
function isBoolean(command: string, name: string): boolean {
  if ((GLOBAL_BOOLEANS as readonly string[]).includes(name)) {
    return true;
  }
  return COMMANDS[command]?.booleans.includes(name) ?? false;
}

/** Whether a command accepts a flag at all. */
function isKnown(command: string, name: string): boolean {
  if ((GLOBAL_BOOLEANS as readonly string[]).includes(name)) {
    return true;
  }
  const spec = COMMANDS[command];
  if (spec === undefined) {
    return false;
  }
  return spec.booleans.includes(name) || spec.values.includes(name);
}

/**
 * Turns `--flag=<value>` into a boolean.
 *
 * Only `true` and `false` are accepted. `--dry-run=yes` is refused rather than
 * interpreted, because the cost of guessing wrong is a deployment.
 */
function parseBooleanValue(name: string, value: string): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new CliError(
    EXIT.user,
    `--${name} is a switch; "${value}" is not true or false.`,
    `Write --${name}, --${name}=true or --${name}=false.`,
  );
}

/** Suggests the closest known flag, when there is an obvious one. */
function nearest(command: string, name: string): string | undefined {
  const spec = COMMANDS[command];
  const candidates = [
    ...GLOBAL_BOOLEANS,
    ...(spec?.booleans ?? []),
    ...(spec?.values ?? []),
  ];
  return candidates.find(
    (candidate) =>
      candidate.startsWith(name.slice(0, 3)) ||
      candidate.replace(/-/g, '') === name.replace(/-/g, ''),
  );
}

/**
 * Parses `argv` (without node and the script path).
 *
 * The command is read first, because which flags are legal depends on it.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  // The command is the first token that is not a flag or a flag's value. It
  // has to be found before the loop, since the loop's rules depend on it.
  const command = findCommand(argv);

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    if (token === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const [rawName, inline] = splitFlag(token.slice(2));
      const name = rawName;
      if (name === '') {
        throw new CliError(EXIT.user, `"${token}" is not a valid option.`);
      }
      if (!isKnown(command, name)) {
        const suggestion = nearest(command, name);
        throw new CliError(
          EXIT.user,
          command === ''
            ? `Unknown option "--${name}".`
            : `mallok ${command} has no option "--${name}".`,
          suggestion === undefined
            ? 'Run `mallok --help` for the options each command takes.'
            : `Did you mean --${suggestion}?`,
        );
      }
      if (isBoolean(command, name)) {
        flags[name] =
          inline === undefined ? true : parseBooleanValue(name, inline);
        continue;
      }
      if (inline !== undefined) {
        flags[name] = inline;
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new CliError(EXIT.user, `--${name} needs a value.`);
      }
      flags[name] = next;
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

  const [, ...rest] = positional;

  /*
   * A stray positional is an error, not something to ignore.
   *
   * `mallok destroy acme --confirm acme extra` used to delete a site while
   * its user believed they had typed something the tool would refuse. There
   * is no reading of an unexpected argument that is safer than stopping.
   */
  const spec = COMMANDS[command];
  if (spec !== undefined && rest.length > spec.positional.max) {
    const extra = rest.slice(spec.positional.max);
    throw new CliError(
      EXIT.user,
      spec.positional.max === 0
        ? `mallok ${command} takes no arguments, but was given ${extra.map((value) => `"${value}"`).join(', ')}.`
        : `mallok ${command} takes ${spec.positional.what}, but was also given ${extra.map((value) => `"${value}"`).join(', ')}.`,
      'Quote an argument that contains spaces.',
    );
  }

  return { command, positional: rest, flags };
}

/** Splits `name=value`, keeping a `=` inside the value. */
function splitFlag(token: string): [string, string | undefined] {
  const equals = token.indexOf('=');
  if (equals === -1) {
    return [token, undefined];
  }
  return [token.slice(0, equals), token.slice(equals + 1)];
}

/**
 * Finds the command without knowing yet which flags take values.
 *
 * A value-taking flag consumes the next token, so this has to skip it — but
 * whether it takes a value is exactly what depends on the command. The knot is
 * cut by looking only at the *global* shape: the first bare token that is not
 * preceded by an unknown `--flag` is the command. In practice the command
 * comes first or directly after global switches, which is what this accepts.
 */
function findCommand(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    if (token === '--') {
      return argv[index + 1] ?? '';
    }
    if (!token.startsWith('-')) {
      return token;
    }
    // A global switch never takes a value, so nothing is skipped for it.
    // Anything else here precedes the command and is validated later.
  }
  return '';
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
