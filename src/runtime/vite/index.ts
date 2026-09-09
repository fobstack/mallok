/**
 * The build-time half of the runtime (`src/runtime/vite`).
 *
 * Two virtual modules, both generated from the file tree:
 *
 *   `virtual:fobstack-routes`   the route manifest the Worker imports
 *   `virtual:fobstack-islands`  the client registry and its bootstrap
 *
 * Scanning happens at build time because a Worker has no file system, and
 * because route discovery must not cost anything per request. Islands become
 * their own Rollup entry points, so a page loads the one it used rather than
 * all of them, and the emitted file names — hashes included — are written
 * back into the manifest the runtime reads.
 */

import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

export interface RuntimePluginOptions {
  /** Directory holding the page modules. Default `src/pages`. */
  readonly pages?: string;
  /** Directory holding island components. Default `src/islands`. */
  readonly islands?: string;
  /** Default locale prefixes; a product may still override per request. */
  readonly locales?: readonly string[];
  /** The locale that carries no prefix. */
  readonly defaultLocale?: string;
  /** Public base the built assets are served from. Default `/`. */
  readonly base?: string;
  /**
   * The island client the generated bootstrap imports.
   *
   * Defaults to this repository's `src/runtime/react/index.ts`, resolved from
   * the working directory. A build that runs from somewhere else passes its
   * own absolute path.
   */
  readonly islandClient?: string;
  /**
   * Path to the client build's `fobstack-islands.json`, for the Worker build.
   *
   * A product builds twice: the client bundle emits the island chunks and
   * their hashed names, and the Worker bundle has to reference those names. It
   * cannot derive them — they did not exist when it started. Pointing the
   * second build at the first build's manifest is that handoff, and it exists
   * so a consumer never has to copy the JSON's contents into its own source.
   *
   * When set, the island *registry* is empty: the Worker mounts nothing, and
   * the components must not be pulled into its bundle.
   */
  readonly islandManifest?: string;
}

/** Minimal shape of the Vite plugin object this module returns. */
export interface RuntimePlugin {
  name: string;
  configResolved?: (config: {
    root: string;
    base?: string;
    command?: 'build' | 'serve';
  }) => void;
  resolveId(id: string): string | null;
  load(id: string): Promise<string | null>;
  generateBundle?: (
    this: EmitContext,
    options: unknown,
    bundle: Record<string, BundleEntry>,
  ) => void;
  configureServer?: (server: ViteDevServerLike) => void;
}

/** The part of Rollup's plugin context this plugin uses to write a file. */
export interface EmitContext {
  emitFile(file: {
    type: 'asset';
    fileName: string;
    source: string;
  }): string | void;
}

/** The parts of a Rollup output chunk this plugin reads. */
export interface BundleEntry {
  readonly type: string;
  readonly fileName: string;
  readonly facadeModuleId?: string | null;
  readonly imports?: readonly string[];
  readonly isDynamicEntry?: boolean;
}

interface ViteDevServerLike {
  watcher: { on(event: string, handler: (path: string) => void): void };
  moduleGraph: {
    getModuleById(id: string): unknown;
    invalidateModule(module: never): void;
  };
  ws: { send(payload: { type: string }): void };
}

export const ROUTES_ID = 'virtual:fobstack-routes';
export const ISLANDS_ID = 'virtual:fobstack-islands';
/** The client entry point: it is what actually calls `mountIslands`. */
export const BOOTSTRAP_ID = 'virtual:fobstack-bootstrap';
const RESOLVED_ROUTES = `\0${ROUTES_ID}`;
const RESOLVED_ISLANDS = `\0${ISLANDS_ID}`;
const RESOLVED_BOOTSTRAP = `\0${BOOTSTRAP_ID}`;

/**
 * Where a dev server serves the bootstrap module.
 *
 * Vite exposes a virtual module at `/@id/` with the leading NUL of its
 * resolved id spelled `__x00__`. There is no hashed file in dev — nothing has
 * been built — so this is the URL a page must load instead, and without it a
 * dev page renders islands and ships no script to mount them.
 */
export const DEV_BOOTSTRAP_PATH = `@id/__x00__${BOOTSTRAP_ID}`;

/** The shape of `fobstack-islands.json`, written by the client build. */
export interface IslandManifestFile {
  /** Hashed URL of the bootstrap that mounts islands. */
  readonly bootstrap?: string;
  readonly islands: Readonly<
    Record<string, { readonly src: string; readonly imports?: string[] }>
  >;
}

const PAGE_EXTENSIONS = ['.ts', '.js'];
const ISLAND_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];

