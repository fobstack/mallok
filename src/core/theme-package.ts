/**
 * Validation of a theme directory.
 *
 * This runs at **build time** (docs/THEME_FORMAT.md §3): a theme that breaks
 * any rule here fails the build, so the author sees the problem in their own
 * terminal rather than after a deploy. Nothing in this file touches a file
 * system — the build script reads the directory and passes the entries in,
 * which is also what lets the tests drive it with literals.
 *
 * Everything a theme may contain is listed here, and anything else is
 * rejected rather than ignored: silently dropping a file would leave the
 * author believing it took effect.
 */

import {
  parseThemeManifest,
  THEME_API_VERSION,
  type ThemeManifest,
} from './theme.js';

/** One file of a theme directory, as read by the build script. */
export interface ThemeSourceFile {
  /** Path relative to the theme directory, with forward slashes. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A validated theme, split by where each file ends up in the build. */
export interface ThemePackage {
  readonly manifest: ThemeManifest;
  /** Text files bundled into the Worker: templates, partials, locale bundles. */
  readonly files: Readonly<Record<string, string>>;
  /** Files copied to Static Assets, keyed by their path inside the theme. */
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

/** Raised when a theme is invalid, with a reason for its author. */
export class ThemePackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThemePackageError';
  }
}

const MANIFEST = 'theme.json';
const ENTRY_MODULE = 'index.ts';
const TEMPLATE_PATH = /^(layouts|partials)\/[a-z0-9-]+\.liquid$/;
const LOCALE_PATH = /^locales\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/;
const ASSET_PATH = /^assets\/[a-z0-9][a-z0-9._/-]*$/;

/**
 * Content types for the extensions a theme may ship under `assets/`.
 *
 * SVG is absent for the same reason it is absent from uploaded media
 * (docs/SECURITY.md §6): it can carry script, and a theme is only
 * half-trusted. Anything not listed here is refused at install time, which is
 * what lets the serving code treat this table as exhaustive.
 */
export const THEME_ASSET_TYPES: Readonly<Record<string, string>> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  woff2: 'font/woff2',
  woff: 'font/woff',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
};

/** Attributes and tags a theme may not use without declaring them. */
const SCRIPT_TAG = /<script\b/i;
const EVENT_ATTRIBUTE = /\son[a-z]+\s*=/i;

/**
 * Validates a theme directory and splits it into the parts that are bundled
 * into the Worker and the parts that are copied to Static Assets.
 *
 * `directoryName` is checked against the manifest id, because the directory
 * name is what `src/themes/index.ts` imports by.
 */
export function readThemePackage(
  entries: readonly ThemeSourceFile[],
  directoryName?: string,
): ThemePackage {
  if (entries.length === 0) {
    throw new ThemePackageError('The theme directory is empty.');
  }

  const stripped = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.path === '') {
      continue;
    }
    assertSafePath(entry.path);
    stripped.set(entry.path, entry.bytes);
  }

  const manifestBytes = stripped.get(MANIFEST);
  if (manifestBytes === undefined) {
    throw new ThemePackageError('The theme has no theme.json.');
  }
  const manifest = parseManifest(manifestBytes);

  if (manifest.themeApi > THEME_API_VERSION) {
    throw new ThemePackageError(
      `This theme needs theme API ${manifest.themeApi}; this Mallok build supports ${THEME_API_VERSION}.`,
    );
  }
  if (directoryName !== undefined && directoryName !== manifest.id) {
    throw new ThemePackageError(
      `The directory is named "${directoryName}" but theme.json declares id "${manifest.id}".`,
    );
  }

  const files: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();

  for (const [path, bytes] of stripped) {
    if (path === MANIFEST || path === ENTRY_MODULE) {
      continue;
    }
    if (TEMPLATE_PATH.test(path) || LOCALE_PATH.test(path)) {
      files[path] = decoder.decode(bytes);
      continue;
    }
    if (ASSET_PATH.test(path)) {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      if (THEME_ASSET_TYPES[ext] === undefined) {
        throw new ThemePackageError(
          `"${path}" has an unsupported extension. Theme assets may be: ${Object.keys(THEME_ASSET_TYPES).join(', ')}.`,
        );
      }
      if (
        ext === 'js' &&
        !manifest.clientScripts.some(
          (script) =>
            (typeof script === 'string' ? script : script.path) === path,
        )
      ) {
        throw new ThemePackageError(
          `"${path}" must be declared in clientScripts.`,
        );
      }
      assets[path] = bytes;
      continue;
    }
    throw new ThemePackageError(
      `"${path}" is not an allowed path. A theme may contain theme.json, index.ts, layouts/*.liquid, partials/*.liquid, locales/*.json and assets/**.`,
    );
  }

  assertLayoutsExist(manifest, files);
  assertLocalesExist(manifest, files);
  assertNoUndeclaredScripts(manifest, files);

  return { manifest, files, assets };
}

