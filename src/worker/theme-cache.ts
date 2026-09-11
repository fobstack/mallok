/**
 * Isolate-level cache of the compiled theme.
 *
 * The theme is a build-time constant, so there is exactly one entry and no
 * invalidation: a different theme is a different deployment. Parsing the
 * templates still costs something, hence the cache.
 */

import { type CompiledTheme, compileTheme } from '../core/index.js';
import { activeTheme } from './composition.js';

let compiled: CompiledTheme | undefined;

/** Returns the compiled active theme, parsing its templates on first use. */
export function getCompiledTheme(): CompiledTheme {
  if (compiled === undefined) {
    const theme = activeTheme();
    compiled = compileTheme(theme.manifest, theme.files, 1);
  }
  return compiled;
}

/** Test hook: forgets the parsed templates. */
export function resetThemeCacheForTests(): void {
  compiled = undefined;
}
