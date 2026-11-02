/**
 * The "it saved" confirmation, told honestly.
 *
 * Whether a saved change is visible to a reader *now* depends on whether a
 * cache-purge token is configured. Saying "live now" when it is not would be
 * the kind of small lie the product is built to avoid
 * (docs/ADMIN.md §5, docs/ARCHITECTURE.md §6.2).
 */

import { Clock } from 'lucide-react';
import type { JSX } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { liveDelay } from '../state.js';
import { Code, StatusBadge } from './page.js';

/** Human-readable form of a cache lifetime. */
function humanize(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.round(seconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

export function SavedNote(): JSX.Element {
  const delay = liveDelay.value;
  if (delay.instant) {
    return <StatusBadge tone="ok">Saved — live now</StatusBadge>;
  }
  return (
    <StatusBadge
      tone="warn"
      title="Configure a cache-purge token to make saves appear immediately."
    >
      Saved — visitors see it within {humanize(delay.seconds)}
    </StatusBadge>
  );
}

/**
 * The standing banner shown while no purge token is configured. It stays up
 * rather than appearing once, because the condition is permanent until
 * someone configures the token.
 */
export function PurgeNotice(): JSX.Element | null {
  const delay = liveDelay.value;
  if (delay.instant) {
    return null;
  }
  return (
    // A standing note, not an alert: it is true from the first render until
    // someone configures the token, and must not interrupt a screen reader.
    <Alert role="note" className="mx-4 mt-4 w-auto">
      <Clock />
      <AlertTitle>
        Changes reach visitors within {humanize(delay.seconds)}
      </AlertTitle>
      <AlertDescription>
        <p>
          No cache-purge token is configured, so a saved change reaches visitors
          only after the cached page expires. This is a working site, not a
          broken one — add <Code>CF_API_TOKEN</Code> and <Code>CF_ZONE_ID</Code>{' '}
          as Worker secrets to get instant publishing.
        </p>
      </AlertDescription>
    </Alert>
  );
}
