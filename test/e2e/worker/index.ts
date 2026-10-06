/**
 * The Worker the browser tests run.
 *
 * It is this repository's own entry (`src/worker/index.ts`) plus one plugin:
 * the default composition has no plugin with an editable panel, so without
 * it the record form — the largest piece of admin interface a plugin can
 * ask for — would never be opened by a browser. The plugin is registered
 * switched off, like any other, and the spec that needs it switches it on;
 * every other spec sees the site it always saw.
 *
 * It also brings a starter of its own, as a site may
 * (docs/ARCHITECTURE.md §11). The wizard spec checks that it is offered and
 * then installs the official one, so the site the other specs see is still
 * the one they always saw.
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
  starters: [
    {
      id: 'e2e-shop',
      name: 'A shop this site brought',
      description: 'One product and a catalog item for it.',
      theme: 'atelier',
      plugins: ['catalog'],
      settings: {
        kinds: { page: { base: '' }, product: { base: 'products' } },
        nav: {},
        themeOptions: {},
        tagline: '',
      },
      documents: [
        {
          kind: 'product',
          slug: 'sample-bar',
          markdown: '---\ntitle: Sample bar\n---\n\nA bar.',
        },
      ],
      records: [
        {
          plugin: 'catalog',
          panel: 'items',
          values: {
            name: 'Sample bar',
            code: 'SAMPLE-BAR',
            status: 'active',
            price: { amount: 1000, currency: 'USD' },
          },
        },
      ],
    },
  ],
});
