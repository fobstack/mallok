/**
 * Read-only child rows shown with one row of a plugin panel — the lines of
 * an order (docs/PLUGIN_API.md §7.5) — and the cell formatting every panel
 * table shares.
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import type { PluginPanel } from '../types.js';

type Row = Record<string, unknown>;
type ColumnType = PluginPanel['columns'][number]['type'];

/** Formats one cell by its declared column type. */
export function cell(value: unknown, type: ColumnType): JSX.Element | string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const text = String(value);
  if (type === 'email') {
    return <a href={`mailto:${text}`}>{text}</a>;
  }
  if (type === 'datetime') {
    return text.slice(0, 16).replace('T', ' ');
  }
  if (type === 'badge') {
    return <span className={`pill ${text}`}>{text}</span>;
  }
  return text;
}

function RelatedTable({
  base,
  related,
  parentId,
}: {
  readonly base: string;
  readonly related: PluginPanel['related'][number];
  readonly parentId: string;
}): JSX.Element {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [more, setMore] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api<{ rows: Row[]; hasMore: boolean }>(
      `${base}/related/${related.id}?parent=${encodeURIComponent(parentId)}`,
    ).then(
      (result) => {
        if (!cancelled) {
          setRows(result.rows);
          setMore(result.hasMore);
        }
      },
      (caught: unknown) => {
        if (!cancelled) {
          setFailure(
            caught instanceof ApiError ? caught.message : 'Could not load.',
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base, related.id, parentId]);

  return (
    <section className="related-rows" aria-label={related.label}>
      <h3>{related.label}</h3>
      {failure !== '' ? (
        <p className="error" role="alert">
          {failure}
        </p>
      ) : rows === null ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="empty">None.</p>
      ) : (
        <table className="rows-table">
          <thead>
            <tr>
              {related.columns.map((column) => (
                <th scope="col" key={column.field}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // Child rows are shown, never addressed: position is their key.
              // biome-ignore lint/suspicious/noArrayIndexKey: a read-only list that is replaced whole, never reordered.
              <tr key={index}>
                {related.columns.map((column) => (
                  <td key={column.field}>
                    {cell(row[column.field], column.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more ? <p className="help">Only the first rows are shown.</p> : null}
    </section>
  );
}

/** Every related table a panel declares, for one of its rows. */
export function RelatedRows({
  pluginId,
  panel,
  parentId,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
  readonly parentId: string;
}): JSX.Element | null {
  if (panel.related.length === 0) {
    return null;
  }
  const base = `/plugins/${pluginId}/panels/${panel.id}`;
  return (
    <>
      {panel.related.map((related) => (
        <RelatedTable
          key={related.id}
          base={base}
          related={related}
          parentId={parentId}
        />
      ))}
    </>
  );
}
