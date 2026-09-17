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

import type {
  MallokPlugin as InternalMallokPlugin,
  PluginContext as InternalPluginContext,
  PluginHooks as InternalPluginHooks,
  PluginInput as InternalPluginInput,
  PluginRenderContext as InternalPluginRenderContext,
  PluginRequestContext as InternalPluginRequestContext,
} from '../../src/plugins/types.js';
import type { Env as ActualEnv } from '../../src/worker/framework.js';
import type {
  BundledTheme,
  Env,
  MallokPlugin,
  PluginContext,
  PluginHooks,
  PluginInput,
  PluginRenderContext,
  PluginRequestContext,
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
export const definePluginMatches: Exact<
  Actual['definePlugin'],
  Declared['definePlugin']
> = true;

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

// The plugin API is checked in both directions. A one-way assignment let the
// old opaque `Record<string, unknown>` declarations compile while providing
// no contextual types to an author writing an inline handler.
export const internalPluginIsPublic: MallokPlugin =
  undefined as unknown as InternalMallokPlugin;
export const publicPluginIsInternal: InternalMallokPlugin =
  undefined as unknown as MallokPlugin;
export const internalInputIsPublic: PluginInput =
  undefined as unknown as InternalPluginInput;
export const publicInputIsInternal: InternalPluginInput =
  undefined as unknown as PluginInput;
export const internalHooksArePublic: PluginHooks =
  undefined as unknown as InternalPluginHooks;
export const publicHooksAreInternal: InternalPluginHooks =
  undefined as unknown as PluginHooks;
export const internalContextIsPublic: PluginContext =
  undefined as unknown as InternalPluginContext;
export const publicContextIsInternal: InternalPluginContext =
  undefined as unknown as PluginContext;
export const internalRequestContextIsPublic: PluginRequestContext =
  undefined as unknown as InternalPluginRequestContext;
export const publicRequestContextIsInternal: InternalPluginRequestContext =
  undefined as unknown as PluginRequestContext;
export const internalRenderContextIsPublic: PluginRenderContext =
  undefined as unknown as InternalPluginRenderContext;
export const publicRenderContextIsInternal: InternalPluginRenderContext =
  undefined as unknown as PluginRenderContext;

export const built: BundledTheme = undefined as unknown as ReturnType<
  Actual['defineTheme']
>;
export const handler: ExportedHandler<Env> = undefined as unknown as ReturnType<
  Actual['createMallok']
>;
