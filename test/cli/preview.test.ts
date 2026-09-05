import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadThemeFromDisk, previewBundle } from '../../src/cli/preview.js';
import type { Bundle } from '../../src/cli/scan.js';
import { renderFragment, splitFrontmatter } from '../../src/core/index.js';

/**
 * `AC-CLI-03` (docs/ACCEPTANCE.md §10): `mallok preview` and the production
 * save path both call `renderFragment` from `src/core`, but nothing
 * previously asserted the two calls actually agree on the same input — only
 * that they share code. This pins the claim the corrected wording makes: the
 * same Markdown produces the same body fragment in both places.
 */
describe('mallok preview', () => {
  it('renders the same body fragment production would, for the same Markdown', async () => {
    const { manifest, files } = await loadThemeFromDisk(
      join(process.cwd(), 'src/themes/atelier'),
    );
    const markdown = [
      '---',
      'title: Preview parity check',
      'description: Confirms the CLI and the Worker render identically.',
      '---',
      '',
      'Body **text** with a [link](https://example.com).',
    ].join('\n');
    const bundle: Bundle = {
      name: 'preview-parity',
      dir: 'preview-parity',
      kind: 'article',
      documents: [
        {
          locale: 'en',
          fileName: 'index.md',
          markdown,
          assets: new Map(),
          missing: [],
        },
      ],
      identity: null,
      unfilledSlots: [],
    };
    const outFile = join(tmpdir(), `mallok-preview-test-${Date.now()}.html`);

    try {
      const html = await previewBundle(bundle, {
        manifest,
        files,
        siteName: 'Preview Site',
        defaultLocale: 'en',
        outFile,
      });

      // The exact call the Worker's save path makes
      // (src/worker/admin-content.ts) for byte-identical input.
      const { data, body } = splitFrontmatter(markdown);
      const direct = await renderFragment({
        body,
        frontmatter: data,
        assets: {},
        mediaBaseUrl: '',
      });

      expect(html).toContain(direct.html);
    } finally {
      await rm(outFile, { force: true });
    }
  });
});
