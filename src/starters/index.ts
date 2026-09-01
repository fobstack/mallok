/**
 * The starters compiled into this build.
 *
 * Like themes and plugins, a starter is source: it ships with the repository
 * you forked (docs/ARCHITECTURE.md §11). The wizard offers whatever is listed
 * here and imports one of them exactly once.
 */

import { tradeB2bStarter } from './trade-b2b/index.js';
import type { Starter } from './types.js';

/** Every starter in this build. */
export const STARTERS: readonly Starter[] = [tradeB2bStarter];

/** Finds one by id. */
export function findStarter(id: string): Starter | undefined {
  return STARTERS.find((starter) => starter.id === id);
}
