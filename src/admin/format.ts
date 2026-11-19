/**
 * Numbers, dates and durations in the interface language
 * (docs/ADMIN_I18N_AND_UI.md §5.4).
 *
 * Every formatter the admin uses goes through here, so none of them falls
 * back to the browser's own locale or to a hard-coded `'en'`. Plurals of a
 * unit ("1 minute", "2 minutes") come from `Intl` too, not from code.
 */

import { i18n } from '@lingui/core';

/** A count, grouped the way the interface language groups digits. */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(i18n.locale, options).format(value);
}

/** A moment, with date and time. */
export function formatDateTime(value: Date | string | number): string {
  return new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/** A day, without the time: "14 Nov 2026", "2026年11月14日". */
export function formatDate(value: Date | string | number): string {
  return new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

/**
 * A length of time in whole units: hours from an hour up, minutes from a
 * minute up, seconds below that.
 */
export function formatDuration(seconds: number): string {
  const [unit, amount] =
    seconds >= 3600
      ? (['hour', Math.round(seconds / 3600)] as const)
      : seconds >= 60
        ? (['minute', Math.round(seconds / 60)] as const)
        : (['second', seconds] as const);
  return new Intl.NumberFormat(i18n.locale, {
    style: 'unit',
    unit,
    unitDisplay: 'long',
  }).format(amount);
}
