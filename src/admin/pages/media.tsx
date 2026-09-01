/** The media library as its own page (docs/ADMIN.md §8). */

import type { JSX } from 'preact';
import { MediaLibrary } from '../components/media-library.js';

export function MediaPage(): JSX.Element {
  return (
    <div class="page">
      <header class="page-head">
        <h1>Media</h1>
        <p class="lede">
          Files are stored by the hash of the original, so uploading the same
          image twice costs nothing and never creates a duplicate.
        </p>
      </header>
      <MediaLibrary />
    </div>
  );
}