/**
 * Files that live beside pages and islands but are neither.
 *
 * A `.d.ts` has no runtime export to import, and a test file is not a route —
 * scanning either produces a broken entry that only fails at request time.
 */
const NOT_SOURCE = /(\.d\.ts|\.(test|spec)\.[a-z]+)$/;

/**
 * Turns a file path under the pages directory into a route pattern.
 *
 * `products/[slug].ts` → `/products/[slug]`
 * `index.ts`           → `/`
 * `blog/index.ts`      → `/blog`
 *
 * Collapsing `index` is what lets a directory own both its listing page and
 * its children without a naming convention nobody remembers.
 */
export function patternFor(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.(ts|js)$/, '');
  const parts = withoutExtension.split(sep).filter((part) => part !== '');
  if (parts.at(-1) === 'index') {
    parts.pop();
  }
  return `/${parts.join('/')}`;
}

/** The name a template refers to an island by: its file's base name. */
export function islandNameFor(relativePath: string): string {
  return basename(relativePath, extname(relativePath));
}

/**
 * The module specifier the generated code imports a file by.
 *
 * Always POSIX separators, even on Windows: this string ends up inside
 * generated JavaScript, where a backslash is an escape character rather than
 * a path separator.
 */
export function specifierFor(directory: string, file: string): string {
  return join(directory, file).split(sep).join('/');
}

/** Every matching file under `directory`, relative to it, in a stable order. */
export async function scanDirectory(
  directory: string,
  extensions: readonly string[],
): Promise<string[]> {
  const found: string[] = [];
  await walk(directory, directory, extensions, found);
  return found.sort();
}

async function walk(
  root: string,
  current: string,
  extensions: readonly string[],
  found: string[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    // A project that has not created the directory yet is a valid state.
    return;
  }
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, extensions, found);
      continue;
    }
    if (
      extensions.some((extension) => entry.name.endsWith(extension)) &&
      !NOT_SOURCE.test(entry.name)
    ) {
      found.push(relative(root, full));
    }
  }
}

/**
 * Generates the route manifest module.
 *
 * Every route is a dynamic `import()`, so Rollup gives each page its own
 * chunk and the Worker evaluates only the page a request needs.
 *
 * The default export is what is taken, because that is what `definePage`
 * returns. Handing the module namespace straight to the runtime instead would
 * find `render` only on pages that happened to export their members
 * individually, and silently produce a page with no `render` on every page
 * written the documented way.
 */
export function generateRoutesModule(
  pageFiles: readonly string[],
  pagesDirectory: string,
  options: RuntimePluginOptions,
): string {
  const routes = pageFiles.map((file) => {
    const pattern = patternFor(file);
    const specifier = JSON.stringify(specifierFor(pagesDirectory, file));
    return `  { pattern: ${JSON.stringify(pattern)}, load: () => import(${specifier}).then((module) => module.default) }`;
  });
  return [
    '// Generated by src/runtime/vite. Do not edit.',
    "import { bootstrap, islands } from 'virtual:fobstack-islands';",
    'export const manifest = {',
    `  locales: ${JSON.stringify(options.locales ?? [])},`,
    `  defaultLocale: ${JSON.stringify(options.defaultLocale ?? 'en')},`,
    '  islands,',
    '  islandBootstrap: bootstrap,',
    '  routes: [',
    routes.join(',\n'),
    '  ],',
    '};',
    'export default manifest;',
  ].join('\n');
}

/**
 * Rejects two islands that templates could only refer to by the same name.
 *
 * A template says `{% island "cart" %}`; if two files claim that name, which
 * one a page gets depends on the order the directory scan happened to return,
 * and the loser disappears with no error anywhere. Naming the files is the
 * point — "duplicate island" alone leaves the author hunting for the pair.
 */
function assertUniqueNames(
  entries: readonly { name: string; file: string }[],
): void {
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry.file]);
  }
  const clashes = [...byName.entries()].filter(([, files]) => files.length > 1);
  if (clashes.length > 0) {
    const detail = clashes
      .map(([name, files]) => `"${name}": ${files.join(', ')}`)
      .join('; ');
    throw new Error(
      `Two islands cannot share a name, because a template has only the name to refer to them by — ${detail}.`,
    );
  }
}

/**
 * Generates the island module: the server-side entry table and the client
 * registry, plus a bootstrap that mounts them.
 *
 * `islands` is what the runtime scans against and what supplies script URLs.
 * In a dev server the URLs are the source paths Vite serves directly; a
 * production build rewrites them to the hashed file names in `generateBundle`.
 */
