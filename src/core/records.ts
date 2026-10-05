/**
 * Records a plugin's admin panel edits (docs/PLUGIN_API.md §7.5): the field
 * declarations and the one validator for submitted values.
 *
 * A plugin ships no admin code. It declares fields, the admin builds a form
 * from them, and what the form submits is checked here — in core, so the
 * browser can show the same messages the Worker will give, and the Worker
 * never has to trust that the browser did.
 */

import { z } from 'zod';

const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;
/** An ISO 4217 code as a plugin declares it. */
const CURRENCY = /^[A-Z]{3}$/;

/** How many rows a `rows` field holds unless it declares its own `max`. */
export const RECORD_ROWS_MAX = 50;

const common = {
  label: z.string().optional(),
  required: z.boolean().default(false),
  help: z.string().optional(),
  group: z.string().optional(),
};

/** A field holding one value: the plugin-settings vocabulary plus `money`. */
const scalarFieldSchema = z
  .object({
    type: z.enum([
      'string',
      'text',
      'number',
      'boolean',
      'date',
      'select',
      'string[]',
      'color',
      'keyvalue',
      'money',
    ]),
    ...common,
    default: z.unknown().optional(),
    /** `select` only. */
    choices: z.array(z.string()).optional(),
    /** `money` only: the currencies an amount may be in. */
    currencies: z.array(z.string().regex(CURRENCY)).optional(),
    /** Upper bound for a number, a money amount, a string's or a list's length. */
    max: z.number().optional(),
    min: z.number().optional(),
  })
  .strict()
  .refine(
    (field) => field.type !== 'select' || (field.choices?.length ?? 0) > 0,
    { message: 'A "select" field must list its choices.' },
  )
  .refine(
    (field) => field.type !== 'money' || (field.currencies?.length ?? 0) > 0,
    { message: 'A "money" field must list its currencies.' },
  )
  .refine((field) => field.type === 'money' || field.currencies === undefined, {
    message: 'Only a "money" field lists currencies.',
  });

/** A repeatable group of scalar fields, such as the variants of a product. */
const rowsFieldSchema = z
  .object({
    type: z.literal('rows'),
    ...common,
    fields: z.record(z.string().regex(FIELD_NAME), scalarFieldSchema),
    /** Most rows the field may hold. */
    max: z.number().int().positive().optional(),
  })
  .strict()
  .refine((field) => Object.keys(field.fields).length > 0, {
    message: 'A "rows" field must declare the fields of a row.',
  });

/** One field of a record, as `plugin.json` declares it. */
export const recordFieldSchema = z.union([rowsFieldSchema, scalarFieldSchema]);

/** The fields of a record, keyed by name. */
export const recordFieldsSchema = z.record(
  z.string().regex(FIELD_NAME),
  recordFieldSchema,
);

/** A declared scalar field. */
export type RecordScalarField = z.infer<typeof scalarFieldSchema>;
/** A declared `rows` field. */
export type RecordRowsField = z.infer<typeof rowsFieldSchema>;
/** Any declared record field. */
export type RecordField = RecordScalarField | RecordRowsField;

/**
 * What the validator reads off a declaration. Narrower than the parsed
 * types, and read-only all the way down, so that a manifest frozen by
 * `definePlugin` can be passed as it is.
 */
interface ScalarShape {
  readonly type: RecordScalarField['type'];
  readonly required: boolean;
  readonly choices?: readonly string[] | undefined;
  readonly currencies?: readonly string[] | undefined;
  readonly max?: number | undefined;
  readonly min?: number | undefined;
}
interface RowsShape {
  readonly type: 'rows';
  readonly required: boolean;
  readonly fields: Readonly<Record<string, ScalarShape>>;
  readonly max?: number | undefined;
}

/** An amount of money: whole minor units — cents — and its currency. */
export interface MoneyValue {
  readonly amount: number;
  readonly currency: string;
}

