/**
 * The starters Mallok itself ships. A site adds its own through
 * `createMallok({ starters })`; the wizard offers those first, then these,
 * and imports one of them exactly once (docs/ARCHITECTURE.md §11).
 */

import { tradeB2bStarter } from './trade-b2b/index.js';
import type { Starter } from './types.js';

/** Every starter Mallok ships. */
export const STARTERS: readonly Starter[] = [tradeB2bStarter];
