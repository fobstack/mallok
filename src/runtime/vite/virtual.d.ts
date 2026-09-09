/**
 * Types for the modules the Vite plugin generates.
 *
 * These exist only at build time, so TypeScript has no file to look at and a
 * consumer would otherwise have to write this declaration itself — which means
 * every consumer inventing its own idea of what the manifest contains, and
 * discovering the differences at runtime. Shipped with the package and pulled
 * in through `types` in the consumer's tsconfig:
 *
 * Referenced from a build's own tsconfig with
 * `"types": ["./src/runtime/vite/virtual.d.ts"]`, or included directly.
 */

declare module 'virtual:fobstack-routes' {
  import type { RouteManifest } from '../core/index.js';

  /** Routes, locales, islands and the bootstrap URL, from the file tree. */
  export const manifest: RouteManifest;
  export default manifest;
}

declare module 'virtual:fobstack-islands' {
  import type { IslandEntry } from '../core/index.js';

  /** Islands the build found, keyed by the name templates use. */
  export const islands: Readonly<Record<string, IslandEntry>>;

  /**
   * Client-side loaders for those islands.
   *
   * Empty in a Worker build: the components must not be pulled into a bundle
   * that will never mount them.
   */
  export const registry: Readonly<
    Record<string, () => Promise<{ default: (props: never) => unknown }>>
  >;

  /** Hashed URL of the bootstrap, once a client build has produced one. */
  export const bootstrap: string | undefined;

  export default registry;
}

declare module 'virtual:fobstack-bootstrap' {
  /**
   * The client entry point. Importing it mounts every island on the page;
   * a product uses it as the input of its client build rather than importing
   * it by hand.
   */
}
