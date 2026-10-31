import { describe, expect, it } from 'vitest';
import { normalizeSlugInput } from '../../src/admin/slug.js';

/**
 * The slug field is free text, and the server refuses anything `slugify` would
 * change. Without normalisation here, an operator types an ordinary heading,
 * writes a whole article and only then gets a 400 that does not say what to do
 * about it.
 */
describe('slug field normalisation', () => {
  it('leaves an empty field empty, so the title still derives the slug', () => {
    expect(normalizeSlugInput('')).toEqual({
      slug: '',
      usable: true,
      notice: null,
    });
  });

  it('accepts an already-canonical slug silently', () => {
    expect(normalizeSlugInput('astm-b265')).toEqual({
      slug: 'astm-b265',
      usable: true,
      notice: null,
    });
  });

  it.each([
    ['Hello World', 'hello-world'],
    ['ASTM B265', 'astm-b265'],
    ['grade-2_plate', 'grade-2-plate'],
    ['  Titanium  Plate  ', 'titanium-plate'],
  ])('normalises %j to %j and says so', (typed, expected) => {
    const result = normalizeSlugInput(typed);
    expect(result.slug).toBe(expected);
    expect(result.usable).toBe(true);
    expect(result.notice).toContain(expected);
  });

  it('keeps a value it cannot normalise, and explains why', () => {
    // Clearing the field would delete what the operator typed in front of
    // them; the site's own demo content uses pinyin slugs for this reason.
    const result = normalizeSlugInput('钛板');
    expect(result.slug).toBe('钛板');
    expect(result.usable).toBe(false);
    expect(result.notice).toMatch(/Latin/);
  });
});

describe('slug field normalisation with several segments (Task 50)', () => {
  it('accepts a nested slug as typed', () => {
    expect(normalizeSlugInput('crypto/crypto-quote')).toEqual({
      slug: 'crypto/crypto-quote',
      usable: true,
      notice: null,
    });
  });

  it('normalises each segment and drops empty ones', () => {
    const result = normalizeSlugInput('/Crypto//Crypto Quote/');
    expect(result).toMatchObject({ slug: 'crypto/crypto-quote', usable: true });
    expect(result.notice).toContain('crypto/crypto-quote');
  });

  it('keeps the first four segments and says why', () => {
    const result = normalizeSlugInput('a/b/c/d/e');
    expect(result).toMatchObject({ slug: 'a/b/c/d', usable: true });
    expect(result.notice).toContain('at most 4');
  });

  it('keeps a value with a segment it cannot spell, rather than drop it', () => {
    // `产品/x` would otherwise become `x`: a different address, silently.
    const result = normalizeSlugInput('产品/titanium-bar');
    expect(result).toEqual({
      slug: '产品/titanium-bar',
      usable: false,
      notice: expect.stringContaining('Segment 1 ("产品")'),
    });
  });

  it("refuses a list's page address before the server does", () => {
    for (const typed of ['page/2', 'Page/2/intro']) {
      const result = normalizeSlugInput(typed);
      expect(result.usable, typed).toBe(false);
      expect(result.slug, typed).toBe(typed);
      expect(result.notice, typed).toContain('list');
    }
    // `page` alone, or followed by a word, is an ordinary slug.
    expect(normalizeSlugInput('page/intro').usable).toBe(true);
  });
});
