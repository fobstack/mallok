/**
 * Where island scripts land in a theme's own document.
 *
 * Mallok's themes emit the whole `<html>`, so the runtime cannot wrap the page
 * in a shell of its own — it hands the document back and Mallok places the
 * island scripts. Appending them to the end of the string would put them after
 * `</html>`, outside the document.
 */

import { describe, expect, it } from 'vitest';
import type {
  DocumentParts,
  PageContext,
} from '../../src/runtime/core/index.js';
import type { PublicLocals } from '../../src/worker/pages/context.js';
import { renderDocument } from '../../src/worker/pages/runtime.js';

/** A theme document of the shape `layouts/base.liquid` produces. */
const THEME_DOCUMENT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><title>A page</title></head>',
  '<body>',
  '  <header>Site</header>',
  '  <main><p>Body copy.</p></main>',
  '  <footer>Footer</footer>',
  '</body>',
  '</html>',
].join('\n');

function parts(islands: string): DocumentParts<never, PublicLocals> {
  return {
    head: '',
    body: THEME_DOCUMENT,
    islands,
    islandUses: [],
    locale: 'en',
    data: {} as never,
    context: {} as PageContext<PublicLocals>,
  };
}

const ISLAND = '<script type="module" src="/_islands/quote-B1x.js"></script>';

describe('island placement in a complete theme document', () => {
  it('puts the script inside the document, before </body>', async () => {
    const html = await renderDocument(parts(ISLAND));

    expect(html).toContain(ISLAND);
    // The two things that make this correct rather than merely present.
    expect(html.indexOf(ISLAND)).toBeLessThan(html.indexOf('</body>'));
    expect(html.endsWith('</html>')).toBe(true);
    // Nothing may follow the document's close.
    expect(html.slice(html.indexOf('</html>') + '</html>'.length).trim()).toBe(
      '',
    );
    // The theme's own markup is untouched and still in order.
    expect(html).toContain('<footer>Footer</footer>');
    expect(html.indexOf('<footer>')).toBeLessThan(html.indexOf(ISLAND));
  });

  it('leaves a page that used no island byte-identical', async () => {
    // Zero client JavaScript on a visitor page is a product promise
    // (`AC-INV-08`), so "no island" must mean "not one byte added".
    expect(await renderDocument(parts(''))).toBe(THEME_DOCUMENT);
  });

  it('places the script before the document’s own </body>, not an earlier one', async () => {
    // Escaped `</body>` in the content must not attract the scripts.
    const withText = THEME_DOCUMENT.replace(
      '<p>Body copy.</p>',
      '<p>The tag &lt;/body&gt; is written like this.</p>',
    );
    const html = await renderDocument({ ...parts(ISLAND), body: withText });

    expect(html.indexOf(ISLAND)).toBeGreaterThan(html.indexOf('<footer>'));
    expect(html.endsWith('</html>')).toBe(true);
  });
});