export function generateIslandsModule(
  islandFiles: readonly string[],
  islandsDirectory: string,
  built?: IslandManifestFile,
  devBootstrap?: string,
): string {
  const entries = islandFiles.map((file) => ({
    file,
    name: islandNameFor(file),
    specifier: specifierFor(islandsDirectory, file),
  }));
  assertUniqueNames(entries);
  // The Worker build is handed the client build's manifest, so it names the
  // hashed files the browser will really request. Its registry stays empty:
  // importing the components there would drag React into the Worker bundle to
  // mount nothing.
  const manifest =
    built === undefined
      ? entries
          .map(
            (entry) =>
              `  ${JSON.stringify(entry.name)}: { src: ${JSON.stringify(entry.specifier)} }`,
          )
          .join(',\n')
      : Object.entries(built.islands)
          .map(
            ([name, entry]) =>
              `  ${JSON.stringify(name)}: ${JSON.stringify(entry)}`,
          )
          .join(',\n');
  const registry =
    built === undefined
      ? entries
          .map(
            (entry) =>
              `  ${JSON.stringify(entry.name)}: () => import(${JSON.stringify(entry.specifier)})`,
          )
          .join(',\n')
      : '';
  return [
    '// Generated by src/runtime/vite. Do not edit.',
    'export const islands = {',
    manifest,
    '};',
    'export const registry = {',
    registry,
    '};',
    `export const bootstrap = ${JSON.stringify(built?.bootstrap ?? devBootstrap)};`,
    'export default registry;',
  ].join('\n');
}

/**
 * Reads the built island entries out of a finished bundle.
 *
 * A chunk is an island when the module it was built from is one of the island
 * source files. The emitted file name carries the content hash, which is the
 * whole point: the runtime has to serve the file the build actually produced,
 * not the source path it started from.
 */
export function islandsFromBundle(
  bundle: Readonly<Record<string, BundleEntry>>,
  islandSources: Readonly<Record<string, string>>,
  base = '/',
): Record<string, { src: string; imports?: string[] }> {
  const byModule = new Map<string, string>();
  for (const [name, source] of Object.entries(islandSources)) {
    byModule.set(source, name);
  }
  const built: Record<string, { src: string; imports?: string[] }> = {};
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk' || chunk.facadeModuleId == null) {
      continue;
    }
    const name = byModule.get(chunk.facadeModuleId);
    if (name === undefined) {
      continue;
    }
    const imports = (chunk.imports ?? []).map((file) => `${base}${file}`);
    built[name] = {
      src: `${base}${chunk.fileName}`,
      ...(imports.length > 0 ? { imports } : {}),
    };
  }
  return built;
}

/**
 * The hashed URL of the chunk built from the bootstrap entry.
 *
 * This is the file a page with islands must load: it is the only one that
 * calls `mountIslands`. Linking an island's own component chunk instead would
 * download the component and never mount it.
 */
export function bootstrapFrom(
  bundle: Readonly<Record<string, BundleEntry>>,
  base = '/',
): string | undefined {
  for (const chunk of Object.values(bundle)) {
    if (chunk.type === 'chunk' && chunk.facadeModuleId === RESOLVED_BOOTSTRAP) {
      return `${base}${chunk.fileName}`;
    }
  }
  return undefined;
}

/**
 * The island client's own module specifier.
 *
 * Resolved from this file rather than written as a package name: the runtime
 * is an internal module of this repository, not a published package, so
 * `@fobstack/runtime/react` would resolve to nothing. Deriving it here keeps
 * the generated bootstrap correct wherever the repository is checked out.
 */
export function islandClientSpecifier(): string {
  // Deliberately not derived from `import.meta.url`: what that holds depends
  // on whether Node, Vite or a test runner loaded this module, and the two
  // that are not Node produce a URL `fileURLToPath` rejects. The runtime is an
  // internal module at a fixed place in the repository, so the repository root
  // is the honest anchor — and `islandClient` overrides it for a build whose
  // working directory is elsewhere.
  return resolve(process.cwd(), 'src/runtime/react/index.ts');
}

/**
 * The client bootstrap a build includes as its island entry point.
 *
 * `client` is injectable so a test can point it somewhere else; nothing in
 * normal use passes it.
 */
export function generateBootstrap(client?: string): string {
  const specifier = client ?? islandClientSpecifier();
  return [
    `import { mountIslands } from ${JSON.stringify(specifier)};`,
    "import { registry } from 'virtual:fobstack-islands';",
    'mountIslands(registry);',
  ].join('\n');
}

