import { i18n } from '@lingui/core';
import { afterAll, describe, expect, it } from 'vitest';
import { formatDuration, formatNumber } from '../../src/admin/format.js';
import { formatLastEdited } from '../../src/admin/format-relative.js';

/**
 * Formatting follows the interface language, never the machine's locale,
 * and a unit's plural comes from `Intl`: the old hand-written "1 minute" /
 * "N minutes" had no answer for a language without that distinction.
 */
describe('formatting in the interface language', () => {
  afterAll(() => {
    i18n.activate('en');
  });

  it('writes durations in English with the right plural', () => {
    i18n.loadAndActivate({ locale: 'en', messages: {} });
    expect(formatDuration(60)).toBe('1 minute');
    expect(formatDuration(300)).toBe('5 minutes');
    expect(formatDuration(7200)).toBe('2 hours');
    expect(formatDuration(30)).toBe('30 seconds');
  });

  it('writes durations and numbers in Simplified Chinese', () => {
    i18n.loadAndActivate({ locale: 'zh-CN', messages: {} });
    expect(formatDuration(300)).toBe('5分钟');
    expect(formatNumber(600000)).toBe('600,000');
  });

  it('says when something was edited the way a list of recent work reads', () => {
    const now = new Date(2026, 10, 19, 15, 0);
    i18n.loadAndActivate({ locale: 'en', messages: {} });
    expect(formatLastEdited(new Date(2026, 10, 19, 7, 12), now)).toBe(
      'Today 07:12',
    );
    expect(formatLastEdited(new Date(2026, 10, 18, 23, 59), now)).toBe(
      'Yesterday 23:59',
    );
    expect(formatLastEdited(new Date(2026, 10, 16, 9, 0), now)).toBe(
      '3 days ago',
    );
    expect(formatLastEdited(new Date(2026, 10, 12, 9, 0), now)).toBe(
      'Nov 12, 2026',
    );
    i18n.loadAndActivate({ locale: 'zh-CN', messages: {} });
    expect(formatLastEdited(new Date(2026, 10, 19, 7, 12), now)).toBe(
      '今天 07:12',
    );
    expect(formatLastEdited(new Date(2026, 10, 18, 8, 5), now)).toBe(
      '昨天 08:05',
    );
    expect(formatLastEdited(new Date(2026, 10, 16, 9, 0), now)).toBe('3天前');
  });
});
