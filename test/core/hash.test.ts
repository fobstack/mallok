import { describe, expect, it } from 'vitest';
import { sha256Hex, stableStringify } from '../../src/core/index.js';

describe('sha256Hex', () => {
  it('matches a known digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('stableStringify', () => {
  it('sorts keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe(
      '{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});
