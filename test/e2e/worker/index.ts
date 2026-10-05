/**
 * The Worker the browser tests run.
 *
 * It is this repository's own entry (`src/worker/index.ts`) plus one plugin:
 * the default composition has no plugin with an editable panel, so without
 * it the record form — the largest piece of admin interface a plugin can
 * ask for — would never be opened by a browser. The plugin is registered
 * switched off, like any other, and the spec that needs it switches it on;
 * every other spec sees the site it always saw.
 */

import {
  atelier,
  createMallok,
  inquiry,
} from '../../../src/worker/framework.js';
import { catalogPlugin } from '../../fixtures/catalog-plugin.js';

export default createMallok({
  theme: atelier,
  plugins: [inquiry, catalogPlugin],
});
