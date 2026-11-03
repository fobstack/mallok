/**
 * The schema-driven form (docs/ADMIN.md §7).
 *
 * Give it field declarations and the React Hook Form they belong to; it
 * renders the controls, groups them and checks each value against its
 * declaration. Every schema-backed surface in the admin goes through this one
 * component, which is what lets theme and plugin authors add fields without
 * touching admin code.
 */

import type { JSX } from 'react';
import {
  type Control,
  Controller,
  type FieldPath,
  type FieldValues,
  type UseFormSetError,
} from 'react-hook-form';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { ApiError } from '../api.js';
import {
  BooleanControl,
  KeyValueControl,
  MediaControl,
  MediaListControl,
  NumberControl,
  type PickerProps,
  ReferenceControl,
  SelectControl,
  StringListControl,
  TextAreaControl,
  TextControl,
} from './controls.js';
import {
  byGroup,
  type ControlProps,
  type FieldSpec,
  labelFor,
  validate,
} from './types.js';

/** Extra capabilities the pickers need; absent in read-only contexts. */
export interface FormPickers {
  readonly pickMedia?: (kind: 'image' | 'file') => Promise<string | null>;
  readonly pickContent?: (kind: string) => Promise<string | null>;
  readonly previewUrl?: (path: string) => string | null;
}

export interface SchemaFormProps extends FormPickers {
  readonly specs: readonly FieldSpec[];
  /** The form the fields are part of. */
  readonly control: Control<FieldValues>;
  /** Prefix for control ids, so two forms can share a page. */
  readonly idPrefix: string;
  /**
   * Where these fields sit in the form's values, for a group inside it:
   * `variants.0.` puts `sku` at `variants.0.sku`. Empty for top-level fields.
   */
  readonly namePrefix?: string;
  /**
   * Whether each value is checked against its declaration before the form
   * submits. A plugin's record form says no: the Worker is its one
   * validator, and its messages come back onto the fields.
   */
  readonly validateHere?: boolean;
  /** Told about every change, after the form has taken it. */
  readonly onFieldChange?: (name: string, value: unknown) => void;
}

function controlFor(spec: FieldSpec, props: PickerProps): JSX.Element {
  switch (spec.field.type) {
    case 'text':
      return <TextAreaControl {...props} />;
    case 'number':
      return <NumberControl {...props} />;
    case 'boolean':
      return <BooleanControl {...props} />;
    case 'select':
      return <SelectControl {...props} />;
    case 'string[]':
      return <StringListControl {...props} />;
    case 'keyvalue':
      return <KeyValueControl {...props} />;
    case 'image':
    case 'file':
      return <MediaControl {...props} />;
    case 'image[]':
      return <MediaListControl {...props} />;
    case 'reference':
      return <ReferenceControl {...props} />;
    case 'reference[]':
      // A list of references has no control yet; the raw slugs stay editable
      // rather than being silently dropped (docs/tasks/TASK-09.md §6).
      return <StringListControl {...props} />;
    default:
      return <TextControl {...props} />;
  }
}

/**
 * Renders one declared field with its label, help text and error. A
 * checkbox sits before its label; everything else stacks under it.
 */
function DeclaredField(
  props: ControlProps & FormPickers & { readonly inline: boolean },
): JSX.Element {
  const { spec, error, id, inline } = props;
  const label = (
    <FieldLabel htmlFor={id}>
      {labelFor(spec)}
      {spec.field.required ? (
        <span className="text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
    </FieldLabel>
  );
  const notes = (
    <>
      {spec.field.help === undefined ? null : (
        <FieldDescription>{spec.field.help}</FieldDescription>
      )}
      {error === undefined ? null : (
        <FieldError id={errorIdFor(id)}>{error}</FieldError>
      )}
    </>
  );
  if (inline) {
    return (
      <Field orientation="horizontal" data-invalid={error !== undefined}>
        {controlFor(spec, props)}
        <FieldContent>
          {label}
          {notes}
        </FieldContent>
      </Field>
    );
  }
  return (
    <Field data-invalid={error !== undefined}>
      {label}
      {controlFor(spec, props)}
      {notes}
    </Field>
  );
}

/**
 * Marks a hand-written control invalid and points it at its message, the
 * way the generated controls are: a screen reader reads the problem with the
 * field.
 */
export function invalid(
  id: string,
  message: string | undefined,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return message === undefined
    ? {}
    : { 'aria-invalid': true, 'aria-describedby': errorIdFor(id) };
}

/** The id of a field's error message, which its control points at. */
export function errorIdFor(id: string): string {
  return `${id}-error`;
}

/** The generator itself. */
export function SchemaForm(props: SchemaFormProps): JSX.Element {
  const groups = byGroup(props.specs);
  const prefix = props.namePrefix ?? '';
  const validateHere = props.validateHere ?? true;
  return (
    <FieldGroup>
      {groups.map(([group, specs]) => (
        <FieldSet key={group === '' ? '__ungrouped' : group}>
          {group === '' ? null : <FieldLegend>{group}</FieldLegend>}
          {specs.map((spec) => (
            <Controller
              key={spec.name}
              control={props.control}
              name={`${prefix}${spec.name}`}
              rules={
                validateHere
                  ? { validate: (value) => validate(spec, value) ?? true }
                  : {}
              }
              render={({ field, fieldState }) => {
                const error = fieldState.error?.message;
                return (
                  <DeclaredField
                    spec={spec}
                    id={`${props.idPrefix}-${spec.name}`}
                    inline={spec.field.type === 'boolean'}
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      props.onFieldChange?.(spec.name, value);
                    }}
                    {...(error === undefined ? {} : { error })}
                    {...(props.pickMedia === undefined
                      ? {}
                      : { pickMedia: props.pickMedia })}
                    {...(props.pickContent === undefined
                      ? {}
                      : { pickContent: props.pickContent })}
                    {...(props.previewUrl === undefined
                      ? {}
                      : { previewUrl: props.previewUrl })}
                  />
                );
              }}
            />
          ))}
        </FieldSet>
      ))}
    </FieldGroup>
  );
}

/**
 * Puts the server's per-field messages on the fields they name, so each is
 * read with its field. The request's own message is still said where it
 * always was: a field the form does not show would otherwise hide it.
 */
export function showServerErrors<Values extends FieldValues>(
  setError: UseFormSetError<Values>,
  caught: unknown,
): void {
  if (!(caught instanceof ApiError)) {
    return;
  }
  for (const [name, message] of Object.entries(caught.fields)) {
    setError(name as FieldPath<Values>, { type: 'server', message });
  }
}
