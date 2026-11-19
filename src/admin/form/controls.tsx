/**
 * One control per declarable field type (docs/THEME_FORMAT.md §5.2).
 *
 * The three that are more than an input are called out in
 * docs/ADMIN.md §7: media fields write back a **relative path**, references
 * write back a **slug**, and secrets never show their value.
 */

import { Trans, useLingui } from '@lingui/react/macro';
import type { JSX } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '../components/page.js';
import type { ControlProps } from './types.js';

/** A row of a list control: its inputs, then its buttons. */
const ROW = 'flex flex-wrap items-center gap-2 *:data-[slot=input]:flex-1';
/** A list control: its rows, then the button that adds one. */
const LIST = 'flex flex-col items-start gap-2 *:w-full *:last:w-auto';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Ties a control to its field's error message: marked invalid, and described
 * by the message, so a screen reader reads the problem with the field rather
 * than as a stray alert.
 */
function invalidProps(
  id: string,
  error: string | undefined,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return error === undefined
    ? {}
    : { 'aria-invalid': true, 'aria-describedby': `${id}-error` };
}

/** Single-line text, and the base for `color`, `date` and friends. */
export function TextControl({
  spec,
  value,
  onChange,
  id,
  error,
}: ControlProps): JSX.Element {
  const type =
    spec.field.type === 'color'
      ? 'color'
      : spec.field.type === 'date'
        ? 'date'
        : 'text';
  return (
    <Input
      id={id}
      {...invalidProps(id, error)}
      className={type === 'color' ? 'w-16 p-1' : undefined}
      type={type}
      value={asString(value)}
      onInput={(event) => onChange(event.currentTarget.value)}
      {...(spec.field.max === undefined ? {} : { maxLength: spec.field.max })}
    />
  );
}

/** Multi-line text. */
export function TextAreaControl({
  value,
  onChange,
  id,
  error,
}: ControlProps): JSX.Element {
  return (
    <Textarea
      id={id}
      {...invalidProps(id, error)}
      rows={4}
      value={asString(value)}
      onInput={(event) => onChange(event.currentTarget.value)}
    />
  );
}

/** Number. Empty clears the value rather than storing NaN. */
export function NumberControl({
  spec,
  value,
  onChange,
  id,
  error,
}: ControlProps): JSX.Element {
  return (
    <Input
      id={id}
      {...invalidProps(id, error)}
      className="w-40"
      type="number"
      value={typeof value === 'number' ? String(value) : ''}
      onInput={(event) => {
        const raw = event.currentTarget.value;
        onChange(raw === '' ? undefined : Number(raw));
      }}
      {...(spec.field.min === undefined ? {} : { min: spec.field.min })}
      {...(spec.field.max === undefined ? {} : { max: spec.field.max })}
    />
  );
}

/** Boolean, as a checkbox with its own label text. */
export function BooleanControl({
  value,
  onChange,
  id,
}: ControlProps): JSX.Element {
  return (
    <Checkbox
      id={id}
      checked={value === true}
      onCheckedChange={(checked) => onChange(checked === true)}
    />
  );
}

