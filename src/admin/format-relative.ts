/**
 * Relative dates for lists of recent work. A module of its own, not part of
 * `format.ts`: the shell imports that one, and what only lists use should
 * not ride on the first load (docs/ADMIN.md §13).
 */

import { i18n } from '@lingui/core';
import { formatDate } from './format.js';

/**
 * When something was last changed, the way a list of recent work reads:
 * "Today 07:12", "Yesterday 18:40", "3 days ago" within the week, then the
 * date (docs/ADMIN_SIMPLE.md, G22). Days are calendar days where the
 * operator is, not 24-hour spans.
 */
export function formatLastEdited(
  value: Date | string | number,
  now: Date = new Date(),
): string {
  const then = new Date(value);
  const startOf = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days < 0 || days > 6) {
    return formatDate(then);
  }
  const relative = new Intl.RelativeTimeFormat(i18n.locale, {
    numeric: 'auto',
  }).format(-days, 'day');
  const word =
    relative.charAt(0).toLocaleUpperCase(i18n.locale) + relative.slice(1);
  if (days > 1) {
    return word;
  }
  const time = new Intl.DateTimeFormat(i18n.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(then);
  return `${word} ${time}`;
}
