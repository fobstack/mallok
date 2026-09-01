/**
 * The plugin registry: a compile-time constant (docs/PLUGIN_API.md §8).
 *
 * **This list is what "installing a plugin" means.** Add the plugin's source
 * under `src/plugins/<id>/`, list it here, build and deploy. Removing one is
 * the reverse. There is no dynamic import and no runtime installation; the
 * only runtime state is the enable switch and settings in `plugin_state`.
 */

import { inquiryPlugin } from './inquiry/index.js';
import type { MallokPlugin } from './types.js';

/** Every plugin compiled into this build. */
export const PLUGINS: readonly MallokPlugin[] = [inquiryPlugin];
