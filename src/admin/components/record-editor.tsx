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

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { SchemaForm } from '../form/form.js';
import type { FieldSpec } from '../form/types.js';
import { notice } from '../state.js';
import type {
  PluginPanel,
  RecordRowsField,
  RecordScalarField,
} from '../types.js';

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
    <div className={`field${error === undefined ? '' : ' has-error'}`}>
      <label htmlFor={id}>
        {label}
        {field.required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="control money-control">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={fromMinor(0, currency)}
          onInput={(event) => {
            setText(event.currentTarget.value);
            emit(event.currentTarget.value, currency);
          }}
        />
        <select
          aria-label={`${label}: currency`}
          value={currency}
          onChange={(event) => emit(text, event.currentTarget.value)}
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
      {field.help === undefined ? null : <p className="help">{field.help}</p>}
      {error === undefined ? null : (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
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
    <fieldset className="rows-field">
      <legend>
        {label}
        {field.required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      {field.help === undefined ? null : <p className="help">{field.help}</p>}
      {errors[name] === undefined ? null : (
        <p className="error" role="alert">
          {errors[name]}
        </p>
      )}
      {rows.length === 0 ? <p className="empty">No rows yet.</p> : null}
      {rows.map((row, index) => (
        <fieldset
          className="rows-field-row"
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
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setKeys(keys.filter((_key, at) => at !== index));
              onChange(rows.filter((_row, at) => at !== index));
            }}
          >
            Remove {label.toLowerCase()} {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="ghost"
        disabled={rows.length >= limit}
        onClick={() => {
          setKeys([...keys, crypto.randomUUID()]);
          onChange([...rows, {}]);
        }}
      >
        Add a row
      </button>
      {rows.length >= limit ? (
        <p className="help">At most {limit} rows.</p>
      ) : null}
    </fieldset>
  );
}

export function RecordEditor({
  pluginId,
  panel,
  recordId,
  onClose,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  /** `null` creates a record. */
  readonly recordId: string | null;
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
        { method: recordId === null ? 'POST' : 'PUT', body: { values } },
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
  return (
    <dialog
      className="modal record-editor"
      aria-label={title}
      ref={(element) => {
        if (element !== null && !element.open) {
          element.showModal();
        }
      }}
      onClose={() => onClose(false)}
      onCancel={() => onClose(false)}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="ghost" onClick={() => onClose(false)}>
          Close
        </button>
      </header>
      {values === null ? (
        <p>Loading…</p>
      ) : (
        <form onSubmit={(event) => void save(event)}>
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
          {failure === '' ? null : (
            <p className="error" role="alert">
              {failure}
            </p>
          )}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {recordId === null || !panel.canRemove ? null : confirming ? (
              <>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Delete it
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ghost"
                onClick={() => setConfirming(true)}
              >
                Delete…
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}
