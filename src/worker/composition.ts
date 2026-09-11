/**
 * What this deployment is made of: its theme and its plugins.
 *
 * Until 0.1.0-rc.3 both were module-level constants read directly from
 * `src/themes/index.ts` and `src/plugins/index.ts`, which meant a site could
 * only choose them by editing Mallok's own source — so every project had to
 * be a **copy of this repository**. A generated project is now a thin shell
 * that depends on the `mallok` package and passes its composition in
 * (`createMallok`, `framework.ts`).
 *
 * Still a build-time decision, exactly as before: this is set once, by the
 * Worker's entry module, before the first request. There is no admin control
 * and no database column, because switching either one needs a new bundle
 * (docs/PRODUCT_VISION.md, "themes and plugins are build-time").
 */

import type { MallokPlugin } from '../plugins/types.js';
import type { BundledTheme } from '../themes/index.js';

/** The composition an entry module declares. */
export interface MallokComposition {
  readonly theme: BundledTheme;
  readonly plugins: readonly MallokPlugin[];
}

let current: MallokComposition | null = null;

/**
 * Declares the composition. Called by `createMallok` at module scope.
 *
 * Calling it twice with different values is a programming error rather than a
 * feature: the theme is parsed and cached per isolate, and plugin migrations
 * run at boot, so a later change would apply to some requests and not others.
 */
export function configure(composition: MallokComposition): void {
  current = composition;
}

/**
 * The composition, or the defaults compiled into this bundle.
 *
 * The fallback exists for this repository's own Worker and its tests, which
 * run the framework directly rather than through a generated shell. It is
 * resolved lazily so that importing any module here does not drag in every
 * theme.
 */
function resolved(): MallokComposition {
  if (current === null) {
    throw new Error(
      'Mallok has no composition. The Worker entry module must call ' +
        'createMallok({ theme, plugins }) from "mallok/worker".',
    );
  }
  return current;
}

/** The theme this deployment renders with. */
export function activeTheme(): BundledTheme {
  return resolved().theme;
}

/**
 * The plugins compiled into this deployment.
 *
 * Not to be confused with `plugin-runtime.ts`'s `activePlugins`, which is the
 * subset a *request* may run — compiled in **and** switched on in the
 * database.
 */
export function compiledPlugins(): readonly MallokPlugin[] {
  return resolved().plugins;
}

/** Whether a composition has been declared yet. */
export function isConfigured(): boolean {
  return current !== null;
}

/** Test hook: forgets the composition. */
export function resetCompositionForTests(): void {
  current = null;
}
