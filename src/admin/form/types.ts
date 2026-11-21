/**
 * The form generator's contract.
 *
 * One generator serves four callers (docs/ADMIN.md §7): content fields from
 * `theme.json`, theme options, plugin settings and plugin panel filters.
 * Adding a field type here is the only way any of them gains a control —
 * theme and plugin authors never write admin code.
 */

import { plural, t } from '@lingui/core/macro';
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
      ...(option.advanced === true ? { advanced: true } : {}),
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
 * What every form says about an empty required field. A function, not a
 * constant: it is read when a value is checked, in the interface language
 * of that moment, not once when the module loads.
 */
export function requiredMessage(): string {
  return t`This field is required.`;
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
    return requiredMessage();
  }
  if (empty) {
    return null;
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return t`Enter a number.`;
    }
    const { min, max } = field;
    if (min !== undefined && value < min) {
      return t`Must be at least ${min}.`;
    }
    if (max !== undefined && value > max) {
      return t`Must be at most ${max}.`;
    }
    return null;
  }
  if (field.type === 'select' && typeof value === 'string') {
    return (field.choices ?? []).includes(value)
      ? null
      : t`Choose one of the listed values.`;
  }
  if (
    (field.type === 'string' || field.type === 'text') &&
    typeof value === 'string' &&
    field.max !== undefined &&
    value.length > field.max
  ) {
    const max = field.max;
    return plural(max, {
      one: 'Must be at most # character.',
      other: 'Must be at most # characters.',
    });
  }
  if (
    Array.isArray(value) &&
    field.max !== undefined &&
    value.length > field.max
  ) {
    const max = field.max;
    return plural(max, {
      one: 'At most # entry.',
      other: 'At most # entries.',
    });
  }
  return null;
}
