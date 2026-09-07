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

import type { ComponentType, JSX } from 'react';
import { useEffect, useState } from 'react';

/** Wraps a dynamic import as a component that renders once it resolves. */
export function lazyRoute<P extends Record<string, unknown>>(
  load: () => Promise<ComponentType<P>>,
): (props: P) => JSX.Element {
  let cached: ComponentType<P> | null = null;
  return function LazyRoute(props: P): JSX.Element {
    const [loaded, setLoaded] = useState<ComponentType<P> | null>(cached);
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
      return <div className="booting">Loading…</div>;
    }
    const Loaded = loaded;
    return <Loaded {...props} />;
  };
}
