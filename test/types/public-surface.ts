/**
 * Keeps `src/worker/public.d.ts` — the declarations sites compile against —
 * matching `src/worker/framework.ts`, the code they actually run.
 *
 * There are no assertions here and nothing to execute: every check below is a
 * type that fails to compile if the two disagree, so `pnpm typecheck` is what
 * runs it. That is the whole justification for publishing hand-written
 * declarations instead of the emitted ones; without this file they would
 * simply be a second description of the API, free to be wrong.
 */

import type { Env as ActualEnv } from '../../src/worker/framework.js';
import type {
  BundledTheme,
  Env,
  MallokPlugin,
} from '../../src/worker/public.js';

type Declared = typeof import('../../src/worker/public.js');
type Actual = typeof import('../../src/worker/framework.js');

/** Fails to compile unless `T` is `never`, naming the offender in the error. */
type Nothing<T extends never> = T;

// A value the framework exports and the declarations omit is an API a site
// can use and cannot see. The reverse is a promise the package does not keep.
export type UndeclaredExports = Nothing<Exclude<keyof Actual, keyof Declared>>;
export type MissingExports = Nothing<Exclude<keyof Declared, keyof Actual>>;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// `Env` is the one type a site writes out in full — its `wrangler.jsonc` must
// declare every binding named here — so it is checked for equality rather
// than for assignability in one direction.
export const envMatches: Exact<ActualEnv, Env> = true;

/**
 * The published shapes are deliberately narrower than the real ones.
 *
 * A site reads four fields off a theme manifest; the rest of `theme.json` —
 * content kinds, field schemas, configuration declarations — is validated by
 * the build and documented in `docs/THEME_FORMAT.md`, not something a site
 * should have to satisfy in a type. So these checks run one way: what the
 * package hands out must satisfy what it promised. They fail the moment a
 * promised field stops existing.
 */
export const theme: BundledTheme = undefined as unknown as Actual['atelier'];
export const themes: readonly BundledTheme[] = [] as unknown as readonly [
  Actual['atelier'],
  Actual['folio'],
  Actual['gazette'],
  Actual['journal'],
  Actual['manual'],
];
export const plugin: MallokPlugin = undefined as unknown as Actual['inquiry'];

export const built: BundledTheme = undefined as unknown as ReturnType<
  Actual['defineTheme']
>;
export const handler: ExportedHandler<Env> = undefined as unknown as ReturnType<
  Actual['createMallok']
>;
