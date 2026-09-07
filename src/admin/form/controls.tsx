/**
 * One control per declarable field type (docs/THEME_FORMAT.md §5.2).
 *
 * The three that are more than an input are called out in
 * docs/ADMIN.md §7: media fields write back a **relative path**, references
 * write back a **slug**, and secrets never show their value.
 */

import type { JSX } from 'react';
import { useState } from 'react';
import type { ControlProps } from './types.js';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Single-line text, and the base for `color`, `date` and friends. */
export function TextControl({
  spec,
  value,
  onChange,
  id,
}: ControlProps): JSX.Element {
  const type =
    spec.field.type === 'color'
      ? 'color'
      : spec.field.type === 'date'
        ? 'date'
        : 'text';
  return (
    <input
      id={id}
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
}: ControlProps): JSX.Element {
  return (
    <textarea
      id={id}
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
}: ControlProps): JSX.Element {
  return (
    <input
      id={id}
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
    <input
      id={id}
      type="checkbox"
      checked={value === true}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

/** One of the declared choices. */
export function SelectControl({
  spec,
  value,
  onChange,
  id,
}: ControlProps): JSX.Element {
  return (
    <select
      id={id}
      value={asString(value)}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="">—</option>
      {(spec.field.choices ?? []).map((choice) => (
        <option key={choice} value={choice}>
          {choice}
        </option>
      ))}
    </select>
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
}: ControlProps): JSX.Element {
  const entries = asList(value);
  const update = (next: string[]): void => {
    onChange(next.filter((entry) => entry.trim() !== ''));
  };
  return (
    <div className="list-control" id={id}>
      {entries.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries are plain strings edited in place by position, with no other identity.
        <div className="list-row" key={index}>
          <input
            value={entry}
            onInput={(event) => {
              const next = [...entries];
              next[index] = event.currentTarget.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => update(entries.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost"
        onClick={() => onChange([...entries, ''])}
      >
        Add entry
      </button>
    </div>
  );
}

/** A key/value table, kept as an object in insertion order. */
export function KeyValueControl({
  value,
  onChange,
  id,
}: ControlProps): JSX.Element {
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
    <div className="list-control" id={id}>
      {pairs.map(([key, entry], index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries are plain strings edited in place by position, with no other identity.
        <div className="list-row" key={index}>
          <input
            aria-label="Name"
            placeholder="Name"
            value={key}
            onInput={(event) => {
              const next: [string, string][] = [...pairs];
              next[index] = [event.currentTarget.value, entry];
              write(next);
            }}
          />
          <input
            aria-label="Value"
            placeholder="Value"
            value={entry}
            onInput={(event) => {
              const next: [string, string][] = [...pairs];
              next[index] = [key, event.currentTarget.value];
              write(next);
            }}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => write(pairs.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost"
        onClick={() => write([...pairs, ['', '']])}
      >
        Add row
      </button>
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
    <div className="media-control" id={id}>
      {preview !== null && kind === 'image' ? (
        <img className="media-thumb" src={preview} alt="" />
      ) : null}
      <input
        className="path"
        value={current}
        placeholder={kind === 'image' ? 'images/photo.jpg' : 'files/sheet.pdf'}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {pickMedia === undefined ? null : (
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            const picked = await pickMedia(kind);
            if (picked !== null) {
              onChange(picked);
            }
          }}
        >
          Choose…
        </button>
      )}
      {current === '' ? null : (
        <button type="button" className="ghost" onClick={() => onChange('')}>
          Clear
        </button>
      )}
    </div>
  );
}

/** A list of media references, again as relative paths. */
export function MediaListControl(props: PickerProps): JSX.Element {
  const { value, onChange, id, pickMedia, previewUrl } = props;
  const entries = asList(value);
  return (
    <div className="list-control" id={id}>
      {entries.map((entry, index) => {
        const preview = previewUrl?.(entry) ?? null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are plain strings edited in place by position, with no other identity.
          <div className="list-row media-row" key={index}>
            {preview === null ? null : (
              <img className="media-thumb small" src={preview} alt="" />
            )}
            <input
              value={entry}
              onInput={(event) => {
                const next = [...entries];
                next[index] = event.currentTarget.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              className="ghost"
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        );
      })}
      {pickMedia === undefined ? null : (
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            const picked = await pickMedia('image');
            if (picked !== null) {
              onChange([...entries, picked]);
            }
          }}
        >
          Add image…
        </button>
      )}
    </div>
  );
}

/** A reference to another content item. The stored value is its **slug**. */
export function ReferenceControl(props: PickerProps): JSX.Element {
  const { spec, value, onChange, id, pickContent } = props;
  const target = spec.field.kind ?? '';
  return (
    <div className="media-control" id={id}>
      <input
        className="path"
        value={asString(value)}
        placeholder={`${target} slug`}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {pickContent === undefined ? null : (
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            const picked = await pickContent(target);
            if (picked !== null) {
              onChange(picked);
            }
          }}
        >
          Choose…
        </button>
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
  const [editing, setEditing] = useState(!configured);
  const [draft, setDraft] = useState('');
  if (!editing) {
    return (
      <div className="secret-control" id={id}>
        <span className="pill ok">Set</span>
        <button
          type="button"
          className="ghost"
          onClick={() => setEditing(true)}
        >
          Replace
        </button>
        <button type="button" className="ghost" onClick={onClear}>
          Remove
        </button>
      </div>
    );
  }
  return (
    <div className="secret-control" id={id}>
      <input
        type="password"
        autoComplete="off"
        aria-label={label}
        value={draft}
        placeholder="Paste the value"
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
      <button
        type="button"
        className="ghost"
        onClick={() => {
          onSet(draft);
          setDraft('');
          setEditing(false);
        }}
        disabled={draft === ''}
      >
        Save
      </button>
      {configured ? (
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setDraft('');
            setEditing(false);
          }}
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}
