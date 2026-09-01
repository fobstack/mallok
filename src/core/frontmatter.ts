/**
 * Splits a Markdown document into its YAML front matter and body.
 *
 * The original text is never rewritten: callers keep `source` as the stored
 * truth and use the parsed `data` only as a derived view. Parsing is
 * deliberately strict (no aliases, no custom tags, no duplicate keys) because
 * content is untrusted input.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** A parsed Markdown document. */
export interface SplitDocument {
  /** Raw YAML text between the delimiters, or `null` when absent. */
  readonly frontmatterText: string | null;
  /** Markdown body with the front matter block removed. */
  readonly body: string;
  /** Parsed front matter as a plain object; empty when absent. */
  readonly data: Readonly<Record<string, unknown>>;
}

/** Thrown when front matter is present but cannot be parsed. */
export class FrontmatterError extends Error {
  override readonly name = 'FrontmatterError';
}

const DELIMITER = /^---[ \t]*\r?\n/;
const CLOSING = /\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Splits `source` into front matter and body.
 *
 * A front matter block must start on the first line with `---` and end with a
 * line containing only `---`. Anything else is treated as body text.
 */
export function splitFrontmatter(source: string): SplitDocument {
  const open = DELIMITER.exec(source);
  if (open === null) {
    return { frontmatterText: null, body: source, data: {} };
  }

  const rest = source.slice(open[0].length);
  const close = CLOSING.exec(rest);
  if (close === null) {
    return { frontmatterText: null, body: source, data: {} };
  }

  const frontmatterText = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  return { frontmatterText, body, data: parseFrontmatter(frontmatterText) };
}

/**
 * Parses YAML front matter into a plain object.
 *
 * @throws {FrontmatterError} when the YAML is invalid or is not a mapping.
 */
export function parseFrontmatter(
  text: string,
): Readonly<Record<string, unknown>> {
  if (text.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text, {
      schema: 'core',
      uniqueKeys: true,
      // Zero disallows alias nodes entirely, closing the "billion laughs"
      // class of expansion attacks.
      maxAliasCount: 0,
      strict: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FrontmatterError(`Invalid front matter: ${message}`);
  }

  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FrontmatterError('Front matter must be a YAML mapping.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Rebuilds a document from front matter and a body.
 *
 * This is the one place the source text is rewritten, and it happens only
 * when a person edited a field — an import/export round trip must keep the
 * original bytes instead (docs/ADMIN.md §6.2). An empty map produces a
 * document with no front matter block at all rather than an empty one.
 */
export function joinFrontmatter(
  data: Readonly<Record<string, unknown>>,
  body: string,
): string {
  const entries = Object.entries(data).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return body;
  }
  const yaml = stringifyYaml(Object.fromEntries(entries), {
    lineWidth: 0,
    nullStr: '',
  });
  // Exactly one newline after the closing delimiter, because
  // `splitFrontmatter` consumes that one and returns the rest verbatim. The
  // blank line a conventional document has between the block and the body is
  // therefore carried in `body` itself, and the two functions are inverses.
  return `---\n${yaml.endsWith('\n') ? yaml : `${yaml}\n`}---\n${body}`;
}