/** What validating a submitted record produced. */
export interface RecordValidation {
  /** The declared fields only, in declared order, with empties as `null`. */
  readonly values: Record<string, unknown>;
  /**
   * Messages keyed by field. A problem inside a row is keyed
   * `<field>.<index>.<sub-field>`.
   */
  readonly errors: Record<string, string>;
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Checks one scalar value; returns the stored form or a message. */
function checkScalar(
  field: ScalarShape,
  value: unknown,
): { value: unknown } | { error: string } {
  if (isEmpty(value)) {
    return field.required
      ? { error: 'This field is required.' }
      : { value: null };
  }
  switch (field.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { error: 'Enter a number.' };
      }
      if (field.min !== undefined && value < field.min) {
        return { error: `Must be at least ${field.min}.` };
      }
      if (field.max !== undefined && value > field.max) {
        return { error: `Must be at most ${field.max}.` };
      }
      return { value };
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? { value }
        : { error: 'Must be yes or no.' };
    case 'select':
      return typeof value === 'string' && (field.choices ?? []).includes(value)
        ? { value }
        : { error: 'Choose one of the listed values.' };
    case 'date':
      return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value))
        ? { value }
        : { error: 'Enter a date as YYYY-MM-DD.' };
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
        ? { value }
        : { error: 'Enter a colour as #rrggbb.' };
    case 'string[]': {
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'string')
      ) {
        return { error: 'Must be a list of text values.' };
      }
      if (field.max !== undefined && value.length > field.max) {
        return { error: `At most ${field.max} entries.` };
      }
      return { value };
    }
    case 'keyvalue': {
      if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.values(value as object).some(
          (entry) => typeof entry !== 'string',
        )
      ) {
        return { error: 'Must be a set of name and value pairs.' };
      }
      return { value };
    }
    case 'money': {
      const money = value as Partial<MoneyValue>;
      if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof money.amount !== 'number' ||
        // Whole minor units, exactly: a float would lose a cent somewhere.
        !Number.isSafeInteger(money.amount)
      ) {
        return { error: 'Enter an amount.' };
      }
      if (
        typeof money.currency !== 'string' ||
        !(field.currencies ?? []).includes(money.currency)
      ) {
        return { error: 'Choose one of the listed currencies.' };
      }
      if (money.amount < (field.min ?? 0)) {
        return { error: 'The amount is too low.' };
      }
      if (field.max !== undefined && money.amount > field.max) {
        return { error: 'The amount is too high.' };
      }
      return { value: { amount: money.amount, currency: money.currency } };
    }
    default: {
      if (typeof value !== 'string') {
        return { error: 'Must be text.' };
      }
      if (field.max !== undefined && value.length > field.max) {
        return { error: `Must be at most ${field.max} characters.` };
      }
      return { value };
    }
  }
}

/**
 * Validates a submitted record against its declared fields.
 *
 * Anything not declared is dropped rather than refused: the form only ever
 * sends declared fields, and a stray key from a script must not reach a
 * plugin's handler looking like a value the admin vouched for.
 */
export function validateRecord(
  fields: Readonly<Record<string, ScalarShape | RowsShape>>,
  input: Readonly<Record<string, unknown>>,
): RecordValidation {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [name, field] of Object.entries(fields)) {
    const submitted = input[name];
    if (field.type !== 'rows') {
      const checked = checkScalar(field, submitted);
      if ('error' in checked) {
        errors[name] = checked.error;
      } else {
        values[name] = checked.value;
      }
      continue;
    }

    if (isEmpty(submitted)) {
      if (field.required) {
        errors[name] = 'Add at least one row.';
      }
      values[name] = [];
      continue;
    }
    if (!Array.isArray(submitted)) {
      errors[name] = 'Must be a list of rows.';
      continue;
    }
    const limit = field.max ?? RECORD_ROWS_MAX;
    if (submitted.length > limit) {
      errors[name] = `At most ${limit} rows.`;
      continue;
    }
    const rows: Record<string, unknown>[] = [];
    for (const [index, raw] of submitted.entries()) {
      const row: Record<string, unknown> = {};
      const source =
        raw !== null && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      for (const [subName, subField] of Object.entries(field.fields)) {
        const checked = checkScalar(subField, source[subName]);
        if ('error' in checked) {
          errors[`${name}.${index}.${subName}`] = checked.error;
        } else {
          row[subName] = checked.value;
        }
      }
      rows.push(row);
    }
    values[name] = rows;
  }
  return { values, errors };
}
