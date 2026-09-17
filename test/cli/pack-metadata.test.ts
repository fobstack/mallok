import { describe, expect, it } from 'vitest';
import { parsePackMetadata } from '../../scripts/pack-metadata.mjs';

const valid = {
  filename: 'mallok-0.1.0-rc.5.tgz',
  size: 123,
  unpackedSize: 456,
  integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
  shasum: 'a'.repeat(40),
};

function parse(value: unknown, actualSize = valid.size) {
  return () =>
    parsePackMetadata(JSON.stringify([value]), valid.filename, actualSize);
}

describe('npm pack metadata', () => {
  it('accepts one complete record whose byte size matches the candidate', () => {
    expect(
      parsePackMetadata(JSON.stringify([valid]), valid.filename, 123),
    ).toEqual(valid);
  });

  it.each([
    ['invalid JSON', '{', /invalid JSON/],
    ['a non-array result', '{}', /exactly one/],
    ['no result', '[]', /exactly one/],
    ['multiple results', JSON.stringify([valid, valid]), /exactly one/],
  ])('rejects %s', (_name, stdout, message) => {
    expect(() => parsePackMetadata(stdout, valid.filename, 123)).toThrow(
      message,
    );
  });

  it.each([
    ['filename', { ...valid, filename: 'other.tgz' }, /expected/],
    ['zero size', { ...valid, size: 0 }, /invalid size/],
    ['fractional size', { ...valid, size: 1.5 }, /invalid size/],
    ['wrong size', valid, /candidate has/, 124],
    [
      'missing unpacked size',
      { ...valid, unpackedSize: undefined },
      /invalid unpackedSize/,
    ],
    [
      'zero unpacked size',
      { ...valid, unpackedSize: 0 },
      /invalid unpackedSize/,
    ],
    [
      'wrong integrity algorithm',
      { ...valid, integrity: `sha256-${'a'.repeat(64)}` },
      /invalid integrity/,
    ],
    [
      'truncated integrity',
      { ...valid, integrity: 'sha512-YQ==' },
      /invalid integrity/,
    ],
    [
      'noncanonical integrity',
      { ...valid, integrity: `${valid.integrity.slice(0, -2)}AA` },
      /invalid integrity/,
    ],
    [
      'uppercase shasum',
      { ...valid, shasum: 'A'.repeat(40) },
      /invalid shasum/,
    ],
    ['short shasum', { ...valid, shasum: 'a'.repeat(39) }, /invalid shasum/],
  ])('rejects %s', (_name, record, message, actualSize = 123) => {
    expect(parse(record, actualSize)).toThrow(message);
  });
});
