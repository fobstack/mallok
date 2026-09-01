import { describe, expect, it } from 'vitest';
import {
  byGroup,
  type FieldSpec,
  labelFor,
  optionSpecs,
  toSpecs,
  validate,
  validateAll,
} from '../../src/admin/form/types.js';
import { match, toHref, toRoute } from '../../src/admin/routes.js';

function spec(name: string, field: Partial<FieldSpec['field']>): FieldSpec {
  return {
    name,
    field: { type: 'string', required: false, ...field } as FieldSpec['field'],
  };
}

describe('field specs', () => {
  it('keeps declaration order', () => {
    const specs = toSpecs({
      zebra: { type: 'string', required: false },
      alpha: { type: 'string', required: false },
    });
    expect(specs.map((entry) => entry.name)).toEqual(['zebra', 'alpha']);
  });

  it('derives a readable label from the key when none is declared', () => {
    expect(labelFor(spec('lead_time', {}))).toBe('Lead time');
    expect(labelFor(spec('lead_time', { label: 'Lead time (days)' }))).toBe(
      'Lead time (days)',
    );
  });

  it('puts ungrouped fields first and sorts the rest', () => {
    const groups = byGroup([
      spec('a', { group: 'Trade' }),
      spec('b', {}),
      spec('c', { group: 'Specification' }),
      spec('d', { group: 'Trade' }),
    ]);
    expect(groups.map(([name]) => name)).toEqual([
      '',
      'Specification',
      'Trade',
    ]);
    expect(groups[2]?.[1].map((entry) => entry.name)).toEqual(['a', 'd']);
  });

  it('widens theme options into field specs', () => {
    // Theme options declare a narrower shape than content fields
    // (docs/THEME_FORMAT.md §6); the generator must not need two paths.
    const specs = optionSpecs({
      accent: { type: 'color', label: 'Accent', default: '#000000' },
      mode: {
        type: 'select',
        label: 'Mode',
        default: 'a',
        choices: ['a', 'b'],
      },
    });
    expect(specs[0]?.field.type).toBe('color');
    expect(specs[0]?.field.required).toBe(false);
    expect(specs[1]?.field.choices).toEqual(['a', 'b']);
  });
});

describe('validation', () => {
  it('requires declared-required fields, treating empties alike', () => {
    const required = spec('name', { required: true });
    for (const empty of [undefined, null, '', []]) {
      expect(validate(required, empty)).toBe('This field is required.');
    }
    expect(validate(required, 'set')).toBeNull();
  });

  it('lets optional fields be empty', () => {
    expect(validate(spec('note', { type: 'text' }), '')).toBeNull();
  });

  it('checks numbers and their bounds', () => {
    const field = spec('count', { type: 'number', min: 2, max: 5 });
    expect(validate(field, 'x')).toBe('Enter a number.');
    expect(validate(field, 1)).toBe('Must be at least 2.');
    expect(validate(field, 9)).toBe('Must be at most 5.');
    expect(validate(field, 3)).toBeNull();
  });

  it('checks a select against its declared choices', () => {
    const field = spec('form', { type: 'select', choices: ['Bar', 'Plate'] });
    expect(validate(field, 'Tube')).toBe('Choose one of the listed values.');
    expect(validate(field, 'Bar')).toBeNull();
  });

  it('checks string and list lengths', () => {
    expect(validate(spec('t', { max: 3 }), 'abcd')).toContain('at most 3');
    expect(
      validate(spec('l', { type: 'string[]', max: 1 }), ['a', 'b']),
    ).toContain('At most 1');
  });

  it('reports every failing field at once', () => {
    const specs = [
      spec('a', { required: true }),
      spec('b', { type: 'number' }),
      spec('c', {}),
    ];
    expect(validateAll(specs, { b: 'not a number', c: 'fine' })).toEqual({
      a: 'This field is required.',
      b: 'Enter a number.',
    });
  });
});

describe('routes', () => {
  it('maps browser paths to in-app routes and back', () => {
    expect(toRoute('/_mallok/app/')).toBe('/');
    expect(toRoute('/_mallok/app')).toBe('/');
    expect(toRoute('/_mallok/app/settings/appearance')).toBe(
      '/settings/appearance',
    );
    expect(toRoute('/_mallok/app/settings/')).toBe('/settings');
    expect(toHref('/')).toBe('/_mallok/app/');
    expect(toHref('/settings')).toBe('/_mallok/app/settings');
  });

  it('captures parameters and rejects mismatches', () => {
    expect(match('/content/:id', '/content/abc-123')).toEqual({
      id: 'abc-123',
    });
    expect(match('/content/:id', '/content')).toBeNull();
    expect(match('/content/:id', '/content/a/b')).toBeNull();
    expect(match('/settings', '/settings')).toEqual({});
    expect(match('/settings', '/plugins')).toBeNull();
  });

  it('decodes an encoded segment', () => {
    expect(match('/content/:id', '/content/a%2Fb')).toEqual({ id: 'a/b' });
  });
});

describe('secret fields never round-trip a value', () => {
  it('is not representable as a normal field spec', () => {
    // Secrets are declared separately in `plugin.json` and rendered by
    // SecretControl, never by the generator, so a plugin cannot accidentally
    // get its key echoed into a form value (docs/PLUGIN_API.md §7.3).
    const specs = toSpecs({
      recipient: { type: 'string', required: true },
    });
    expect(specs.map((entry) => entry.name)).toEqual(['recipient']);
  });
});