/** The Vite plugin. */
export function fobstackRuntime(
  options: RuntimePluginOptions = {},
): RuntimePlugin {
  const pagesOption = options.pages ?? 'src/pages';
  const islandsOption = options.islands ?? 'src/islands';
  /**
   * Resolved against Vite's `root`, not the process working directory: a
   * product whose Vite root is a subdirectory — Mallok's admin is one — would
   * otherwise scan the wrong tree and silently produce an empty manifest.
   */
  let projectRoot = process.cwd();
  let base = options.base ?? '/';
  let serving = false;
  const pagesDirectory = (): string => resolve(projectRoot, pagesOption);
  const islandsDirectory = (): string => resolve(projectRoot, islandsOption);
  /** Island name → absolute source path, filled in when the module is built. */
  const islandSources: Record<string, string> = {};
  /** The client build's manifest, when this is the Worker build. */
  const clientManifest = async (): Promise<IslandManifestFile | undefined> => {
    if (options.islandManifest === undefined) {
      return undefined;
    }
    const path = resolve(projectRoot, options.islandManifest);
    try {
      return JSON.parse(await readFile(path, 'utf8')) as IslandManifestFile;
    } catch (error) {
      // Silently falling back to source paths would put `/src/islands/cart.tsx`
      // into production HTML, where it 404s for every visitor.
      throw new Error(
        `Could not read the island manifest at ${path}. Run the client build first. (${String(error)})`,
      );
    }
  };
  return {
    name: 'fobstack-runtime',
    configResolved(config) {
      projectRoot = config.root;
      serving = config.command === 'serve';
      if (options.base === undefined && config.base !== undefined) {
        base = config.base;
      }
    },
    resolveId(id) {
      if (id === ROUTES_ID) {
        return RESOLVED_ROUTES;
      }
      if (id === BOOTSTRAP_ID) {
        return RESOLVED_BOOTSTRAP;
      }
      return id === ISLANDS_ID ? RESOLVED_ISLANDS : null;
    },
    async load(id) {
      if (id === RESOLVED_ROUTES) {
        const directory = pagesDirectory();
        const files = await scanDirectory(directory, PAGE_EXTENSIONS);
        return generateRoutesModule(files, directory, options);
      }
      if (id === RESOLVED_BOOTSTRAP) {
        return generateBootstrap(options.islandClient);
      }
      if (id === RESOLVED_ISLANDS) {
        const directory = islandsDirectory();
        const files = await scanDirectory(directory, ISLAND_EXTENSIONS);
        for (const file of files) {
          islandSources[islandNameFor(file)] = resolve(directory, file);
        }
        // In dev there is no build to take a hashed name from, so the page
        // loads the virtual module straight from the dev server.
        const devBootstrap = serving
          ? `${base}${DEV_BOOTSTRAP_PATH}`
          : undefined;
        return generateIslandsModule(
          files,
          directory,
          await clientManifest(),
          devBootstrap,
        );
      }
      return null;
    },

    /**
     * Writes the built island entries, hashes and all, into
     * `fobstack-islands.json`.
     *
     * The virtual module was generated before any chunk existed, so it can
     * only carry source paths. This is where the names the browser will
     * actually request are known, and the Worker build reads this file to
     * fill `manifest.islands`.
     */
    generateBundle(_options, bundle) {
      // The Worker build reads this file; it must not write one back.
      if (options.islandManifest !== undefined) {
        return;
      }
      const islands = islandsFromBundle(bundle, islandSources, base);
      if (Object.keys(islands).length === 0) {
        return;
      }
      const bootstrap = bootstrapFrom(bundle, base);
      const file: IslandManifestFile = {
        ...(bootstrap === undefined ? {} : { bootstrap }),
        islands,
      };
      this.emitFile({
        type: 'asset',
        fileName: 'fobstack-islands.json',
        source: JSON.stringify(file, null, 2),
      });
    },
    configureServer(server) {
      // Adding or removing a page or island has to invalidate the generated
      // module, or the dev server keeps serving a table that no longer
      // matches the tree.
      const reload = (path: string): void => {
        if (
          !path.startsWith(pagesDirectory()) &&
          !path.startsWith(islandsDirectory())
        ) {
          return;
        }
        for (const id of [RESOLVED_ROUTES, RESOLVED_ISLANDS]) {
          const module = server.moduleGraph.getModuleById(id);
          if (module !== null && module !== undefined) {
            server.moduleGraph.invalidateModule(module as never);
          }
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}
