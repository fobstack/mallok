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

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FormEventHandler, JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  type Control,
  Controller,
  type FieldValues,
  get,
  useFieldArray,
  useForm,
  useFormState,
} from 'react-hook-form';
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
import { SchemaForm, showServerErrors } from '../form/form.js';
import type { FieldSpec } from '../form/types.js';
import { messageOf, notify } from '../notice.js';
import { panelKey } from '../queries.js';
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
  const { t } = useLingui();
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
          aria-label={t`${label}: currency`}
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
  control,
  idPrefix,
  namePrefix,
  name,
  field,
}: {
  readonly control: Control<FieldValues>;
  readonly idPrefix: string;
  /** Where the field sits in the form's values: `variants.0.` in a row. */
  readonly namePrefix: string;
  readonly name: string;
  readonly field: RecordScalarField;
}): JSX.Element {
  if (field.type === 'money') {
    return (
      <Controller
        control={control}
        name={`${namePrefix}${name}`}
        render={({ field: bound, fieldState }) => (
          <MoneyField
            id={`${idPrefix}-${name}`}
            name={name}
            field={field}
            value={bound.value}
            error={fieldState.error?.message}
            onChange={bound.onChange}
          />
        )}
      />
    );
  }
  const spec = { name, field } as unknown as FieldSpec;
  return (
    <SchemaForm
      specs={[spec]}
      control={control}
      idPrefix={idPrefix}
      namePrefix={namePrefix}
      // The Worker is this form's one validator (see the top of this file).
      validateHere={false}
    />
  );
}

