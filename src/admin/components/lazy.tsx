/**
 * Loading a route's code on demand.
 *
 * The first screen budget covers React, signals, the router and the form
 * generator (docs/ADMIN.md §13). The editor pulls in the whole rendering
 * pipeline — unified, remark, rehype, LiquidJS — because its preview runs the
 * real renderer, so that code has to arrive with the editor rather than with
 * the first paint.
 *
 * React's own `lazy` needs a `<Suspense>` boundary and a default export;
 * this app's routes are named exports chosen by a plain `if` chain
 * (`app.tsx`), so this nine-line version fits what is actually there instead
 * of reshaping the routing around `lazy`'s expectations.
 */

import type { ComponentType, JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';

/** Wraps a dynamic import as a component that renders once it resolves. */
export function lazyRoute<P extends Record<string, unknown>>(
  load: () => Promise<ComponentType<P>>,
  options: {
    /**
     * What shows while the code loads, and instead of the failure message.
     * For a part of a page rather than a whole route — a menu, the toasts —
     * where a "Loading…" block would be in the way.
     */
    readonly placeholder?: ReactNode;
  } = {},
): (props: P) => JSX.Element {
  let cached: ComponentType<P> | null = null;
  return function LazyRoute(props: P): JSX.Element {
    // The initialiser form, on purpose: a component is a function, and
    // `useState(cached)` would have React call it — with no props, from
    // inside `useState` — the second time a route mounts.
    const [loaded, setLoaded] = useState<ComponentType<P> | null>(() => cached);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      if (cached !== null) {
        return;
      }
      let cancelled = false;
      void load().then(
        (component) => {
          cached = component;
          if (!cancelled) {
            setLoaded(() => component);
          }
        },
        () => {
          if (!cancelled) {
            setFailed(true);
          }
        },
      );
      return () => {
        cancelled = true;
      };
    }, []);

    if (options.placeholder !== undefined && (failed || loaded === null)) {
      return <>{options.placeholder}</>;
    }
    if (failed) {
      return (
        <div className="page">
          <p className="error" role="alert">
            This part of the admin could not be loaded. Check your connection
            and reload.
          </p>
        </div>
      );
    }
    if (loaded === null) {
      return (
        <div className="page" aria-busy="true">
          <span className="sr-only">Loading…</span>
          <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
          <div className="mt-6 h-40 animate-pulse rounded-md bg-muted" />
        </div>
      );
    }
    const Loaded = loaded;
    return <Loaded {...props} />;
  };
}
