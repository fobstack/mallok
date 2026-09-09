/**
 * The island client (`src/runtime/react`).
 *
 * Runs in the browser, not in the Worker. It finds the placeholders the
 * `{% island %}` tag left behind, reads the props that came with each one and
 * mounts the matching component into it.
 *
 * **This mounts; it does not hydrate.** The placeholder is empty in the HTML
 * the server sent — the island's own markup is created here, on the client.
 * That is deliberate: the server does not run React at all, which is what
 * keeps a page's server cost independent of how interactive it is. The
 * consequence is equally deliberate: anything that must work without
 * JavaScript — the primary content, a form that has to submit — belongs in
 * the Liquid template, with the island enhancing it rather than being it.
 *
 * Mounting is scheduled, not immediate: a cart below the fold should not
 * compete with the page becoming interactive.
 */

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** A component the page may mount, keyed by the name templates use. */
export type IslandRegistry = Readonly<
  Record<string, () => Promise<{ default: IslandComponent }>>
>;

export type IslandComponent = (props: Record<string, unknown>) => unknown;

/** When an island should mount. Declared per island, not per page. */
export type HydrationStrategy = 'eager' | 'idle' | 'visible';

export interface MountOptions {
  /** Strategy for islands that do not declare one. Default `idle`. */
  readonly defaultStrategy?: HydrationStrategy;
  /** Where to look. Defaults to the whole document. */
  readonly root?: ParentNode;
  /** How long `idle` may wait before mounting anyway. Default 2000 ms. */
  readonly idleTimeout?: number;
}

/** Placeholders already mounted, so a second call cannot mount them twice. */
const mounted = new WeakMap<Element, Root>();

/**
 * Mounts every island in `root` that the registry knows about.
 *
 * Safe to call again — after a client-side navigation, say. Elements that
 * already carry a root are skipped rather than mounted a second time, which
 * would otherwise leave two React trees fighting over one container.
 */
export function mountIslands(
  registry: IslandRegistry,
  options: MountOptions = {},
): void {
  const root = options.root ?? document;
  const fallback = options.defaultStrategy ?? 'idle';
  const placeholders = root.querySelectorAll<HTMLElement>('[data-island]');
  for (const element of placeholders) {
    if (mounted.has(element)) {
      continue;
    }
    const name = element.dataset['island'];
    if (name === undefined) {
      continue;
    }
    const load = registry[name];
    if (load === undefined) {
      // A page can render an island this bundle does not carry — a build
      // mismatch worth seeing in the console, not an exception that takes the
      // page's other islands down with it.
      console.warn(`[runtime] no island registered for "${name}"`);
      continue;
    }
    const strategy = strategyOf(element, fallback);
    schedule(element, strategy, options.idleTimeout ?? 2000, () => {
      void mount(element, name, load);
    });
  }
}

function strategyOf(
  element: HTMLElement,
  fallback: HydrationStrategy,
): HydrationStrategy {
  const declared = element.dataset['islandStrategy'];
  return declared === 'eager' || declared === 'idle' || declared === 'visible'
    ? declared
    : fallback;
}

async function mount(
  element: HTMLElement,
  name: string,
  load: () => Promise<{ default: IslandComponent }>,
): Promise<void> {
  if (mounted.has(element)) {
    return;
  }
  try {
    const module = await load();
    // Re-checked after the await: two schedulers can race on one element.
    if (mounted.has(element)) {
      return;
    }
    const props = readProps(element);
    const root = createRoot(element);
    mounted.set(element, root);
    root.render(createElement(module.default as never, props as never));
  } catch (error) {
    console.error(`[runtime] island "${name}" failed to mount`, error);
  }
}

/**
 * Props travel in a `<script type="application/json">` *inside* the
 * placeholder, so JSON quoting and HTML attribute quoting never have to agree
 * and no page-wide id has to be minted to link the two. Read before mounting,
 * because mounting replaces the placeholder's children.
 */
function readProps(element: HTMLElement): Record<string, unknown> {
  const holder = element.querySelector(':scope > script[data-island-props]');
  if (holder === null || holder.textContent === null) {
    return {};
  }
  try {
    return JSON.parse(holder.textContent) as Record<string, unknown>;
  } catch {
    console.warn('[runtime] island props are not valid JSON');
    return {};
  }
}

function schedule(
  element: HTMLElement,
  strategy: HydrationStrategy,
  idleTimeout: number,
  run: () => void,
): void {
  if (strategy === 'eager') {
    run();
    return;
  }
  if (strategy === 'visible' && 'IntersectionObserver' in globalThis) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.disconnect();
          run();
          return;
        }
      }
    });
    observer.observe(element);
    return;
  }
  if ('requestIdleCallback' in globalThis) {
    // The timeout matters: a busy page can otherwise stay busy long enough
    // that an idle callback never runs and the island never appears.
    globalThis.requestIdleCallback(
      () => {
        run();
      },
      { timeout: idleTimeout },
    );
    return;
  }
  setTimeout(run, 0);
}
