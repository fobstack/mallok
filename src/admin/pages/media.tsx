/** The media library as its own page (docs/ADMIN.md §8). */

import { useLingui } from '@lingui/react/macro';
import type { JSX } from 'react';
import { MediaLibrary } from '../components/media-library.js';
import { Page, PageHeader } from '../components/page.js';

export function MediaPage(): JSX.Element {
  const { t } = useLingui();
  return (
    <Page width="list">
      <PageHeader
        title={t`Media`}
        lede={t`Photos and files used on your site.`}
      />
      <MediaLibrary />
    </Page>
  );
}
