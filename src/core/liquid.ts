/**
 * Stage two of the rendering pipeline: the restricted Liquid engine.
 *
 * Every `{{ output }}` is HTML-escaped unless the value is a {@link SafeHtml}
 * produced by core (e.g. the sanitized fragment). Templates can only reference
 * files of their own theme because the engine is backed by an in-memory map
 * rather than a file system. Themes are half-trusted: they can emit HTML but
 * cannot run code, read files or reach the network.
 */

import { Liquid, type Template } from 'liquidjs';
import type { ThemeFiles, ThemeManifest } from './theme.js';

/** HTML that core has already sanitized or generated and may be output raw. */
export class SafeHtml {
  constructor(readonly html: string) {}

  toString(): string {
    return this.html;
  }
}

/** A theme whose templates are parsed on demand and cached. */
export interface CompiledTheme {
  readonly manifest: ThemeManifest;
  readonly files: ThemeFiles;
  /** Cache-busting revision of the installed theme (`theme.rev`). */
  readonly rev: number;
  /**
   * Renders the template at `path` (e.g. `layouts/article.liquid`) with the
   * given view. The view is exposed both as the scope and as globals so that
   * `{% render %}` partials can read it too.
   */
  render(path: string, view: object): Promise<string>;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function escapeOutput(value: unknown): string {
  if (value instanceof SafeHtml) {
    return value.html;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return escapeHtml(String(value));
}

/** Builds a {@link CompiledTheme} from an installed theme's files. */
export function compileTheme(
  manifest: ThemeManifest,
  files: ThemeFiles,
  rev: number,
): CompiledTheme {
  const templates: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith('.liquid')) {
      templates[path] = text;
    }
  }

  const engine = new Liquid({
    templates,
    extname: '.liquid',
    cache: true,
    strictFilters: true,
    strictVariables: false,
    ownPropertyOnly: true,
    jsTruthy: false,
    // Fixed timezone and locale keep the `date` filter deterministic.
    timezoneOffset: 0,
    locale: 'en-US',
    outputEscape: escapeOutput,
    parseLimit: 1e6,
    memoryLimit: 5e7,
  });
  // The built-in `raw` filter would bypass escaping for any value; ours only
  // lets core-produced HTML through.
  engine.registerFilter('raw', { raw: true, handler: escapeOutput });

  const parsed = new Map<string, Template[]>();
  const parse = (path: string): Template[] => {
    const cached = parsed.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const text = templates[path];
    if (text === undefined) {
      throw new Error(`Theme "${manifest.id}" has no template "${path}".`);
    }
    const compiled = engine.parse(text, path);
    parsed.set(path, compiled);
    return compiled;
  };

  return {
    manifest,
    files,
    rev,
    async render(path, view) {
      const output: unknown = await engine.render(parse(path), view, {
        globals: view,
      });
      return String(output);
    },
  };
}

/**
 * Renders a small operator-authored plain-text Liquid template (e.g. an
 * email body) against `data`. Same restricted engine settings as themes,
 * but without HTML escaping: the output is text, not markup.
 */
export async function renderTextTemplate(
  source: string,
  data: Readonly<Record<string, unknown>>,
): Promise<string> {
  const engine = new Liquid({
    strictFilters: true,
    strictVariables: false,
    ownPropertyOnly: true,
    jsTruthy: false,
    timezoneOffset: 0,
    locale: 'en-US',
    parseLimit: 1e5,
    memoryLimit: 1e6,
  });
  const output: unknown = await engine.parseAndRender(source, data);
  return String(output);
}
