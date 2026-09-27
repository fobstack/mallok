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