/** One of the declared choices. */
export function SelectControl({
  spec,
  value,
  onChange,
  id,
  error,
}: ControlProps): JSX.Element {
  return (
    <NativeSelect
      id={id}
      {...invalidProps(id, error)}
      value={asString(value)}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <NativeSelectOption value="">—</NativeSelectOption>
      {(spec.field.choices ?? []).map((choice) => (
        <NativeSelectOption key={choice} value={choice}>
          {choice}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/**
 * A list of strings, one per row.
 *
 * Rows are keyed by index because a plain string has no identity. Every input
 * is fully controlled from props, so a reorder re-renders correct values; the
 * only cost is that focus does not follow a row that moves.
 */
export function StringListControl({
  value,
  onChange,
  id,
  spec,
}: ControlProps): JSX.Element {
  const { t } = useLingui();
  const entries = asList(value);
  // Each row is its own input, so each needs its own name for a screen
  // reader: the field's label and the row's place in the list.
  const fieldName = spec.field.label ?? spec.name;
  const update = (next: string[]): void => {
    onChange(next.filter((entry) => entry.trim() !== ''));
  };
  return (
    <div className={LIST} id={id}>
      {entries.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries are plain strings edited in place by position, with no other identity.
        <div className={ROW} key={index}>
          <Input
            aria-label={t`${fieldName}, item ${index + 1}`}
            value={entry}
            onInput={(event) => {
              const next = [...entries];
              next[index] = event.currentTarget.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => update(entries.filter((_, i) => i !== index))}
          >
            <Trans>Remove</Trans>
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...entries, ''])}
      >
        <Trans>Add entry</Trans>
      </Button>
    </div>
  );
}

/** A key/value table, kept as an object in insertion order. */
export function KeyValueControl({
  value,
  onChange,
  id,
}: ControlProps): JSX.Element {
  const { t } = useLingui();
  const pairs: [string, string][] =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          typeof entry === 'string' ? entry : String(entry ?? ''),
        ])
      : [];
  const write = (next: [string, string][]): void => {
    const out: Record<string, string> = {};
    for (const [key, entry] of next) {
      if (key.trim() !== '') {
        out[key] = entry;
      }
    }
    onChange(out);
  };
  return (
    <div className={LIST} id={id}>
      {pairs.map(([key, entry], index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries are plain strings edited in place by position, with no other identity.
        <div className={ROW} key={index}>
          <Input
            aria-label={t`Name`}
            placeholder={t`Name`}
            value={key}
            onInput={(event) => {
              const next: [string, string][] = [...pairs];
              next[index] = [event.currentTarget.value, entry];
              write(next);
            }}
          />
          <Input
            aria-label={t`Value`}
            placeholder={t`Value`}
            value={entry}
            onInput={(event) => {
              const next: [string, string][] = [...pairs];
              next[index] = [key, event.currentTarget.value];
              write(next);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => write(pairs.filter((_, i) => i !== index))}
          >
            <Trans>Remove</Trans>
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => write([...pairs, ['', '']])}
      >
        <Trans>Add row</Trans>
      </Button>
    </div>
  );
}

/** Props a picker-backed control needs beyond the plain ones. */
export interface PickerProps extends ControlProps {
  /** Opens the media library and resolves to a relative path, or null. */
  readonly pickMedia?: (kind: 'image' | 'file') => Promise<string | null>;
  /** Opens the content picker and resolves to a slug, or null. */
  readonly pickContent?: (kind: string) => Promise<string | null>;
  /** Resolves a stored relative path to a preview URL, when known. */
  readonly previewUrl?: (path: string) => string | null;
}

/**
 * A single media reference. **The stored value is the relative path**
 * (`images/x.jpg`), never a URL — that is what makes an export portable
 * (docs/CONTENT_FORMAT.md §4).
 */
export function MediaControl(props: PickerProps): JSX.Element {
  const { spec, value, onChange, id, pickMedia, previewUrl } = props;
  const current = asString(value);
  const kind = spec.field.type === 'file' ? 'file' : 'image';
  const preview = current === '' ? null : (previewUrl?.(current) ?? null);
  return (
    <div className={ROW} id={id}>
      {preview !== null && kind === 'image' ? (
        <img
          className="size-16 rounded-md border object-cover"
          src={preview}
          alt=""
        />
      ) : null}
      <Input
        className="font-mono"
        value={current}
        placeholder={kind === 'image' ? 'images/photo.jpg' : 'files/sheet.pdf'}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {pickMedia === undefined ? null : (
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            const picked = await pickMedia(kind);
            if (picked !== null) {
              onChange(picked);
            }
          }}
        >
          <Trans>Choose…</Trans>
        </Button>
      )}
      {current === '' ? null : (
        <Button type="button" variant="outline" onClick={() => onChange('')}>
          <Trans>Clear</Trans>
        </Button>
      )}
    </div>
  );
}

/** A list of media references, again as relative paths. */
export function MediaListControl(props: PickerProps): JSX.Element {
  const { value, onChange, id, pickMedia, previewUrl } = props;
  const entries = asList(value);
  return (
    <div className={LIST} id={id}>
      {entries.map((entry, index) => {
        const preview = previewUrl?.(entry) ?? null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are plain strings edited in place by position, with no other identity.
          <div className={ROW} key={index}>
            {preview === null ? null : (
              <img
                className="size-10 rounded-md border object-cover"
                src={preview}
                alt=""
              />
            )}
            <Input
              value={entry}
              onInput={(event) => {
                const next = [...entries];
                next[index] = event.currentTarget.value;
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <Trans>Remove</Trans>
            </Button>
          </div>
        );
      })}
      {pickMedia === undefined ? null : (
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            const picked = await pickMedia('image');
            if (picked !== null) {
              onChange([...entries, picked]);
            }
          }}
        >
          <Trans>Add image…</Trans>
        </Button>
      )}
    </div>
  );
}

/** A reference to another content item. The stored value is its **slug**. */
export function ReferenceControl(props: PickerProps): JSX.Element {
  const { spec, value, onChange, id, pickContent } = props;
  const target = spec.field.kind ?? '';
  const { t } = useLingui();
  return (
    <div className={ROW} id={id}>
      <Input
        className="font-mono"
        value={asString(value)}
        placeholder={t`${target} slug`}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {pickContent === undefined ? null : (
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            const picked = await pickContent(target);
            if (picked !== null) {
              onChange(picked);
            }
          }}
        >
          <Trans>Choose…</Trans>
        </Button>
      )}
    </div>
  );
}

/**
 * A write-only secret. It shows whether one is set and offers to replace it;
 * the value is never echoed by the server and never rendered here
 * (docs/PLUGIN_API.md §7.3).
 */
export function SecretControl({
  configured,
  onSet,
  onClear,
  id,
  label,
}: {
  readonly configured: boolean;
  readonly onSet: (value: string) => void;
  readonly onClear: () => void;
  readonly id: string;
  readonly label: string;
}): JSX.Element {
  // Only "the operator asked to replace it" is state. Whether a value is
  // stored comes from the server through `configured` on every render;
  // mirroring it here once left "Set" on screen after a removal.
  const { t } = useLingui();
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState('');
  if (configured && !replacing) {
    return (
      <fieldset
        className="flex flex-wrap items-center gap-2"
        id={id}
        aria-label={label}
      >
        <StatusBadge tone="ok">
          <Trans>Set</Trans>
        </StatusBadge>
        <Button
          type="button"
          variant="outline"
          onClick={() => setReplacing(true)}
        >
          <Trans>Replace</Trans>
        </Button>
        <Button type="button" variant="outline" onClick={onClear}>
          <Trans>Remove</Trans>
        </Button>
      </fieldset>
    );
  }
  return (
    <fieldset
      className="flex flex-wrap items-center gap-2"
      id={id}
      aria-label={label}
    >
      <Input
        className="w-72 max-w-full"
        type="password"
        autoComplete="off"
        aria-label={label}
        value={draft}
        placeholder={t`Paste the value`}
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          onSet(draft);
          setDraft('');
          setReplacing(false);
        }}
        disabled={draft === ''}
      >
        <Trans>Save</Trans>
      </Button>
      {configured ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft('');
            setReplacing(false);
          }}
        >
          <Trans>Cancel</Trans>
        </Button>
      ) : null}
    </fieldset>
  );
}
