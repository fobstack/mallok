import { i18n } from '@lingui/core';
import { afterAll, describe, expect, it } from 'vitest';
import { formatDuration, formatNumber } from '../../src/admin/format.js';

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
});
