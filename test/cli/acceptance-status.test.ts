import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const acceptance = readFileSync('docs/ACCEPTANCE.md', 'utf8');
const testing = readFileSync('docs/TESTING.md', 'utf8');

const STATUS =
  /`(NOT_AVAILABLE|NOT_RUN|FAILED|VERIFIED_LOCAL|VERIFIED_STAGING|VERIFIED_HUMAN|STALE|ACCEPTED)`/;

function currentCriteria(): Array<{ id: string; status: string }> {
  const start = acceptance.indexOf('## 3. AC-DEPLOY');
  const end = acceptance.indexOf('## 12. Blockers');
  if (start === -1 || end <= start) {
    throw new Error(
      'Could not locate the current acceptance-criterion tables.',
    );
  }

  return acceptance
    .slice(start, end)
    .split('\n')
    .filter((line) => /^\| `AC-[A-Z]+-[0-9]+[a-z]?` \|/.test(line))
    .map((line) => {
      const id = line.match(/^\| `(AC-[A-Z]+-[0-9]+[a-z]?)` \|/)?.[1];
      const status = line.match(STATUS)?.[1];
      if (id === undefined || status === undefined) {
        throw new Error(`Criterion row has no canonical status: ${line}`);
      }
      return { id, status };
    });
}

describe('acceptance status accounting', () => {
  it('uses the one eight-value project vocabulary', () => {
    expect(testing).toContain('Only eight statuses are permitted');
    expect(
      [...testing.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]),
    ).toEqual([
      'NOT_AVAILABLE',
      'NOT_RUN',
      'FAILED',
      'VERIFIED_LOCAL',
      'VERIFIED_STAGING',
      'VERIFIED_HUMAN',
      'STALE',
      'ACCEPTED',
    ]);
  });

  it('keeps the current tables unique and their summary arithmetically honest', () => {
    const rows = currentCriteria();
    expect(rows).toHaveLength(74);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length);

    const count = (status: string): number =>
      rows.filter((row) => row.status === status).length;
    expect(count('VERIFIED_LOCAL')).toBe(59);
    expect(count('STALE')).toBe(5);
    expect(count('NOT_RUN')).toBe(9);
    expect(count('NOT_AVAILABLE')).toBe(1);
    expect(
      rows.filter(({ status }) =>
        ['FAILED', 'VERIFIED_STAGING', 'VERIFIED_HUMAN', 'ACCEPTED'].includes(
          status,
        ),
      ),
    ).toEqual([]);

    expect(acceptance).toContain(
      '| **Total** | **74** | **59** | **5** | **9** | **1** |',
    );
  });
});
