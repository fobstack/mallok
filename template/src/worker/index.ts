/**
 * This site's Worker.
 *
 * Everything Mallok does — routing, rendering, the management API, the admin,
 * media, SEO, migrations, the edge cache — comes from the `mallok` package at
 * the exact version in `package.json`. Upgrading is `mallok upgrade --to
 * <version>`, not a merge.
 *
 * What belongs to you is on this page: which theme renders the site, and
 * which plugins are compiled into it. Both are build-time choices — changing
 * either one needs a deploy, and the admin says so rather than pretending it
 * can hot-swap them.
 */

import { atelier, createMallok, inquiry } from 'mallok/worker';

export default createMallok({
  // One of: atelier, folio, gazette, journal, manual. Or your own, built with
  // `defineTheme` — see `README.md`.
  theme: atelier,
  // Remove `inquiry` and the contact form stops being served. Add your own
  // plugins from `src/plugins/`.
  plugins: [inquiry],
});
