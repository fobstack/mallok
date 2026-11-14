/**
 * The "it saved" confirmation, told honestly.
 *
 * Whether a saved change is visible to a reader *now* depends on whether a
 * cache-purge token is configured. Saying "live now" when it is not would be
 * the kind of small lie the product is built to avoid
 * (docs/ADMIN.md §5, docs/ARCHITECTURE.md §6.2).
 */

import { Trans, useLingui } from '@lingui/react/macro';
import type { JSX } from 'react';
import { formatDuration } from '../format.js';
import { useLiveDelay } from '../queries.js';
import { StatusBadge } from './page.js';

export function SavedNote(): JSX.Element {
  const delay = useLiveDelay();
  const { t } = useLingui();
  if (delay.instant) {
    return (
      <StatusBadge tone="ok">
        <Trans>Saved — live now</Trans>
      </StatusBadge>
    );
  }
  const within = formatDuration(delay.seconds);
  return (
    <StatusBadge
      tone="warn"
      title={t`Configure a cache-purge token to make saves appear immediately.`}
    >
      <Trans>Saved — visitors see it within {within}</Trans>
    </StatusBadge>
  );
}
