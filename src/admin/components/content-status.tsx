/**
 * A content item's status, named and coloured the same way in the list and
 * in the editor (docs/ADMIN_I18N_AND_UI.md, U4 and U8).
 */

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { JSX } from 'react';
import { StatusBadge } from './page.js';

/** A status's badge colour: live is good, waiting is a caution. */
const STATUS_TONE: Readonly<Record<string, 'ok' | 'warn'>> = {
  published: 'ok',
  scheduled: 'warn',
};

/** The statuses an item can have, by their stored value. */
export const STATUS_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  published: msg`Published`,
  draft: msg`Draft`,
  scheduled: msg`Scheduled`,
};

/** A status as a badge; an unknown one is shown as stored. */
export function ContentStatusBadge({
  status,
}: {
  readonly status: string;
}): JSX.Element {
  const label = STATUS_LABELS[status];
  return (
    <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>
      {label === undefined ? status : i18n._(label)}
    </StatusBadge>
  );
}
