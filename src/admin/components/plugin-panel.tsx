/**
 * A plugin's declarative table panel (docs/PLUGIN_API.md §7.5).
 *
 * The plugin ships no UI code: this component reads `panels[]` out of its
 * manifest and builds the table, filters, detail view and actions from it.
 * That is what keeps the admin's size and security boundary intact while
 * still letting a plugin have a real interface.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, csrf } from '../api.js';
import { notice } from '../state.js';
import type { PluginPanel } from '../types.js';

type Row = Record<string, unknown>;

const PAGE = 20;

function cell(
  value: unknown,
  type: PluginPanel['columns'][number]['type'],
): JSX.Element | string {
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

export function PluginPanelView({
  pluginId,
  panel,
}: {
  readonly pluginId: string;
  readonly panel: PluginPanel;
}): JSX.Element {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  const base = `/plugins/${pluginId}/panels/${panel.id}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is a new object every render; its stringified form is the real "did it change" check.
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    const query = new URLSearchParams({
      limit: String(PAGE),
      offset: String(offset),
    });
    for (const [field, value] of Object.entries(filters)) {
      if (value !== '') {
        query.set(field, value);
      }
    }
    try {
      const result = await api<{ rows: Row[]; hasNext: boolean }>(
        `${base}?${query.toString()}`,
      );
      setRows(result.rows);
      setHasNext(result.hasNext);
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'Could not load rows.';
    } finally {
      setLoading(false);
    }
  }, [offset, base, JSON.stringify(filters)]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runAction = async (
    action: PluginPanel['actions'][number],
  ): Promise<void> => {
    if (action.type === 'download') {
      // A download needs the raw response, not parsed JSON.
      const response = await fetch(`/_mallok/api${base}/actions/${action.id}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'x-mallok-csrf': csrf(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ids: selected }),
      });
      if (!response.ok) {
        notice.value = `"${action.label}" failed.`;
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        response.headers
          .get('content-disposition')
          ?.match(/filename="([^"]+)"/)?.[1] ?? `${panel.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (selected.length === 0) {
      notice.value = 'Select at least one row first.';
      return;
    }
    try {
      await api(`${base}/actions/${action.id}`, {
        method: 'POST',
        body: { ids: selected },
      });
      setSelected([]);
      await reload();
    } catch (caught) {
      notice.value =
        caught instanceof ApiError ? caught.message : 'The action failed.';
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{panel.label}</h3>
        {panel.filters.map((field) => (
          <label className="filter" key={field}>
            <span>{field.replace(/_/g, ' ')}</span>
            <input
              value={filters[field] ?? ''}
              placeholder="any"
              onChange={(event) => {
                setOffset(0);
                setFilters((previous) => ({
                  ...previous,
                  [field]: event.currentTarget.value,
                }));
              }}
            />
          </label>
        ))}
        <span className="grow" />
        {panel.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="ghost"
            onClick={() => void runAction(action)}
          >
            {action.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="empty">Nothing here yet.</p>
      ) : (
        <table className="rows-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Select</span>
              </th>
              {panel.columns.map((column) => (
                <th scope="col" key={column.field}>
                  {column.label}
                </th>
              ))}
              <th scope="col">
                <span className="visually-hidden">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = String(row.id ?? '');
              return (
                <tr key={id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${id}`}
                      checked={selected.includes(id)}
                      onChange={(event) =>
                        setSelected(
                          event.currentTarget.checked
                            ? [...selected, id]
                            : selected.filter((entry) => entry !== id),
                        )
                      }
                    />
                  </td>
                  {panel.columns.map((column) => (
                    <td key={column.field}>
                      {cell(row[column.field], column.type)}
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setOpen(row)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <nav className="pager" aria-label="Pagination">
        <button
          type="button"
          className="ghost"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE))}
        >
          Previous
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!hasNext}
          onClick={() => setOffset(offset + PAGE)}
        >
          Next
        </button>
      </nav>

      {open === null ? null : (
        <RowDetail panel={panel} row={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function RowDetail({
  panel,
  row,
  onClose,
}: {
  readonly panel: PluginPanel;
  readonly row: Row;
  readonly onClose: () => void;
}): JSX.Element {
  const fields = [
    ...panel.columns.map((column) => column.field),
    ...panel.detail,
  ];
  return (
    <dialog
      className="modal"
      aria-label={`${panel.label} detail`}
      ref={(element) => element?.showModal()}
      onClose={onClose}
      onCancel={onClose}
    >
      <header className="modal-head">
        <h2>{panel.label}</h2>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <dl className="detail-list">
        {fields.map((field) => (
          <div key={field}>
            <dt>{field.replace(/_/g, ' ')}</dt>
            <dd>{String(row[field] ?? '—')}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
