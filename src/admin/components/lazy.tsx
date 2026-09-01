/**
 * Loading a route's code on demand.
 *
 * The first screen budget covers Preact, signals, the router and the form
 * generator (docs/ADMIN.md §13). The editor pulls in the whole rendering
 * pipeline — unified, remark, rehype, LiquidJS — because its preview runs the
 * real renderer, so that code has to arrive with the editor rather than with
 * the first paint.
 *
 * `preact/compat`'s `lazy` would do this, but the admin deliberately does not
 * ship the React compatibility layer (docs/TECH_STACK.md §6), and the honest
 * version is nine lines.
 */

import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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
        <div class="page">
          <p class="error" role="alert">
            This part of the admin could not be loaded. Check your connection
            and reload.
          </p>
        </div>
      );
    }
    if (loaded === null) {
      return <div class="booting">Loading…</div>;
    }
    const Loaded = loaded;
    return <Loaded {...props} />;
  };
}
