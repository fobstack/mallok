/** The media library as its own page (docs/ADMIN.md §8). */

import type { JSX } from 'react';
import { MediaLibrary } from '../components/media-library.js';
import { Page, PageHeader } from '../components/page.js';

export function MediaPage(): JSX.Element {
  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Media"
        lede="Files are stored by the hash of the original, so uploading the same image twice costs nothing and never creates a duplicate."
      />
      <MediaLibrary />
    </Page>
  );
}
