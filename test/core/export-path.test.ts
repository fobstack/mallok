import { describe, expect, it } from 'vitest';
import { exportPathKey, exportPathProblem } from '../../src/core/index.js';

describe('portable export paths', () => {
  it('accepts nested Unicode names and identifies filesystem aliases', () => {
    expect(
      exportPathProblem('content/article/café/images/产品图.webp'),
    ).toBeNull();
    expect(exportPathKey('Café/FILE.md')).toBe(
      exportPathKey('Cafe\u0301/file.md'),
    );
  });

  it.each([
    ['', 'empty'],
    ['../outside', 'dot segment'],
    ['a\\outside', 'backslash'],
    ['/outside', 'absolute'],
    ['C:/outside', 'absolute'],
    ['a//b', 'empty segment'],
    ['a/end. ', 'trailing dot or space'],
    ['archive/CONOUT$', 'reserved Windows filename'],
    ['archive/COM¹.txt', 'reserved Windows filename'],
    ['archive/__proto__', 'reserved archive key'],
    [`bad-${String.fromCharCode(0xd800)}.txt`, 'portable across filesystems'],
    [`${'a'.repeat(241)}.txt`, 'segment longer'],
  ])('rejects %j', (path, reason) => {
    expect(exportPathProblem(path)).toContain(reason);
  });
});