function parseManifest(bytes: Uint8Array): ThemeManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ThemePackageError('theme.json is not valid JSON.');
  }
  try {
    return parseThemeManifest(parsed);
  } catch (error) {
    const detail =
      error instanceof Error ? firstIssue(error.message) : 'unknown problem';
    throw new ThemePackageError(`theme.json is invalid: ${detail}`);
  }
}

function assertSafePath(path: string): void {
  const segments = path.split('/');
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('://') ||
    segments.some(
      (segment) => segment === '..' || segment === '.' || segment === '',
    )
  ) {
    throw new ThemePackageError(`"${path}" is not a safe path.`);
  }
}

function assertLayoutsExist(
  manifest: ThemeManifest,
  files: Readonly<Record<string, string>>,
): void {
  const missing: string[] = [];
  if (files[manifest.home] === undefined) {
    missing.push(manifest.home);
  }
  for (const [kind, config] of Object.entries(manifest.kinds)) {
    if (files[config.layout] === undefined) {
      missing.push(`${config.layout} (kind "${kind}")`);
    }
    if (
      config.listLayout !== undefined &&
      files[config.listLayout] === undefined
    ) {
      missing.push(`${config.listLayout} (list of "${kind}")`);
    }
  }
  if (manifest.kinds.page === undefined) {
    // Content of a kind the next theme does not know falls back to the page
    // layout, so every theme must have one (docs/THEME_FORMAT.md §5.3).
    missing.push('a "page" kind, which is the fallback layout');
  }
  if (missing.length > 0) {
    throw new ThemePackageError(
      `The archive is missing: ${missing.join(', ')}.`,
    );
  }
}

function assertLocalesExist(
  manifest: ThemeManifest,
  files: Readonly<Record<string, string>>,
): void {
  if (!manifest.locales.includes(manifest.defaultLocale)) {
    throw new ThemePackageError(
      `defaultLocale "${manifest.defaultLocale}" is not in the locales list.`,
    );
  }
  const missing = manifest.locales.filter(
    (locale) => files[`locales/${locale}.json`] === undefined,
  );
  if (missing.length > 0) {
    throw new ThemePackageError(
      `theme.json declares locales without a bundle: ${missing.join(', ')}.`,
    );
  }
  for (const locale of manifest.locales) {
    const body = files[`locales/${locale}.json`] ?? '';
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed === null || typeof parsed !== 'object') {
        throw new Error('not an object');
      }
    } catch {
      throw new ThemePackageError(`locales/${locale}.json is not valid JSON.`);
    }
  }
}

/**
 * Refuses a theme whose templates emit script the manifest does not declare.
 * Undeclared scripts remain forbidden (docs/THEME_FORMAT.md §9).
 */
function assertNoUndeclaredScripts(
  manifest: ThemeManifest,
  files: Readonly<Record<string, string>>,
): void {
  if (manifest.clientScripts.length > 0) {
    return;
  }
  for (const [path, body] of Object.entries(files)) {
    if (!path.endsWith('.liquid')) {
      continue;
    }
    if (SCRIPT_TAG.test(body)) {
      throw new ThemePackageError(
        `"${path}" contains a <script> tag but theme.json declares no clientScripts.`,
      );
    }
    if (EVENT_ATTRIBUTE.test(body)) {
      throw new ThemePackageError(
        `"${path}" contains an inline event handler but theme.json declares no clientScripts.`,
      );
    }
  }
}

function firstIssue(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed;
}
