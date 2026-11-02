/**
 * The create and edit form of a plugin's `records` panel
 * (docs/PLUGIN_API.md §7.5).
 *
 * Built entirely from the fields the plugin declares; the plugin ships no
 * interface of its own. Scalar fields go through the same generator as theme
 * and settings fields. Two field types exist only here: `money`, an amount
 * with its currency, and `rows`, a repeatable group.
 *
 * The server is the one validator. This form sends what was entered and
 * shows what comes back beside the field it is about — including messages
 * only the plugin can produce, such as "this code is already taken".
 */

import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiError, api } from '../api.js';
import { SchemaForm } from '../form/form.js';
import type { FieldSpec } from '../form/types.js';
import { notice } from '../state.js';
import type {
  PluginPanel,
  RecordRowsField,
  RecordScalarField,
} from '../types.js';
import { RelatedRows } from './related-rows.js';

type Values = Record<string, unknown>;

/** How many rows a `rows` field holds unless it says otherwise. */
const ROWS_MAX = 50;

function labelOf(name: string, field: { readonly label?: string }): string {
  return field.label !== undefined && field.label !== ''
    ? field.label
    : name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * How many decimal places a currency's amounts are written with: 2 for most,
 * 0 for the yen, 3 for the dinar. The browser knows; a table here would not
 * keep up.
 */
function decimalsOf(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Whole minor units written as an amount: 9900 in USD is "99.00". */
function fromMinor(amount: number, currency: string): string {
  const decimals = decimalsOf(currency);
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount)).padStart(decimals + 1, '0');
  return decimals === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/**
 * An entered amount as whole minor units, or `NaN` when it is not an amount
 * that currency can hold. Done on the text, never through a float:
 * `19.99 * 100` is not 1999.
 */
function toMinor(text: string, currency: string): number {
  const matched = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (matched === null) {
    return Number.NaN;
  }
  const decimals = decimalsOf(currency);
  const fraction = matched[3] ?? '';
  if (fraction.length > decimals) {
    return Number.NaN;
  }
  const minor = Number(`${matched[2]}${fraction.padEnd(decimals, '0')}`);
  return matched[1] === '-' ? -minor : minor;
}

function MoneyField({
  id,
  name,
  field,
  value,
  error,
  onChange,
}: {
  readonly id: string;
  readonly name: string;
  readonly field: RecordScalarField;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly onChange: (value: unknown) => void;
}): JSX.Element {
  const currencies = field.currencies ?? [];
  const current =
    value !== null && typeof value === 'object'
      ? (value as { amount?: unknown; currency?: unknown })
      : {};
  const currency =
    typeof current.currency === 'string'
      ? current.currency
      : (currencies[0] ?? '');
  // The text is kept as typed: turning "9." back into "9.00" on every key
  // press would fight the person typing.
  const [text, setText] = useState(
    typeof current.amount === 'number' && Number.isFinite(current.amount)
      ? fromMinor(current.amount, currency)
      : '',
  );
  const emit = (nextText: string, nextCurrency: string): void => {
    onChange(
      nextText.trim() === ''
        ? null
        : { amount: toMinor(nextText, nextCurrency), currency: nextCurrency },
    );
  };
  const label = labelOf(name, field);
  return (
    <Field data-invalid={error === undefined ? undefined : true}>
      <FieldLabel htmlFor={id}>
        {label}
        {field.required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          className="max-w-48 min-w-0"
          {...(error === undefined
            ? {}
            : { 'aria-invalid': true, 'aria-describedby': `${id}-error` })}
          value={text}
          placeholder={fromMinor(0, currency)}
          onInput={(event) => {
            setText(event.currentTarget.value);
            emit(event.currentTarget.value, currency);
          }}
        />
        <NativeSelect
          className="shrink-0"
          aria-label={`${label}: currency`}
          value={currency}
          onChange={(event) => emit(text, event.currentTarget.value)}
        >
          {currencies.map((code) => (
            <NativeSelectOption key={code} value={code}>
              {code}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {field.help === undefined ? null : (
        <FieldDescription>{field.help}</FieldDescription>
      )}
      {error === undefined ? null : (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      )}
    </Field>
  );
}

/** One scalar field: `money` here, everything else through the generator. */
function ScalarField({
  idPrefix,
  name,
  field,
  value,
  error,
  onChange,
}: {
  readonly idPrefix: string;
  readonly name: string;
  readonly field: RecordScalarField;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly onChange: (value: unknown) => void;
}): JSX.Element {
  if (field.type === 'money') {
    return (
      <MoneyField
        id={`${idPrefix}-${name}`}
        name={name}
        field={field}
        value={value}
        error={error}
        onChange={onChange}
      />
    );
  }
  const spec = { name, field } as unknown as FieldSpec;
  return (
    <SchemaForm
      specs={[spec]}
      values={{ [name]: value ?? undefined }}
      errors={error === undefined ? {} : { [name]: error }}
      idPrefix={idPrefix}
      onChange={(_name, next) => onChange(next)}
    />
  );
}

function RowsField({
  idPrefix,
  name,
  field,
  value,
  errors,
  onChange,
}: {
  readonly idPrefix: string;
  readonly name: string;
  readonly field: RecordRowsField;
  readonly value: unknown;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (value: unknown) => void;
}): JSX.Element {
  const rows = Array.isArray(value) ? (value as Values[]) : [];
  // Rows have no id of their own, so each gets a key for as long as the
  // form is open: without one, removing the first row would leave its
  // typed-in amount showing on the second.
  const [keys, setKeys] = useState<readonly string[]>(() =>
    rows.map(() => crypto.randomUUID()),
  );
  const limit = field.max ?? ROWS_MAX;
  const label = labelOf(name, field);
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">
        {label}
        {field.required ? (
          <span className="text-destructive" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </FieldLegend>
      {field.help === undefined ? null : (
        <FieldDescription>{field.help}</FieldDescription>
      )}
      {errors[name] === undefined ? null : (
        <p className="text-sm text-destructive" role="alert">
          {errors[name]}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rows yet.</p>
      ) : null}
      {rows.map((row, index) => (
        <fieldset
          className="flex flex-col gap-3 rounded-lg border p-3"
          key={keys[index] ?? index}
          aria-label={`${label} ${index + 1}`}
        >
          {Object.entries(field.fields).map(([subName, subField]) => (
            <ScalarField
              key={subName}
              idPrefix={`${idPrefix}-${name}-${keys[index] ?? index}`}
              name={subName}
              field={subField}
              value={row[subName]}
              error={errors[`${name}.${index}.${subName}`]}
              onChange={(next) =>
                onChange(
                  rows.map((existing, at) =>
                    at === index ? { ...existing, [subName]: next } : existing,
                  ),
                )
              }
            />
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setKeys(keys.filter((_key, at) => at !== index));
                onChange(rows.filter((_row, at) => at !== index));
              }}
            >
              Remove {label.toLowerCase()} {index + 1}
            </Button>
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= limit}
          onClick={() => {
            setKeys([...keys, crypto.randomUUID()]);
            onChange([...rows, {}]);
          }}
        >
          Add a row
        </Button>
        {rows.length >= limit ? (
          <p className="text-sm text-muted-foreground">At most {limit} rows.</p>
        ) : null}
      </div>
    </FieldSet>
  );
}

/**
 * A form in a sheet from the right: the record editor and an action's
 * parameters. Escape and the close button close it; a click outside does
 * not, as with the native `<dialog>` it replaced — a stray click must not
 * throw away what was typed.
 */
function FormSheet({
  title,
  onClose,
  onSubmit,
  children,
  footer,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly onSubmit?: (event: { preventDefault(): void }) => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): JSX.Element {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        className="w-full gap-0 data-[side=right]:sm:max-w-xl"
        aria-describedby={undefined}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {onSubmit === undefined ? (
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
              {children}
            </div>
            {footer === undefined ? null : (
              <SheetFooter className="mt-0 flex-row flex-wrap items-center border-t">
                {footer}
              </SheetFooter>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function RecordEditor({
  pluginId,
  panel,
  recordId,
  onClose,
  attachedTo,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  /** `null` creates a record. */
  readonly recordId: string | null;
  /** The content item's translation group, for an attached panel. */
  readonly attachedTo?: string;
  /** `changed` is true when the list behind the form is now out of date. */
  readonly onClose: (changed: boolean) => void;
}): JSX.Element {
  const fields = panel.fields ?? {};
  const base = `/plugins/${pluginId}/panels/${panel.id}/records`;
  const [values, setValues] = useState<Values | null>(() =>
    recordId === null
      ? Object.fromEntries(
          Object.entries(fields)
            .filter(
              ([, field]) =>
                field.type !== 'rows' && field.default !== undefined,
            )
            .map(([name, field]) => [
              name,
              (field as RecordScalarField).default,
            ]),
        )
      : null,
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (recordId === null) {
      return;
    }
    let cancelled = false;
    void api<{ values: Values }>(
      `${base}/${encodeURIComponent(recordId)}`,
    ).then(
      (loaded) => {
        if (!cancelled) {
          setValues(loaded.values);
        }
      },
      (caught: unknown) => {
        if (!cancelled) {
          notice.value =
            caught instanceof ApiError
              ? caught.message
              : 'Could not load the record.';
          onClose(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base, recordId, onClose]);

  const save = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    if (values === null) {
      return;
    }
    setBusy(true);
    setFailure('');
    try {
      await api(
        recordId === null ? base : `${base}/${encodeURIComponent(recordId)}`,
        {
          method: recordId === null ? 'POST' : 'PUT',
          body: attachedTo === undefined ? { values } : { values, attachedTo },
        },
      );
      onClose(true);
    } catch (caught) {
      const fieldErrors = caught instanceof ApiError ? caught.fields : {};
      setErrors(fieldErrors);
      setFailure(
        caught instanceof ApiError ? caught.message : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (recordId === null) {
      return;
    }
    setBusy(true);
    try {
      await api(`${base}/${encodeURIComponent(recordId)}`, {
        method: 'DELETE',
      });
      onClose(true);
    } catch (caught) {
      setFailure(
        caught instanceof ApiError ? caught.message : 'Could not delete.',
      );
      setBusy(false);
    }
  };

  const idPrefix = `record-${pluginId}-${panel.id}`;
  const title = `${recordId === null ? 'New' : 'Edit'}: ${panel.label}`;
  if (values === null) {
    return (
      <FormSheet title={title} onClose={() => onClose(false)}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </FormSheet>
    );
  }
  return (
    <FormSheet
      title={title}
      onClose={() => onClose(false)}
      onSubmit={(event) => void save(event)}
      footer={
        <>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {recordId === null || !panel.canRemove ? null : confirming ? (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete it
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Keep it
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(true)}
            >
              Delete…
            </Button>
          )}
        </>
      }
    >
      {Object.entries(fields).map(([name, field]) =>
        field.type === 'rows' ? (
          <RowsField
            key={name}
            idPrefix={idPrefix}
            name={name}
            field={field}
            value={values[name]}
            errors={errors}
            onChange={(next) => setValues({ ...values, [name]: next })}
          />
        ) : (
          <ScalarField
            key={name}
            idPrefix={idPrefix}
            name={name}
            field={field}
            value={values[name]}
            error={errors[name]}
            onChange={(next) => setValues({ ...values, [name]: next })}
          />
        ),
      )}
      {recordId === null ? null : (
        <RelatedRows pluginId={pluginId} panel={panel} parentId={recordId} />
      )}
      {failure === '' ? null : (
        <p className="text-sm text-destructive" role="alert">
          {failure}
        </p>
      )}
    </FormSheet>
  );
}

/**
 * Asks for the values an action declares before running it
 * (docs/PLUGIN_API.md §7.5): a tracking number, a refund amount. The same
 * controls as a record's fields, checked by the same code on the server.
 */
export function ActionParamsDialog({
  pluginId,
  panel,
  action,
  ids,
  onClose,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  readonly action: PluginPanel['actions'][number];
  readonly ids: readonly string[];
  /** `done` is true when the action ran. */
  readonly onClose: (done: boolean) => void;
}): JSX.Element {
  const fields = action.params ?? {};
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(
      Object.entries(fields)
        .filter(([, field]) => field.default !== undefined)
        .map(([name, field]) => [name, field.default]),
    ),
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailure('');
    try {
      await api(
        `/plugins/${pluginId}/panels/${panel.id}/actions/${action.id}`,
        { method: 'POST', body: { ids, params: values } },
      );
      onClose(true);
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.fields : {});
      setFailure(
        caught instanceof ApiError ? caught.message : 'The action failed.',
      );
      setBusy(false);
    }
  };

  const count = ids.length;
  return (
    <FormSheet
      title={action.label}
      onClose={() => onClose(false)}
      onSubmit={(event) => void run(event)}
      footer={
        <Button type="submit" disabled={busy}>
          {busy ? 'Working…' : action.label}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Applies to {count} selected row{count === 1 ? '' : 's'}.
      </p>
      {Object.entries(fields).map(([name, field]) => (
        <ScalarField
          key={name}
          idPrefix={`action-${pluginId}-${action.id}`}
          name={name}
          field={field}
          value={values[name]}
          error={errors[name]}
          onChange={(next) => setValues({ ...values, [name]: next })}
        />
      ))}
      {failure === '' ? null : (
        <p className="text-sm text-destructive" role="alert">
          {failure}
        </p>
      )}
    </FormSheet>
  );
}
