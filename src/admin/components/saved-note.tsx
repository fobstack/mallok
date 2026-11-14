/**
 * The "it saved" confirmation, told honestly.
 *
 * Whether a saved change is visible to a reader *now* depends on whether a
 * cache-purge token is configured. Saying "live now" when it is not would be
 * the kind of small lie the product is built to avoid
 * (docs/ADMIN.md §5, docs/ARCHITECTURE.md §6.2).
 */

import { Trans } from '@lingui/react/macro';
import type { JSX } from 'react';
import { formatDuration } from '../format.js';
import { useLiveDelay } from '../queries.js';
import { StatusBadge } from './page.js';

/**
 * Success reads as success: always the green "Saved", with when visitors
 * see it as plain text after it. A delay is how this site works without a
 * purge token, not a problem with the save, so it is not drawn as a warning
 * (docs/ADMIN_I18N_AND_UI.md, U15).
 */
export function SavedNote(): JSX.Element {
  const delay = useLiveDelay();
  return (
    <span role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge tone="ok">
        <Trans>Saved</Trans>
      </StatusBadge>
      <span className="text-muted-foreground">
        {delay.instant ? (
          <Trans>Visitors see it now.</Trans>
        ) : (
          <DelayNote seconds={delay.seconds} />
        )}
      </span>
    </span>
  );
}

function DelayNote({ seconds }: { readonly seconds: number }): JSX.Element {
  const within = formatDuration(seconds);
  return <Trans>Visitors see it within {within}.</Trans>;
}
