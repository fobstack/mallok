/**
 * What an empty list shows: what is empty, and the one action that fills it
 * (docs/ADMIN_I18N_AND_UI.md, U5 and U19).
 *
 * A plain muted block, not a dashed one: a dashed border is what the media
 * library's drop zone looks like, and an empty list is not somewhere to drop
 * a file.
 */

import type { JSX, ReactNode } from 'react';

/** An empty list's message, with the action that fills it when there is one. */
export function EmptyState({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/50 px-4 py-8 text-center text-sm text-muted-foreground">
      <p>{children}</p>
      {action === undefined ? null : action}
    </div>
  );
}
