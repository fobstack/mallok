/**
 * The schema-driven form (docs/ADMIN.md §7).
 *
 * Give it a field declaration map and a value map; it renders the controls,
 * groups them, validates and reports changes. Every schema-backed surface in
 * the admin goes through this one component, which is what lets theme and
 * plugin authors add fields without touching admin code.
 */

import type { JSX } from 'react';
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
} from './types.js';

/** Extra capabilities the pickers need; absent in read-only contexts. */
export interface FormPickers {
  readonly pickMedia?: (kind: 'image' | 'file') => Promise<string | null>;
  readonly pickContent?: (kind: string) => Promise<string | null>;
  readonly previewUrl?: (path: string) => string | null;
}

export interface SchemaFormProps extends FormPickers {
  readonly specs: readonly FieldSpec[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly errors?: Readonly<Record<string, string>>;
  readonly onChange: (name: string, value: unknown) => void;
  /** Prefix for control ids, so two forms can share a page. */
  readonly idPrefix: string;
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

/** The id of a field's error message, which its control points at. */
export function errorIdFor(id: string): string {
  return `${id}-error`;
}

/** The generator itself. */
export function SchemaForm(props: SchemaFormProps): JSX.Element {
  const groups = byGroup(props.specs);
  return (
    <FieldGroup>
      {groups.map(([group, specs]) => (
        <FieldSet key={group === '' ? '__ungrouped' : group}>
          {group === '' ? null : <FieldLegend>{group}</FieldLegend>}
          {specs.map((spec) => {
            const id = `${props.idPrefix}-${spec.name}`;
            const error = props.errors?.[spec.name];
            return (
              <DeclaredField
                key={spec.name}
                spec={spec}
                id={id}
                inline={spec.field.type === 'boolean'}
                value={props.values[spec.name]}
                onChange={(value) => props.onChange(spec.name, value)}
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
          })}
        </FieldSet>
      ))}
    </FieldGroup>
  );
}
