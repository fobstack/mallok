/**
 * The form generator's contract.
 *
 * One generator serves four callers (docs/ADMIN.md §7): content fields from
 * `theme.json`, theme options, plugin settings and plugin panel filters.
 * Adding a field type here is the only way any of them gains a control —
 * theme and plugin authors never write admin code.
 */

import type { ThemeField, ThemeManifest } from '../../core/index.js';

/** A field declaration plus the key it is stored under. */
export interface FieldSpec {
  readonly name: string;
  readonly field: ThemeField;
}

/** What every control receives. */
export interface ControlProps {
  readonly spec: FieldSpec;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  /** Set when the value failed validation. */
  readonly error?: string;
  readonly id: string;
}

/**
 * Turns a theme's `options` into field specs.
 *
 * Theme options declare a narrower shape than content fields (no `required`,
 * `group` or `help`), so they are widened here rather than the generator
 * carrying two code paths (docs/THEME_FORMAT.md §6).
 */
export function optionSpecs(options: ThemeManifest['options']): FieldSpec[] {
  return Object.entries(options).map(([name, option]) => ({
    name,
    field: {
      type: option.type,
      label: option.label,
      required: false,
      default: option.default,
      ...(option.choices === undefined ? {} : { choices: option.choices }),
    } as ThemeField,
  }));
}

/** Turns a declaration map into an ordered list, declaration order kept. */
export function toSpecs(
  fields: Readonly<Record<string, ThemeField>>,
): FieldSpec[] {
  return Object.entries(fields).map(([name, field]) => ({ name, field }));
}

/** Groups specs by their `group`, ungrouped fields first under ''. */
export function byGroup(specs: readonly FieldSpec[]): [string, FieldSpec[]][] {
  const groups = new Map<string, FieldSpec[]>();
  for (const spec of specs) {
    const key = spec.field.group ?? '';
    const list = groups.get(key) ?? [];
    list.push(spec);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === '' ? -1 : b === '' ? 1 : a.localeCompare(b),
  );
}

/** A human label for a field, falling back to a readable form of its key. */
export function labelFor(spec: FieldSpec): string {
  if (spec.field.label !== undefined && spec.field.label !== '') {
    return spec.field.label;
  }
  return spec.name
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

/**
 * Validates one value against its declaration and returns an error message,
 * or `null`. This mirrors the server's zod checks so the user hears about a
 * problem before a round trip — the server remains the authority.
 */
export function validate(spec: FieldSpec, value: unknown): string | null {
  const { field } = spec;
  const empty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  if (field.required && empty) {
    return 'This field is required.';
  }
  if (empty) {
    return null;
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'Enter a number.';
    }
    if (field.min !== undefined && value < field.min) {
      return `Must be at least ${field.min}.`;
    }
    if (field.max !== undefined && value > field.max) {
      return `Must be at most ${field.max}.`;
    }
    return null;
  }
  if (field.type === 'select' && typeof value === 'string') {
    return (field.choices ?? []).includes(value)
      ? null
      : 'Choose one of the listed values.';
  }
  if (
    (field.type === 'string' || field.type === 'text') &&
    typeof value === 'string' &&
    field.max !== undefined &&
    value.length > field.max
  ) {
    return `Must be at most ${field.max} characters.`;
  }
  if (
    Array.isArray(value) &&
    field.max !== undefined &&
    value.length > field.max
  ) {
    return `At most ${field.max} entries.`;
  }
  return null;
}

/** Validates a whole value map, returning per-field messages. */
export function validateAll(
  specs: readonly FieldSpec[],
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const spec of specs) {
    const message = validate(spec, values[spec.name]);
    if (message !== null) {
      errors[spec.name] = message;
    }
  }
  return errors;
}
