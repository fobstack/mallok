/**
 * The "it saved" confirmation, told honestly.
 *
 * Whether a saved change is visible to a reader *now* depends on whether a
 * cache-purge token is configured. Saying "live now" when it is not would be
 * the kind of small lie the product is built to avoid
 * (docs/ADMIN.md §5, docs/ARCHITECTURE.md §6.2).
 */

import { Trans, useLingui } from '@lingui/react/macro';
import { Clock } from 'lucide-react';
import type { JSX } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDuration } from '../format.js';
import { useLiveDelay } from '../queries.js';
import { Code, StatusBadge } from './page.js';

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

/**
 * The standing banner shown while no purge token is configured. It stays up
 * rather than appearing once, because the condition is permanent until
 * someone configures the token.
 */
export function PurgeNotice(): JSX.Element | null {
  const delay = useLiveDelay();
  if (delay.instant) {
    return null;
  }
  const within = formatDuration(delay.seconds);
  return (
    // A standing note, not an alert: it is true from the first render until
    // someone configures the token, and must not interrupt a screen reader.
    <Alert role="note" className="mx-4 mt-4 w-auto">
      <Clock />
      <AlertTitle>
        <Trans>Changes reach visitors within {within}</Trans>
      </AlertTitle>
      <AlertDescription>
        <p>
          <Trans>
            No cache-purge token is configured, so a saved change reaches
            visitors only after the cached page expires. This is a working site,
            not a broken one — add <Code>CF_API_TOKEN</Code> and{' '}
            <Code>CF_ZONE_ID</Code> as Worker secrets to get instant publishing.
          </Trans>
        </p>
      </AlertDescription>
    </Alert>
  );
}
