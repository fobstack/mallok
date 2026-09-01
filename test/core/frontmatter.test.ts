import { describe, expect, it } from 'vitest';
import {
  FrontmatterError,
  joinFrontmatter,
  parseFrontmatter,
  splitFrontmatter,
} from '../../src/core/index.js';

describe('splitFrontmatter', () => {
  it('splits a document with front matter', () => {
    const doc = splitFrontmatter(
      '---\ntitle: Hello\ntags: [a, b]\n---\n\nBody\n',
    );
    expect(doc.frontmatterText).toBe('title: Hello\ntags: [a, b]');
    expect(doc.data).toEqual({ title: 'Hello', tags: ['a', 'b'] });
    expect(doc.body).toBe('\nBody\n');
  });

  it('treats a document without delimiters as body only', () => {
    const doc = splitFrontmatter('# Title\n\nText');
    expect(doc.frontmatterText).toBeNull();
    expect(doc.data).toEqual({});
    expect(doc.body).toBe('# Title\n\nText');
  });

  it('treats an unterminated block as body', () => {
    const doc = splitFrontmatter('---\ntitle: x\nno closing');
    expect(doc.frontmatterText).toBeNull();
    expect(doc.body).toBe('---\ntitle: x\nno closing');
  });

  it('supports CRLF line endings', () => {
    const doc = splitFrontmatter('---\r\ntitle: x\r\n---\r\nbody');
    expect(doc.data).toEqual({ title: 'x' });
    expect(doc.body).toBe('body');
  });
});

describe('parseFrontmatter', () => {
  it('rejects duplicate keys', () => {
    expect(() => parseFrontmatter('a: 1\na: 2')).toThrow(FrontmatterError);
  });

  it('rejects aliases', () => {
    expect(() => parseFrontmatter('a: &x 1\nb: *x')).toThrow(FrontmatterError);
  });

  it('rejects non-mapping documents', () => {
    expect(() => parseFrontmatter('- a\n- b')).toThrow(FrontmatterError);
  });

  it('returns an empty object for blank input', () => {
    expect(parseFrontmatter('   \n')).toEqual({});
  });
});

describe('joinFrontmatter', () => {
  it('produces a document splitFrontmatter reads back unchanged', () => {
    const data = {
      title: 'Grade 5 bar',
      grade: 'Ti-6Al-4V',
      specs: { density: '4.43' },
      tags: ['bar', 'aerospace'],
      draft: false,
      count: 12,
    };
    // `splitFrontmatter` hands back the body including the blank line that
    // follows the closing delimiter, so that is what round-trips.
    const body = '\nThe body.\n\n## A heading\n\nMore text.\n';
    const round = splitFrontmatter(joinFrontmatter(data, body));
    expect(round.data).toEqual(data);
    expect(round.body).toBe(body);
  });

  it('is the exact inverse of splitFrontmatter for any document', () => {
    const source =
      '---\ntitle: Round trip\ntags:\n  - one\n  - two\n---\n\nBody text.\n';
    const split = splitFrontmatter(source);
    expect(joinFrontmatter(split.data, split.body)).toBe(source);
  });

  it('emits no front matter block for an empty map', () => {
    expect(joinFrontmatter({}, 'Just a body.')).toBe('Just a body.');
  });

  it('drops undefined values rather than writing null', () => {
    const joined = joinFrontmatter(
      { title: 'Kept', removed: undefined },
      'Body.',
    );
    expect(joined).not.toContain('removed');
    expect(splitFrontmatter(joined).data).toEqual({ title: 'Kept' });
  });

  it('quotes values that would otherwise change meaning', () => {
    // A title like "2026-08-30" must come back as a string, not a date, and
    // one starting with "#" must not become a comment.
    const data = { title: '2026-08-30', note: '# not a heading', yes: 'true' };
    expect(splitFrontmatter(joinFrontmatter(data, 'Body.')).data).toEqual(data);
  });

  it('does not accumulate blank lines when re-joined repeatedly', () => {
    // The editor re-serialises on every field edit; the document must not
    // grow (docs/ADMIN.md §6.2).
    let text = joinFrontmatter({ title: 'A' }, 'Body.');
    for (let round = 0; round < 5; round++) {
      const split = splitFrontmatter(text);
      text = joinFrontmatter(split.data, split.body);
    }
    expect(text).toBe(joinFrontmatter({ title: 'A' }, 'Body.'));
  });
});
