/**
 * Output and exit codes (docs/CLI.md §11, §12).
 *
 * Human progress goes to stderr and the machine-readable object to stdout,
 * so `mallok publish --json | jq` works while a person still sees progress.
 */

/** Exit codes, as the contract defines them. */
export const EXIT = {
  ok: 0,
  /** Bad arguments, missing files, validation failure. */
  user: 1,
  /** Invalid token or insufficient scope. */
  auth: 2,
  /** The site returned an error, or a quota is exhausted. */
  remote: 3,
  /** Some items in a batch succeeded and some did not. */
  partial: 4,
} as const;

/** An error carrying the exit code it should produce. */
export class CliError extends Error {
  readonly code: number;
  readonly hint: string | undefined;

  constructor(code: number, message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = hint;
  }
}

/** Whether stdout should carry a single JSON object instead of a table. */
export interface Reporter {
  readonly json: boolean;
  /** Progress for a person; never on stdout in `--json` mode. */
  readonly step: (message: string) => void;
  readonly warn: (message: string) => void;
  /** The final result. */
  readonly done: (summary: Record<string, unknown>, table: string) => void;
}

/** Builds the reporter for a run. */
export function makeReporter(json: boolean, quiet = false): Reporter {
  return {
    json,
    step: (message) => {
      if (!quiet) {
        process.stderr.write(`${message}\n`);
      }
    },
    warn: (message) => {
      process.stderr.write(`! ${message}\n`);
    },
    done: (summary, table) => {
      if (json) {
        process.stdout.write(`${JSON.stringify(summary)}\n`);
        return;
      }
      process.stdout.write(table.endsWith('\n') ? table : `${table}\n`);
    },
  };
}

/**
 * Turns a thrown value into a message and exit code.
 *
 * Errors never carry SQL, bucket names or stack traces to the terminal
 * (docs/CLI.md §12); a `CliError` already has the wording chosen for a
 * person, and anything else is reported as an unexpected failure.
 */
export function reportFailure(error: unknown): number {
  if (error instanceof CliError) {
    process.stderr.write(`Error: ${error.message}\n`);
    if (error.hint !== undefined) {
      process.stderr.write(`  ${error.hint}\n`);
    }
    return error.code;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  return EXIT.remote;
}

/** Renders a simple aligned table. */
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  if (rows.length === 0) {
    return '';
  }
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}