function RowsField({
  control,
  idPrefix,
  name,
  field,
}: {
  readonly control: Control<FieldValues>;
  readonly idPrefix: string;
  readonly name: string;
  readonly field: RecordRowsField;
}): JSX.Element {
  // Each row keeps its own id for as long as the form is open: without one,
  // removing the first row would leave its typed-in amount showing on the
  // second.
  const { fields: rows, append, remove } = useFieldArray({ control, name });
  const { errors } = useFormState({ control, name });
  const fault = get(errors, name) as { message?: unknown } | undefined;
  const message = typeof fault?.message === 'string' ? fault.message : '';
  const limit = field.max ?? ROWS_MAX;
  const label = labelOf(name, field);
  const { t } = useLingui();
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
      {message === '' ? null : (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No rows yet.</Trans>
        </p>
      ) : null}
      {rows.map((row, index) => {
        const number = index + 1;
        // Mid-sentence in English ("Remove variants 1"); a no-op for a
        // language without case.
        const item = label.toLowerCase();
        return (
          <fieldset
            className="flex flex-col gap-3 rounded-lg border p-3"
            key={row.id}
            aria-label={`${label} ${index + 1}`}
          >
            {Object.entries(field.fields).map(([subName, subField]) => (
              <ScalarField
                key={subName}
                control={control}
                idPrefix={`${idPrefix}-${name}-${row.id}`}
                namePrefix={`${name}.${index}.`}
                name={subName}
                field={subField}
              />
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => remove(index)}
              >
                {t`Remove ${item} ${number}`}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= limit}
          onClick={() => append({})}
        >
          <Trans>Add a row</Trans>
        </Button>
        {rows.length >= limit ? (
          <p className="text-sm text-muted-foreground">
            <Plural
              value={limit}
              one="At most # row."
              other="At most # rows."
            />
          </p>
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
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
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
  const { t } = useLingui();
  const fields = panel.fields ?? {};
  const base = `/plugins/${pluginId}/panels/${panel.id}/records`;
  const stored = useQuery({
    queryKey: panelKey(pluginId, panel.id, 'record', recordId ?? ''),
    queryFn: () =>
      api<{ values: Values }>(`${base}/${encodeURIComponent(recordId ?? '')}`),
    enabled: recordId !== null,
    // Opened to be edited: always as stored now, never as last seen.
    gcTime: 0,
  });
  useEffect(() => {
    if (stored.error !== null) {
      notify(messageOf(stored.error, t`Could not load the record.`));
      onClose(false);
    }
  }, [stored.error, onClose, t]);
  const values: Values | null =
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
      : (stored.data?.values ?? null);

  const panelLabel = panel.label;
  const title =
    recordId === null ? t`New: ${panelLabel}` : t`Edit: ${panelLabel}`;
  if (values === null) {
    return (
      <FormSheet title={title} onClose={() => onClose(false)}>
        <p className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      </FormSheet>
    );
  }
  return (
    <RecordForm
      pluginId={pluginId}
      panel={panel}
      recordId={recordId}
      initial={values}
      title={title}
      onClose={onClose}
      {...(attachedTo === undefined ? {} : { attachedTo })}
    />
  );
}

/** The record's form, once its stored values are in hand. */
function RecordForm({
  pluginId,
  panel,
  recordId,
  initial,
  title,
  onClose,
  attachedTo,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  readonly recordId: string | null;
  readonly initial: Values;
  readonly title: string;
  readonly onClose: (changed: boolean) => void;
  readonly attachedTo?: string;
}): JSX.Element {
  const { t } = useLingui();
  const fields = panel.fields ?? {};
  const base = `/plugins/${pluginId}/panels/${panel.id}/records`;
  const form = useForm<FieldValues>({ defaultValues: initial });
  const [failure, setFailure] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const busy = form.formState.isSubmitting || deleting;

  const save = form.handleSubmit(async (values) => {
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
      showServerErrors(form.setError, caught);
      setFailure(
        caught instanceof ApiError ? caught.message : t`Could not save.`,
      );
    }
  });

  const remove = async (): Promise<void> => {
    if (recordId === null) {
      return;
    }
    setDeleting(true);
    try {
      await api(`${base}/${encodeURIComponent(recordId)}`, {
        method: 'DELETE',
      });
      onClose(true);
    } catch (caught) {
      setFailure(
        caught instanceof ApiError ? caught.message : t`Could not delete.`,
      );
      setDeleting(false);
    }
  };

  const idPrefix = `record-${pluginId}-${panel.id}`;
  return (
    <FormSheet
      title={title}
      onClose={() => onClose(false)}
      onSubmit={(event) => void save(event)}
      footer={
        <>
          <Button type="submit" disabled={busy}>
            {busy ? t`Saving…` : t`Save`}
          </Button>
          {recordId === null || !panel.canRemove ? null : confirming ? (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trans>Delete it</Trans>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                <Trans>Keep it</Trans>
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(true)}
            >
              <Trans>Delete…</Trans>
            </Button>
          )}
        </>
      }
    >
      {Object.entries(fields).map(([name, field]) =>
        field.type === 'rows' ? (
          <RowsField
            key={name}
            control={form.control}
            idPrefix={idPrefix}
            name={name}
            field={field}
          />
        ) : (
          <ScalarField
            key={name}
            control={form.control}
            idPrefix={idPrefix}
            namePrefix=""
            name={name}
            field={field}
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
  const { t } = useLingui();
  const fields = action.params ?? {};
  const form = useForm<FieldValues>({
    defaultValues: Object.fromEntries(
      Object.entries(fields)
        .filter(([, field]) => field.default !== undefined)
        .map(([name, field]) => [name, field.default]),
    ),
  });
  const [failure, setFailure] = useState('');
  const busy = form.formState.isSubmitting;

  const run = form.handleSubmit(async (values) => {
    setFailure('');
    try {
      await api(
        `/plugins/${pluginId}/panels/${panel.id}/actions/${action.id}`,
        { method: 'POST', body: { ids, params: values } },
      );
      onClose(true);
    } catch (caught) {
      showServerErrors(form.setError, caught);
      setFailure(
        caught instanceof ApiError ? caught.message : t`The action failed.`,
      );
    }
  });

  const count = ids.length;
  return (
    <FormSheet
      title={action.label}
      onClose={() => onClose(false)}
      onSubmit={(event) => void run(event)}
      footer={
        <Button type="submit" disabled={busy}>
          {busy ? t`Working…` : action.label}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        <Plural
          value={count}
          one="Applies to # selected row."
          other="Applies to # selected rows."
        />
      </p>
      {Object.entries(fields).map(([name, field]) => (
        <ScalarField
          key={name}
          control={form.control}
          idPrefix={`action-${pluginId}-${action.id}`}
          namePrefix=""
          name={name}
          field={field}
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
